import { config } from "./config.js";
import { getAppSettings } from "./db.js";
import { callOpenAiWithRetry, describeOpenAiError } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, deepseekChatExtras } from "./llm.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";
import type OpenAI from "openai";

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tooSimilar(a: string, b: string): boolean {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  // Similarité grossière : mêmes 12 premiers mots
  const wx = x.split(" ").slice(0, 12).join(" ");
  const wy = y.split(" ").slice(0, 12).join(" ");
  return wx.length > 20 && wx === wy;
}

export async function generatePersonalizedOpener(
  userId: number,
  input: {
    template: string;
    memberName: string;
    groupName: string;
    conversationGuide?: string;
    /** Openers déjà envoyés dans cette campagne — à ne PAS répéter. */
    recentOpeners?: string[];
  }
): Promise<string> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) return personalizeFallback(input);

  const avoid = (input.recentOpeners ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25);

  const client = createLlmClient(key);

  const buildPrompt = (attempt: number) =>
    ({
      role: "system" as const,
      content:
        "Tu rédiges le PREMIER message WhatsApp de prospection (étape A.I.D.A. = Attention uniquement).\n" +
        "Règles strictes :\n" +
        "- 1 à 3 phrases, très humain, français naturel\n" +
        "- Accrocher l'attention — PAS de prix, PAS de lien, PAS de pitch complet\n" +
        "- UNIQUE pour CE prospect : angle, formulation et accroche DIFFÉRENTS de tous les exemples à éviter\n" +
        "- Utilise le prénom si disponible\n" +
        "- Pas de placeholders ni de crochets [ ]\n" +
        "- Réponds UNIQUEMENT avec le texte du message\n" +
        (attempt > 1
          ? "- IMPORTANT : ta version précédente était trop proche d'un message déjà envoyé — change VRAIMENT l'angle.\n"
          : ""),
    });

  const userPrompt =
    `Groupe / contexte : ${input.groupName}\n` +
    `Prospect : ${input.memberName}\n` +
    `Message modèle (à adapter, ne pas recopier) : ${input.template}\n` +
    `Consignes campagne : ${input.conversationGuide || "Rester naturel et professionnel"}\n` +
    (avoid.length
      ? `\nMessages DÉJÀ envoyés à d'autres prospects (INTERDIT de les recopier ou de les paraphraser de près) :\n` +
        avoid.map((m, i) => `${i + 1}. « ${m.slice(0, 220)} »`).join("\n")
      : "") +
    `\nGénère UNIQUEMENT une accroche personnalisée et DISTINCTE.`;

  try {
    let text = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await callOpenAiWithRetry(
        () =>
          client.chat.completions.create({
            model: config.openaiModel,
            messages: [
              buildPrompt(attempt),
              { role: "user", content: userPrompt },
            ],
            max_tokens: 220,
            temperature: attempt === 1 ? 1.05 : 1.15,
            presence_penalty: 0.6,
            frequency_penalty: 0.55,
            ...deepseekChatExtras({ enableThinking: false }),
          } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming),
        { maxRetries: 4 }
      );

      text = sanitizeOutboundWhatsAppText(
        response.choices[0]?.message?.content?.trim() || ""
      );
      if (!text) continue;

      const clash =
        tooSimilar(text, input.template) ||
        avoid.some((prev) => tooSimilar(text, prev));
      if (!clash) return text;
    }
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
  const angles = [
    (n: string, base: string) =>
      n ? `Salut ${n}, ${base}` : `Salut, ${base}`,
    (n: string, base: string) =>
      n ? `${n}, petite question rapide — ${base}` : `Petite question rapide — ${base}`,
    (n: string, base: string) =>
      n ? `Hey ${n} 🙂 ${base}` : `Hey 🙂 ${base}`,
  ];
  const base = input.template
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const short = base.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 180);
  const pick = angles[Math.floor(Math.random() * angles.length)];
  const cleaned = short.replace(/^bonjour\s*/i, "").replace(/^salut\s*/i, "");
  return pick(firstName.length > 1 ? firstName : "", cleaned).trim() || input.template;
}
