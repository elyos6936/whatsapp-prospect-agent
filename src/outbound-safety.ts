/**
 * Garde-fous anti-spam : 1 message sortant max tant que le prospect n'a pas répondu
 * — scopé à la campagne courante (pas l'historique WhatsApp toutes campagnes).
 */
import {
  cancelPendingSendQueueForRecipient,
  getContactChatHistory,
  type QueueItem,
} from "./db.js";
import { getActiveCampaignTargetIds } from "./campaign-gating.js";

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

function phoneDigits(value: string): string {
  return value.replace(/@c\.us|@lid|@s\.whatsapp\.net/gi, "").replace(/\D/g, "");
}

function recipientInTargetSet(recipient: string, ids: Set<string>): boolean {
  if (ids.has(recipient)) return true;
  const digits = phoneDigits(recipient);
  if (!digits) return false;
  for (const id of ids) {
    if (phoneDigits(id) === digits) return true;
  }
  return false;
}

/**
 * File campagne / séquence : interdire un 2e envoi tant que le prospect n'a pas répondu
 * (dans CETTE campagne). Cross-campagne : seulement si une autre auto active cible déjà le contact.
 */
export async function shouldBlockOutboundWhileAwaitingReply(
  userId: number,
  item: Pick<QueueItem, "recipient" | "automation_id" | "sequence_id" | "priority">
): Promise<{ block: boolean; reason?: string }> {
  if ((item.priority ?? 0) >= 10) return { block: false };
  if (item.automation_id == null && item.sequence_id == null) return { block: false };

  if (item.automation_id != null) {
    const otherActiveTargets = await getActiveCampaignTargetIds(userId, item.automation_id);
    if (recipientInTargetSet(item.recipient, otherActiveTargets)) {
      return {
        block: true,
        reason:
          "Ce contact est déjà ciblé par une autre campagne active — pas d'envoi croisé",
      };
    }
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
