import { createHandoffEvent } from "./db.js";
import { matchesTriggerPhrase } from "./phrase-matching.js";
import { generateWhatsAppReply } from "./whatsapp-reply.js";
import type { ScoringResult } from "./lead-scoring.js";

/**
 * Brouillon pour l'opérateur (UI handoffs) — jamais envoyé au prospect.
 * Le client ne doit pas savoir qu'on passe la main (sinon l'IA est révélée).
 */
export const HANDOFF_OPERATOR_DRAFT_HINT =
  "Reprendre la conversation naturellement, sans annoncer un transfert ni mentionner d'IA.";

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

/**
 * Ping WhatsApp sur le numéro connecté du propriétaire (Message à soi-même).
 * Best-effort : ne fait jamais échouer le handoff.
 */
async function notifyOwnerOnOwnWhatsApp(
  userId: number,
  input: {
    contactPhone: string;
    contactName: string;
    reason: string;
    summary: string;
  }
): Promise<void> {
  try {
    const {
      getConnectedOwnerId,
      chatIdsMatch,
      chatIdToDisplay,
      sendWhatsAppMessage,
    } = await import("./evolutionapi.js");

    const ownerId = await getConnectedOwnerId(userId);
    if (!ownerId) {
      console.warn("[handoff] numéro propriétaire introuvable — notif WhatsApp ignorée");
      return;
    }
    // Évite une boucle si le « prospect » est le compte connecté lui-même.
    if (chatIdsMatch(ownerId, input.contactPhone)) return;

    const display = chatIdToDisplay(input.contactPhone);
    const name = input.contactName.trim() || display;
    const body = [
      "Handoff Klanvio — reprise humaine",
      `${name} (${display})`,
      input.reason,
      input.summary.slice(0, 280),
      "L'IA s'est arrêtée. Reprenez depuis WhatsApp.",
    ].join("\n");

    await sendWhatsAppMessage(userId, ownerId, body, {
      enableAutoReply: false,
      countsTowardQuota: false,
      bypassOutboundGates: true,
      outboundProfile: "auto_reply",
    });
    console.log(`[handoff] notif propriétaire → ${chatIdToDisplay(ownerId)}`);
  } catch (err) {
    console.warn("[handoff] notif propriétaire échouée:", err);
  }
}

export async function createKeywordHandoff(userId: number, input: {
  chatId: string;
  senderName: string;
  incomingText: string;
  matchedKeyword: string;
  campaignName?: string;
}): Promise<void> {
  const reason = `Mot-clé handoff : « ${input.matchedKeyword} »`;
  const summary =
    (input.campaignName ? `Campagne « ${input.campaignName} ». ` : "") +
    `Dernier message: ${input.incomingText.slice(0, 200)}`;

  await createHandoffEvent(userId, {
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason,
    summary,
    suggestedReply: HANDOFF_OPERATOR_DRAFT_HINT,
  });

  await notifyOwnerOnOwnWhatsApp(userId, {
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason,
    summary,
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

  let suggestedReply = HANDOFF_OPERATOR_DRAFT_HINT;
  try {
    const draft = await generateWhatsAppReply(userId, {
      chatId: input.chatId,
      senderName: input.senderName,
      incomingText: input.incomingText,
      automationContext: input.automationContext,
    });
    // Brouillon opérateur uniquement — ne doit pas annoncer un transfert.
    if (draft.trim()) suggestedReply = draft.trim();
  } catch {
    /* garde le hint opérateur */
  }

  const reason = input.scoring.handoffReason || "Intervention humaine recommandée";
  const summary = `Score: ${input.scoring.newScore}/100 (${input.scoring.label}). Dernier message: ${input.incomingText.slice(0, 200)}`;

  await createHandoffEvent(userId, {
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason,
    summary,
    suggestedReply,
  });

  await notifyOwnerOnOwnWhatsApp(userId, {
    contactPhone: input.chatId,
    contactName: input.senderName,
    reason,
    summary,
  });

  return true;
}
