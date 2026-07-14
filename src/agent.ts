import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import { getAppSettings, getRecentAgentMessages, type AgentMessage, type AppSettings } from "./db.js";
import { testEvolutionConnection } from "./evolutionapi.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";
import { callOpenAiWithRetry, describeOpenAiError } from "./openai-retry.js";

const MAX_TOOL_ROUNDS = 8;
// Historique injecté à chaque tour : assez pour le contexte, pas trop pour
// limiter la consommation de tokens (et donc les 429 de limite de vitesse).
const CHAT_HISTORY_LIMIT = 30;
const CHAT_MAX_TOKENS = 2048;

/**
 * Détecte une réponse « amorce vide » : le modèle annonce un contenu
 * (phrase se terminant par «\u00A0:\u00A0») puis s'arrête sans le fournir.
 */
function isDanglingAnnouncement(text: string): boolean {
  const t = text.replace(/\s+$/u, "");
  return /[:：]$/u.test(t);
}

/** Vrai contenu de simulation (fil Toi → / Prospect → ou messages entre guillemets). */
function hasSimulationThread(text: string): boolean {
  const arrowTurns = (text.match(/→/g) || []).length;
  if (arrowTurns >= 2) return true;
  if (/(^|\n)\s*(toi|moi)\s*→/im.test(text) && /(^|\n)\s*\S{2,}\s*→/im.test(text)) return true;
  const quotes = text.match(/[«"][^»"\n]{12,}[»"]/g);
  return Boolean(quotes && quotes.length >= 2);
}

/**
 * Détecte une annonce de simulation / aperçu de conversation SANS le fil.
 * Couvre aussi « Voici comment la conversation pourrait se dérouler… : » (bug récurrent).
 */
function isBrokenSimulationPreview(text: string): boolean {
  const t = text.trim();
  const announces =
    /\b(simulation|simuler|d[ée]rouler|ressemblerait|fil de discussion|voici comment|avec cette approche|commen[çc]ons|d[ée]marr\w*|lan[çc]ons|d[ée]butons)\b/i.test(
      t
    ) || /\bconversation\b.{0,40}\b(d[ée]rouler|ressembl)/i.test(t);
  if (!announces) return false;
  if (hasSimulationThread(t)) return false;
  // Annonce qui finit sur « : » OU texte court sans vrai fil
  if (isDanglingAnnouncement(t)) return true;
  return t.length < 450;
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
    getRecentAgentMessages(userId, CHAT_HISTORY_LIMIT),
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
  let simFixAttempts = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await callOpenAiWithRetry(() =>
        client.chat.completions.create({
          model: config.openaiModel,
          messages,
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
          max_tokens: CHAT_MAX_TOKENS,
        })
      );
    } catch (err) {
      throw new Error(describeOpenAiError(err));
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

        // Si l'outil a déjà formaté le fil de simulation, on l'affiche tel quel
        // (évite que le modèle annonce encore « Voici comment… : » sans contenu).
        if (toolCall.function.name === "show_campaign_simulation") {
          try {
            const parsed = JSON.parse(result) as { success?: boolean; display?: string };
            if (parsed.success && parsed.display?.trim()) {
              return parsed.display.trim();
            }
          } catch {
            /* fall through */
          }
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

    // Garde-fou : annonce se terminant par « : » sans contenu.
    if (isDanglingAnnouncement(text) && rounds < MAX_TOOL_ROUNDS) {
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "system",
        content:
          "Ta réponse s'est arrêtée sur une annonce se terminant par «\u00A0:\u00A0» sans fournir le contenu. Réécris MAINTENANT ta réponse complète dans UN seul message : si c'est une simulation, appelle l'outil show_campaign_simulation (3-4 tours Toi/Prospect) OU écris directement le fil « Toi → «\u00A0…\u00A0» » / « Prospect → «\u00A0…\u00A0» ». Ne termine JAMAIS sur «\u00A0:\u00A0».",
      });
      continue;
    }

    // Garde-fou simulation vide / incomplète (ex. « Voici comment… pourrait se dérouler : »).
    if (isBrokenSimulationPreview(text) && simFixAttempts < 3 && rounds < MAX_TOOL_ROUNDS) {
      simFixAttempts++;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "system",
        content:
          "INTERDIT : tu as annoncé une simulation/aperçu SANS écrire le fil. Appelle MAINTENANT l'outil show_campaign_simulation avec exactement 3 ou 4 tours (speaker toi/prospect + texte réel sans crochets), OU écris le fil complet dans ce message au format :\nToi → «\u00A0…\u00A0»\nProspect → «\u00A0…\u00A0»\nToi → «\u00A0…\u00A0»\nPuis demande ce qu'il faut ajuster. Aucune phrase qui finit par «\u00A0:\u00A0» sans le fil juste après.",
      });
      continue;
    }

    return text;
  }

  return "Trop d'étapes d'exécution. Reformulez votre demande de façon plus simple.";
}
