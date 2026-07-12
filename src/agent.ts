import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import { AUTOMATION_BUILDER_PROMPT } from "./persona.js";
import {
  getAppSettings,
  getRecentAgentMessages,
  type AgentChannel,
  type AgentMessage,
  type AppSettings,
} from "./db.js";
import { testEvolutionConnection } from "./evolutionapi.js";
import { executeTool, TOOL_DEFINITIONS, type ToolContext } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;

const CHOICES_TOOL = "ask_user_choices";

/**
 * Transforme les arguments d'un appel `ask_user_choices` en réponse texte
 * contenant un bloc `klanvio-questions` que le frontend rend comme une carte
 * de questions à options cliquables. Renvoie null si aucune question valide.
 */
function buildChoicesReply(
  rawArgs: Record<string, unknown>,
  assistantText?: string | null
): string | null {
  const questionsRaw = Array.isArray(rawArgs.questions) ? rawArgs.questions : [];
  const questions = questionsRaw
    .map((q) => {
      const qo = (q ?? {}) as Record<string, unknown>;
      const prompt = typeof qo.prompt === "string" ? qo.prompt.trim() : "";
      const options = Array.isArray(qo.options)
        ? qo.options.map((o) => String(o).trim()).filter((o) => o.length > 0)
        : [];
      if (!prompt || options.length === 0) return null;
      return {
        id: typeof qo.id === "string" && qo.id.trim() ? qo.id.trim() : undefined,
        prompt,
        options,
        allowMultiple: qo.allow_multiple === true || qo.allowMultiple === true,
        allowOther: qo.allow_other === true || qo.allowOther === true,
      };
    })
    .filter((q): q is NonNullable<typeof q> => q !== null);

  if (questions.length === 0) return null;

  const intro =
    (typeof rawArgs.intro === "string" && rawArgs.intro.trim()) ||
    (assistantText && assistantText.trim()) ||
    "";

  const block = "```klanvio-questions\n" + JSON.stringify({ questions }) + "\n```";
  return intro ? `${intro}\n\n${block}` : block;
}

export interface ChatAgentOptions {
  /** Canal de conversation (historique isolé). Défaut : 'main'. */
  channel?: AgentChannel;
  /** Origine des automatisations créées pendant cet échange ('chat' ou 'manual'). */
  origin?: "chat" | "manual";
  /** Mode constructeur d'automatisation (page Automatisation → Manuel). */
  builder?: boolean;
}

async function getOpenAiClient(userId: number): Promise<OpenAI> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) {
    throw new Error(
      "Clé OpenAI manquante. Ouvrez « Connexions » et renseignez votre clé API OpenAI."
    );
  }
  return new OpenAI({ apiKey: key });
}

function buildBusinessContext(
  settings: AppSettings,
  connection: { connected: boolean; state: string; message: string }
): string {
  const lines: string[] = [];
  lines.push(
    `## État WhatsApp (Evolution API)\n${
      connection.connected
        ? "WhatsApp est connecté — les outils d'envoi sont disponibles."
        : `WhatsApp NON connecté (état : ${connection.state}). ${connection.message} Les outils qui envoient des messages échoueront tant que la connexion n'est pas établie — invite l'utilisateur à connecter WhatsApp via « Connexions ».`
    }`
  );
  lines.push(
    `## Profil business\n` +
      `Prénom / nom : ${settings.business_owner_name || "(non configuré)"}\n` +
      `Offre / formation : ${settings.business_offer || "(non configuré)"}\n` +
      `Tarif (FCFA) : ${settings.business_price || "(non communiqué)"}`
  );
  return lines.join("\n\n");
}

function toOpenAiMessages(history: AgentMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function formatOpenAiError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) return "Clé API OpenAI invalide (401). Vérifiez votre clé dans Connexions.";
    if (err.status === 429) return "Limite OpenAI atteinte (429). Réessayez dans quelques secondes.";
    if (err.status === 500 || err.status === 503) {
      return "OpenAI temporairement indisponible. Réessayez dans un moment.";
    }
    return `Erreur OpenAI (${err.status}) : ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function chatWithAgent(
  userId: number,
  userMessage: string,
  options: ChatAgentOptions = {}
): Promise<string> {
  const channel = options.channel ?? "main";
  const toolCtx: ToolContext = { origin: options.origin ?? "chat" };

  const connection = await testEvolutionConnection(userId);
  if (!connection.connected) {
    return (
      "⚠️ **WhatsApp n'est pas connecté.**\n\n" +
      "Je ne peux effectuer **aucune action** tant que votre numéro WhatsApp n'est pas relié à Klanvio.\n\n" +
      "👉 Allez dans **Réglages → Connexion WhatsApp**, scannez le QR code avec votre téléphone " +
      "(WhatsApp → Appareils connectés), puis revenez me parler.\n\n" +
      `État actuel : ${connection.message || connection.state}`
    );
  }

  const client = await getOpenAiClient(userId);
  const [settings, history] = await Promise.all([
    getAppSettings(userId),
    getRecentAgentMessages(userId, 50, channel),
  ]);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: options.builder ? AUTOMATION_BUILDER_PROMPT : SYSTEM_PROMPT },
    { role: "system", content: buildBusinessContext(settings, connection) },
    ...toOpenAiMessages(history),
  ];

  const last = history[history.length - 1];
  if (!last || last.role !== "user" || last.content !== userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: config.openaiModel,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        max_tokens: 4096,
      });
    } catch (err) {
      throw new Error(formatOpenAiError(err));
    }

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("Réponse OpenAI vide.");
    }

    const assistantMsg = choice.message;

    if (assistantMsg.tool_calls?.length) {
      // Interception : si le modèle demande une carte de questions, on la
      // renvoie directement (les arguments SONT la structure à afficher),
      // sans repasser par le modèle — ça garantit un bloc exact.
      const choicesCall = assistantMsg.tool_calls.find(
        (tc) => tc.type === "function" && tc.function.name === CHOICES_TOOL
      );
      if (choicesCall && choicesCall.type === "function") {
        let choiceArgs: Record<string, unknown> = {};
        try {
          choiceArgs = JSON.parse(choicesCall.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          choiceArgs = {};
        }
        const reply = buildChoicesReply(choiceArgs, assistantMsg.content);
        if (reply) return reply;
      }

      messages.push({
        role: "assistant",
        content: assistantMsg.content ?? null,
        tool_calls: assistantMsg.tool_calls,
      });

      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.type !== "function") continue;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        let result: string;
        try {
          result = await executeTool(userId, toolCall.function.name, args, toolCtx);
        } catch (err) {
          result = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      continue;
    }

    const text = assistantMsg.content?.trim();
    if (!text) {
      return "Je n'ai pas pu générer de réponse. Réessayez.";
    }
    return text;
  }

  return "Trop d'étapes d'exécution. Reformulez votre demande de façon plus simple.";
}
