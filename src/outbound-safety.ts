/**
 * Garde-fous anti-spam : 1 message sortant max tant que le prospect n'a pas répondu.
 */
import {
  cancelPendingSendQueueForRecipient,
  getContactChatHistory,
  type QueueItem,
} from "./db.js";

/** Dernier message de l'époque = sortant → on attend une réponse avant tout nouvel envoi. */
export async function isAwaitingProspectReply(
  userId: number,
  recipient: string
): Promise<boolean> {
  const history = await getContactChatHistory(userId, recipient, 20);
  if (history.length === 0) return false;
  const last = history[history.length - 1];
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

  const awaiting = await isAwaitingProspectReply(userId, item.recipient);
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
