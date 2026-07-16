import { config } from "./config.js";
import { getAppSettings } from "./db.js";
import { callOpenAiWithRetry, describeOpenAiError } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, deepseekChatExtras } from "./llm.js";
import type OpenAI from "openai";

export async function generatePersonalizedOpener(userId: number, input: {
  template: string;
  memberName: string;
  groupName: string;
  conversationGuide?: string;
}): Promise<string> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) return personalizeFallback(input);

  const client = createLlmClient(key);
  try {
    const response = await callOpenAiWithRetry(
      () =>
        client.chat.completions.create({
          model: config.openaiModel,
          messages: [
            {
              role: "system",
              content:
                "Tu rédiges le PREMIER message WhatsApp de prospection (étape A.I.D.A. = Attention uniquement).\n" +
                "Règles strictes :\n" +
                "- 1 à 2 phrases max, très humain, français naturel\n" +
                "- Accrocher l'attention / curiosité — PAS de prix, PAS de lien, PAS de pitch complet, PAS de « réserve / paie maintenant »\n" +
                "- Unique pour CE prospect (varie l'angle : question, observation, bénéfice court) — jamais un copier-coller générique\n" +
                "- Utilise le prénom si disponible\n" +
                "- Pas de placeholders ni de crochets [ ]\n" +
                "- Réponds UNIQUEMENT avec le texte du message",
            },
            {
              role: "user",
              content: `Groupe / contexte : ${input.groupName}
Prospect : ${input.memberName}
Message modèle (à adapter, ne pas recopier tel quel) : ${input.template}
Consignes campagne : ${input.conversationGuide || "Rester naturel et professionnel"}
Génère UNIQUEMENT l'accroche personnalisée (Attention A.I.D.A.).`,
            },
          ],
          max_tokens: 180,
          temperature: 0.95,
          ...deepseekChatExtras({ enableThinking: false }),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming),
      { maxRetries: 6 }
    );

    const text = response.choices[0]?.message?.content?.trim();
    return text || personalizeFallback(input);
  } catch (err) {
    console.warn(
      `[personalizer] fallback après échec ${llmProviderLabel()}: ${describeOpenAiError(err)}`
    );
    return personalizeFallback(input);
  }
}

function personalizeFallback(input: {
  template: string;
  memberName: string;
}): string {
  const firstName = input.memberName.split(/\s+/)[0] || "";
  const base = input.template
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const short = base.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 220);
  if (firstName && firstName.length > 1) {
    if (/^bonjour/i.test(short)) {
      return short.replace(/^Bonjour,?/i, `Bonjour ${firstName},`);
    }
    return `Bonjour ${firstName}, ${short.replace(/^bonjour\s*/i, "")}`.trim();
  }
  return short || input.template;
}
