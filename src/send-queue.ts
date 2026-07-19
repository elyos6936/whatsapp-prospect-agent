import {
  addAutomationLog,
  cancelPendingSendQueue,
  countOutboundToday,
  formatLocalDateTime,
  getAutomation,
  getDueQueueItems,
  getEffectiveOutboundLimit,
  markQueueFailed,
  markQueueSent,
  rescheduleSendQueueItem,
  type QueueItem,
} from "./db.js";
import { chatIdToDisplay, sendWhatsAppMedia, sendWhatsAppMessage } from "./evolutionapi.js";
import { shouldBlockOutboundWhileAwaitingReply } from "./outbound-safety.js";
import { listActiveUserIds } from "./users.js";

const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 7;
/** Priorité « urgence manuelle » uniquement — les openers campagne NE bypassent PLUS les quiet hours. */
const QUIET_BYPASS_MIN_PRIORITY = 10;

let queueRunning = false;

function isQuietHours(start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  const hour = new Date().getHours();
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function bypassQuietHours(item: QueueItem): boolean {
  return (item.priority ?? 0) >= QUIET_BYPASS_MIN_PRIORITY;
}

async function quietHoursForItem(
  userId: number,
  item: QueueItem
): Promise<{ start: number; end: number }> {
  if (!item.automation_id) {
    return { start: DEFAULT_QUIET_START, end: DEFAULT_QUIET_END };
  }
  try {
    const auto = await getAutomation(userId, item.automation_id);
    const start = auto?.config.quietHoursStart;
    const end = auto?.config.quietHoursEnd;
    if (
      typeof start === "number" &&
      typeof end === "number" &&
      start >= 0 &&
      start <= 23 &&
      end >= 0 &&
      end <= 23
    ) {
      return { start, end };
    }
  } catch {
    /* fallback défaut */
  }
  return { start: DEFAULT_QUIET_START, end: DEFAULT_QUIET_END };
}

async function rescheduleQuiet(
  userId: number,
  item: QueueItem,
  quietEndHour: number
): Promise<void> {
  const next = new Date();
  const hour = new Date().getHours();
  if (hour >= quietEndHour) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(quietEndHour, 30, 0, 0);
  const when = formatLocalDateTime(next);
  await rescheduleSendQueueItem(userId, item.id, when);
  const label = item.recipient_label || chatIdToDisplay(item.recipient);
  console.log(`🌙 Queue #${item.id} → ${label} reporté à ${when} (heures calmes)`);
  if (item.automation_id) {
    await addAutomationLog(
      userId,
      item.automation_id,
      "info",
      `Envoi à ${label} reporté à ${when} (hors fenêtre d'envoi).`
    );
  }
}

async function processSendQueueForUser(userId: number, limit: number): Promise<number> {
  if ((await countOutboundToday(userId)) >= (await getEffectiveOutboundLimit(userId))) return 0;

  let sent = 0;
  const items = await getDueQueueItems(userId, limit);

  for (const item of items) {
    const quiet = await quietHoursForItem(userId, item);
    if (isQuietHours(quiet.start, quiet.end) && !bypassQuietHours(item)) {
      await rescheduleQuiet(userId, item, quiet.end);
      continue;
    }
    if ((await countOutboundToday(userId)) >= (await getEffectiveOutboundLimit(userId))) break;

    // Opener campagne : conversation neuve AVANT le gate anti-spam (isolation par automation_id)
    const isCampaignOpener = item.automation_id != null && item.sequence_id == null;
    if (isCampaignOpener) {
      const { beginFreshCampaignConversation } = await import("./db.js");
      await beginFreshCampaignConversation(userId, item.recipient, item.automation_id!);
    }

    // Sécurité : jamais 2 sortants d'affilée sans réponse — scopé à la campagne
    const gate = await shouldBlockOutboundWhileAwaitingReply(userId, item);
    if (gate.block) {
      await markQueueFailed(userId, item.id, gate.reason || "En attente de réponse");
      console.warn(
        `🛑 Queue #${item.id} bloquée (${chatIdToDisplay(item.recipient)}): ${gate.reason}`
      );
      if (item.automation_id) {
        await addAutomationLog(
          userId,
          item.automation_id,
          "warning",
          `Envoi bloqué pour ${item.recipient_label || chatIdToDisplay(item.recipient)} — un message est déjà parti, on attend la réponse.`
        );
      }
      continue;
    }

    try {
      if (item.media_url && item.media_type) {
        await sendWhatsAppMedia(userId, item.recipient, {
          url: item.media_url,
          type: item.media_type as "image" | "document" | "audio",
          caption: item.message ?? undefined,
        }, {
          enableAutoReply: item.automation_id != null,
          automationId: item.automation_id,
        });
        if (item.automation_id != null) {
          try {
            const { setContactAutoReply, saveContact } = await import("./db.js");
            await setContactAutoReply(userId, item.recipient, true);
            await saveContact(userId, {
              phone: item.recipient,
              status: "en_conversation",
              autoReply: true,
            });
          } catch {
            /* best effort */
          }
        }
      } else if (item.message) {
        // Conserver / renforcer auto_reply pour les envois de campagne
        let outboundGap: import("./anti-ban.js").OutboundGapOpts | undefined;
        if (item.automation_id != null) {
          try {
            const auto = await getAutomation(userId, item.automation_id);
            const total =
              (auto?.stats.pending ?? 0) + (auto?.stats.contacted ?? 0);
            outboundGap = {
              profile: "campaign",
              minDelaySeconds: auto?.config.minDelaySeconds,
              maxDelaySeconds: auto?.config.maxDelaySeconds,
              prospectCount: total > 0 ? total : undefined,
            };
          } catch {
            outboundGap = { profile: "campaign" };
          }
        }
        await sendWhatsAppMessage(userId, item.recipient, item.message, {
          enableAutoReply: item.automation_id != null,
          outboundProfile: item.automation_id != null ? "campaign" : undefined,
          outboundGap,
          automationId: item.automation_id,
        });
      } else {
        await markQueueFailed(userId, item.id, "Message ou média manquant");
        continue;
      }
      await markQueueSent(userId, item.id);
      sent++;
      console.log(`📤 Queue #${item.id} → ${chatIdToDisplay(item.recipient)}`);
      if (item.automation_id) {
        const label = item.recipient_label || chatIdToDisplay(item.recipient);
        await addAutomationLog(userId, item.automation_id, "success", `Message envoyé à ${label}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markQueueFailed(userId, item.id, msg);
      if (item.automation_id) {
        await addAutomationLog(
          userId,
          item.automation_id,
          "error",
          `Échec envoi à ${chatIdToDisplay(item.recipient)} : ${msg.slice(0, 160)}`
        );
      }
    }
  }

  return sent;
}

export async function processSendQueue(limit = 2): Promise<number> {
  if (queueRunning) return 0;

  queueRunning = true;
  let sent = 0;

  try {
    const userIds = await listActiveUserIds();
    for (const userId of userIds) {
      try {
        sent += await processSendQueueForUser(userId, limit);
      } catch (err) {
        console.error(`📤 Send-queue user ${userId} échoué:`, err);
      }
    }
  } finally {
    queueRunning = false;
  }

  return sent;
}

export { cancelPendingSendQueue };
