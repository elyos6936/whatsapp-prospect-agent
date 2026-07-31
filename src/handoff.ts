import { createHandoffEvent } from "./db.js";
import { matchesTriggerPhrase } from "./phrase-matching.js";
import { generateWhatsAppReply } from "./whatsapp-reply.js";
import type { ScoringResult } from "./lead-scoring.js";

/** Message court au prospect quand on passe la main (mot-clé configuré). */
export const KEYWORD_HANDOFF_PROSPECT_REPLY =
  "Un instant, je vous passe quelqu'un de l'équipe qui pourra mieux vous aider.";

export function findMatchingHandoffKeyword(
  text: string,
  keywords: string[] | undefined | null
): string | null {
  if (!keywords?.length) return null;
  for (const kw of keywords) {
    const cleaned = String(kw ?? "").trim();
    if (!cleaned) continue;
    if (matchesTriggerPhrase(text, cleaned)) return cleaned;
  }
  return null;
}

export async function createKeywordHandoff(userId: number, input: {
  chatId: string;
  senderName: string;
  incomingText: string;
  matchedKeyword: string;
  campaignName?: string;
}): Promise<void> {
  await createHandoffEvent(userId, {
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason: `Mot-clé handoff : « ${input.matchedKeyword} »`,
    summary:
      (input.campaignName ? `Campagne « ${input.campaignName} ». ` : "") +
      `Dernier message: ${input.incomingText.slice(0, 200)}`,
    suggestedReply: KEYWORD_HANDOFF_PROSPECT_REPLY,
  });
}

export async function maybeCreateHandoff(userId: number, input: {
  chatId: string;
  senderName: string;
  incomingText: string;
  scoring: ScoringResult;
  automationContext?: string;
}): Promise<boolean> {
  if (!input.scoring.needsHandoff) return false;

  let suggestedReply = "";
  try {
    suggestedReply = await generateWhatsAppReply(userId, {
      chatId: input.chatId,
      senderName: input.senderName,
      incomingText: input.incomingText,
      automationContext: input.automationContext,
    });
  } catch {
    suggestedReply = "Bonjour, je reprends la conversation personnellement. Comment puis-je vous aider ?";
  }

  await createHandoffEvent(userId, {
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason: input.scoring.handoffReason || "Intervention humaine recommandée",
    summary: `Score: ${input.scoring.newScore}/100 (${input.scoring.label}). Dernier message: ${input.incomingText.slice(0, 200)}`,
    suggestedReply,
  });

  return true;
}
