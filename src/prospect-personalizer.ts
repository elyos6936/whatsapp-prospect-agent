import { config } from "./config.js";
import { getAppSettings } from "./db.js";
import { callOpenAiWithRetry, describeOpenAiError } from "./openai-retry.js";
import { createLlmClient, extractAssistantContent, llmProviderLabel, llmChatExtras } from "./llm.js";
import { sanitizeProspectFacingReply } from "./prospect-facing-sanitize.js";
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
  const wx = x.split(" ").slice(0, 12).join(" ");
  const wy = y.split(" ").slice(0, 12).join(" ");
  return wx.length > 20 && wx === wy;
}

/** Variation trop libre = hors cadre (chitchat inventé, pitch élargi…). */
export function driftsFromTemplate(text: string, template: string): boolean {
  const t = text.trim();
  if (t.length > Math.max(220, Math.floor(template.trim().length * 1.35) + 40)) return true;
  // Réactions / digressions typiques hors modèle
  if (
    /\b(profite|pause|tra[iî]nais|dans le coin|ravi de te|ravi de vous croiser|hey\b|salut\s+\w+)/i.test(
      t
    ) &&
    !/\b(profite|pause|tra[iî]nais|dans le coin|ravi de te|hey\b)/i.test(template)
  ) {
    return true;
  }
  // Réactions vide collée devant l'accroche (« Ah super! » + modèle)
  if (
    /^(ah\s+)?(super|cool|parfait|nickel|top)\b[!?.,…]*/i.test(t) &&
    !/^(ah\s+)?(super|cool|parfait|nickel|top)\b/i.test(template.trim())
  ) {
    return true;
  }
  return false;
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
        "Tu adaptes LÉGÈREMENT un premier message WhatsApp de prospection (A.I.D.A. = Attention uniquement).\n" +
        "Règles STRICTES (non négociables) :\n" +
        "- Garde EXACTEMENT la même intention / angle / offre du message modèle. Change seulement quelques mots ou le rythme.\n" +
        "- INTERDIT d'ajouter des infos absentes du modèle (date, places, prix, lien, pitch complet, digression).\n" +
        "- INTERDIT le chitchat inventé (« profite de ta pause », « je traînais dans le coin », « ravi de te croiser »…).\n" +
        "- VOUVOIEMENT obligatoire (vous / votre). Jamais tu / ton / ta / te.\n" +
        "- N'utilise PAS le prénom du prospect.\n" +
        "- 1 à 2 phrases max, ≤ 200 caractères idéalement.\n" +
        "- Pas de prix, pas de lien, pas de placeholders [ ].\n" +
        "- Réponds UNIQUEMENT avec le texte du message.\n" +
        (attempt > 1
          ? "- Ta version précédente était trop proche d'un message déjà envoyé OU hors cadre — reformule SANS changer le sens du modèle.\n"
          : ""),
    });

  const userPrompt =
    `Contexte campagne (indicatif) : ${input.groupName}\n` +
    `Message modèle VALIDÉ (référence — ne change pas le sens) : ${input.template}\n` +
    `Consignes campagne : ${input.conversationGuide || "Rester professionnel, vouvoyer, accroche courte"}\n` +
    (avoid.length
      ? `\nFormulations DÉJÀ envoyées (évite de les recopier mot pour mot, mais reste dans le même cadre) :\n` +
        avoid.map((m, i) => `${i + 1}. « ${m.slice(0, 180)} »`).join("\n")
      : "") +
    `\nGénère UNIQUEMENT une variante légère du message modèle.`;

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
            max_tokens: 160,
            temperature: attempt === 1 ? 0.55 : 0.7,
            presence_penalty: 0.25,
            frequency_penalty: 0.3,
            ...llmChatExtras({ enableThinking: false }),
          } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming),
        { maxRetries: 4 }
      );

      text = sanitizeOutboundWhatsAppText(
        sanitizeProspectFacingReply(
          extractAssistantContent(response.choices[0]?.message) || ""
        )
      );
      if (!text) continue;
      if (driftsFromTemplate(text, input.template)) continue;

      const clash =
        tooSimilar(text, input.template) ||
        avoid.some((prev) => tooSimilar(text, prev));
      if (!clash) return text;
    }
    // Si la paraphrase dérive ou clash : mieux vaut le modèle validé que du hors-cadre
    return input.template.trim() || personalizeFallback(input);
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
  // Pas de prénom, pas de Salut/Hey — micro-variation sûre du modèle validé
  const base = input.template
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  let short = base.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim();
  if (short.length > 220) {
    const hard = short.slice(0, 220);
    const lastSpace = hard.lastIndexOf(" ");
    short = (lastSpace > 80 ? hard.slice(0, lastSpace) : hard).trim();
  }
  if (!short) return input.template;
  const swaps: Array<[RegExp, string]> = [
    [/\bBonjour\b/i, "Bonsoir"],
    [/\bBonsoir\b/i, "Bonjour"],
    [/\bpetite question\b/i, "question rapide"],
    [/\bquestion rapide\b/i, "petite question"],
  ];
  for (const [re, to] of swaps) {
    if (re.test(short)) return short.replace(re, to);
  }
  return short;
}
