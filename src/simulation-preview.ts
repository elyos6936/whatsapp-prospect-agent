/**
 * Simulation interactive (panneau droit) — AUCUN envoi WhatsApp.
 * L'utilisateur joue le prospect ; l'IA répond comme le commercial.
 */
import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings } from "./db.js";
import { createLlmClient, deepseekChatExtras, extractAssistantContent, llmProviderLabel, recommendedMaxTokens } from "./llm.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { hasTemplatePlaceholders, sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";

export type SimPreviewTurn = {
  role: "you" | "prospect";
  text: string;
};

const MAX_TURNS = 4;

async function getOpenAiClient(userId: number): Promise<OpenAI> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) {
    throw new Error(
      `Clé ${llmProviderLabel()} manquante. Définissez DEEPSEEK_API_KEY (ou OPENAI_API_KEY) sur le serveur.`
    );
  }
  return createLlmClient(key);
}

export function extractOpenerFromPlan(plan: {
  nodes?: Array<{ kind?: string; label?: string; subtitle?: string }>;
}): string {
  const nodes = plan.nodes ?? [];
  const msg = nodes.find((n) => n.kind === "message" || /message|accroche|opener/i.test(n.label ?? ""));
  const text = (msg?.subtitle || msg?.label || "").trim();
  return text || "Bonjour ! Je me permets de vous écrire rapidement 🙂";
}

export async function replyInSimulationPreview(
  userId: number,
  input: {
    opener: string;
    history: SimPreviewTurn[];
    prospectMessage: string;
    guide?: string;
    offer?: string;
  }
): Promise<{
  reply: string;
  history: SimPreviewTurn[];
  done: boolean;
  feedbackPrompt: string | null;
}> {
  const prospectMessage = String(input.prospectMessage ?? "").trim();
  if (!prospectMessage) {
    throw new Error("Message prospect requis.");
  }

  const opener = sanitizeOutboundWhatsAppText(String(input.opener ?? "").trim()) ||
    "Bonjour ! Je me permets de vous écrire rapidement 🙂";

  let history: SimPreviewTurn[] = Array.isArray(input.history) ? [...input.history] : [];
  if (history.length === 0) {
    history.push({ role: "you", text: opener });
  }
  history.push({ role: "prospect", text: prospectMessage });

  if (history.length >= MAX_TURNS) {
    return {
      reply: "",
      history: history.slice(0, MAX_TURNS),
      done: true,
      feedbackPrompt:
        "Fin de la simulation (max 4 messages).\n\nDis-moi ce qui va / ce qu'il faut changer (ton, accroche, CTA…), puis on recommence ici. Si c'est bon, valide dans le chat du milieu.",
    };
  }

  const settings = await getAppSettings(userId);
  const offer = input.offer?.trim() || settings.business_offer || "";
  const price = settings.business_price || "";
  const guide = input.guide?.trim() || "";

  const transcript = history
    .map((t) => `${t.role === "you" ? "Toi" : "Prospect"}: ${t.text}`)
    .join("\n");

  const client = await getOpenAiClient(userId);
  const system =
    "Tu es le commercial WhatsApp de l'utilisateur (simulation). " +
    "Réponds en UN seul message court, naturel, sans crochets [], sans markdown. " +
    "Style WhatsApp humain. Ne propose pas d'envoyer un vrai message WhatsApp. " +
    "Pas de prix+lien dans le même message si c'est encore tôt dans la conversation.\n" +
    (offer ? `Offre: ${offer}\n` : "") +
    (price ? `Prix (si demandé): ${price}\n` : "") +
    (guide ? `Guide conversation: ${guide}\n` : "");

  const completion = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `Fil de simulation:\n${transcript}\n\n` +
            `Réponds maintenant comme « Toi » (1 message WhatsApp, 1-3 phrases max).`,
        },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 220, { thinkingEnabled: true }),
      temperature: 0.7,
      ...deepseekChatExtras({ enableThinking: true }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  );

  let reply = extractAssistantContent(completion.choices[0]?.message).trim();
  reply = sanitizeOutboundWhatsAppText(reply);
  if (!reply || hasTemplatePlaceholders(reply)) {
    reply = "Merci pour ton message 🙂 Tu peux m'en dire un peu plus ?";
  }

  history.push({ role: "you", text: reply });
  const done = history.length >= MAX_TURNS;

  return {
    reply,
    history,
    done,
    feedbackPrompt: done
      ? "Fin de la simulation (max 4 messages).\n\nDis-moi ce qui va / ce qu'il faut changer, puis on recommence. Si c'est bon, valide dans le chat du milieu."
      : null,
  };
}
