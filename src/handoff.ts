import { createHandoffEvent } from "./db.js";
import { generateWhatsAppReply } from "./whatsapp-reply.js";
import type { ScoringResult } from "./lead-scoring.js";

export async function maybeCreateHandoff(input: {
  chatId: string;
  senderName: string;
  incomingText: string;
  scoring: ScoringResult;
  automationContext?: string;
}): Promise<boolean> {
  if (!input.scoring.needsHandoff) return false;

  let suggestedReply = "";
  try {
    suggestedReply = await generateWhatsAppReply({
      chatId: input.chatId,
      senderName: input.senderName,
      incomingText: input.incomingText,
      automationContext: input.automationContext,
    });
  } catch {
    suggestedReply = "Bonjour, je reprends la conversation personnellement. Comment puis-je vous aider ?";
  }

  await createHandoffEvent({
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason: input.scoring.handoffReason || "Intervention humaine recommandée",
    summary: `Score: ${input.scoring.newScore}/100 (${input.scoring.label}). Dernier message: ${input.incomingText.slice(0, 200)}`,
    suggestedReply,
  });

  return true;
}
