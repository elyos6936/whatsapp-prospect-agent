/**
 * Garde-fous anti-spam : 1 message sortant max tant que le prospect n'a pas répondu
 * (sur le fil WhatsApp global — pas seulement la campagne courante).
 */
import {
  cancelPendingSendQueueForRecipient,
  getAbsoluteLastMessageForContact,
  getContactChatHistory,
  type QueueItem,
} from "./db.js";

/** Dernier message de l'époque / campagne = sortant → on attend une réponse. */
export async function isAwaitingProspectReply(
  userId: number,
  recipient: string,
  automationId?: number | null
): Promise<boolean> {
  const history = await getContactChatHistory(userId, recipient, 20, automationId);
  if (history.length === 0) return false;
  const last = history[history.length - 1];
  return last.direction === "sortant";
}

/** Dernier message du contact toutes campagnes = sortant → bloquer tout nouvel opener. */
export async function isAwaitingProspectReplyAnyCampaign(
  userId: number,
  recipient: string
): Promise<boolean> {
  const last = await getAbsoluteLastMessageForContact(userId, recipient);
  if (!last) return false;
  return last.direction === "sortant";
}

/**
 * File campagne / séquence : interdire un 2e envoi tant que le prospect n'a pas répondu.
 * Les envois manuels prioritaires (priority >= 10) ne sont pas concernés.
 */
export async function shouldBlockOutboundWhileAwaitingReply(
  userId: number,
  item: Pick<QueueItem, "recipient" | "automation_id" | "sequence_id" | "priority">
): Promise<{ block: boolean; reason?: string }> {
  if ((item.priority ?? 0) >= 10) return { block: false };
  if (item.automation_id == null && item.sequence_id == null) return { block: false };

  // Global d'abord : évite qu'une campagne B envoie pendant qu'A attend une réponse
  const awaitingGlobal = await isAwaitingProspectReplyAnyCampaign(userId, item.recipient);
  if (awaitingGlobal) {
    return {
      block: true,
      reason: "En attente de réponse du prospect — 1 seul message sortant autorisé sur ce fil",
    };
  }

  const awaiting = await isAwaitingProspectReply(
    userId,
    item.recipient,
    item.automation_id
  );
  if (!awaiting) return { block: false };
  return {
    block: true,
    reason: "En attente de réponse du prospect — 1 seul message sortant autorisé",
  };
}

/** Annule les doublons en file pour le même destinataire avant un nouvel enqueue. */
export async function cancelDuplicatePendingForRecipient(
  userId: number,
  recipient: string
): Promise<number> {
  return cancelPendingSendQueueForRecipient(userId, recipient);
}
