import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import { getAppSettings, getRecentAgentMessages, type AgentMessage, type AppSettings } from "./db.js";
import { testEvolutionConnection } from "./evolutionapi.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;

/**
 * Détecte une réponse « amorce vide » : le modèle annonce un contenu
 * (phrase se terminant par «\u00A0:\u00A0») puis s'arrête sans le fournir.
 */
function isDanglingAnnouncement(text: string): boolean {
  const t = text.replace(/\s+$/u, "");
  return /[:：]$/u.test(t);
}

/**
 * Détecte une annonce de simulation « vide » : le modèle dit qu'il commence /
 * lance la simulation mais ne fournit aucun message concret (ni guillemets, ni
 * contenu réel). C'est le bug typique où la simulation est zappée.
 */
function isEmptySimulationStart(text: string): boolean {
  const t = text.trim();
  const announcesSim =
    /\b(commen[çc]ons|d[ée]marr\w*|lan[çc]\w*|d[ée]buton\w*|on commence|passons\s+[àa])\b[^.!?]{0,40}\bsimulation\b/i.test(
      t
    ) || /\bsimulation\b[^.!?]{0,20}\b(commence|d[ée]marre|c'est parti)\b/i.test(t);
  if (!announcesSim) return false;
  // S'il y a déjà un vrai message entre guillemets ou un contenu multi-lignes conséquent, ce n'est pas vide.
  const hasQuotedMessage = /[«"„][^»"]{8,}[»"]/.test(t);
  const isShort = t.length < 240;
  return !hasQuotedMessage && isShort;
}

/** Petite pause. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function chatWithAgent(userId: number, userMessage: string): Promise<string> {
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
    getRecentAgentMessages(userId, 50),
  ]);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
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
    const MAX_API_RETRIES = 3;
    let apiAttempt = 0;
    for (;;) {
      apiAttempt++;
      try {
        response = await client.chat.completions.create({
          model: config.openaiModel,
          messages,
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
          max_tokens: 4096,
        });
        break;
      } catch (err) {
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        const retryable = status === 429 || status === 500 || status === 503;
        if (retryable && apiAttempt <= MAX_API_RETRIES) {
          // Back-off exponentiel : 1s, 2s, 4s.
          await sleep(1000 * 2 ** (apiAttempt - 1));
          continue;
        }
        throw new Error(formatOpenAiError(err));
      }
    }

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("Réponse OpenAI vide.");
    }

    const assistantMsg = choice.message;

    if (assistantMsg.tool_calls?.length) {
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
          result = await executeTool(userId, toolCall.function.name, args);
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

    // Garde-fou : le modèle a annoncé un contenu (« … : ») puis s'est arrêté
    // sans le fournir. On le relance une fois pour qu'il écrive le message complet.
    if (isDanglingAnnouncement(text) && rounds < MAX_TOOL_ROUNDS) {
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "system",
        content:
          "Ta réponse s'est arrêtée sur une annonce se terminant par «\u00A0:\u00A0» sans fournir le contenu. Réécris MAINTENANT ta réponse complète : reprends l'annonce PUIS le texte annoncé en entier (le message de prospection, la suggestion, etc.), dans un seul message. Ne termine pas sur «\u00A0:\u00A0».",
      });
      continue;
    }

    // Garde-fou simulation : le modèle a dit « commençons la simulation » sans
    // écrire de message concret. On le force à dérouler réellement la simulation.
    if (isEmptySimulationStart(text) && rounds < MAX_TOOL_ROUNDS) {
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "system",
        content:
          "Tu viens d'annoncer la simulation SANS l'écrire — c'est interdit. Écris MAINTENANT la simulation réelle, dans ce message : d'abord le premier message tel qu'il partirait au prospect (voix de l'entreprise, entre guillemets «\u00A0…\u00A0»), puis la réponse réaliste du prospect (préfixée par son nom), sur 2-3 tours. Termine par «\u00A0Est-ce que cela te convient ?\u00A0». Pas de bloc de code.",
      });
      continue;
    }

    return text;
  }

  return "Trop d'étapes d'exécution. Reformulez votre demande de façon plus simple.";
}
