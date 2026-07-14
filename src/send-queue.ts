import {
  addAutomationLog,
  cancelPendingSendQueue,
  countOutboundToday,
  formatLocalDateTime,
  getDueQueueItems,
  getEffectiveOutboundLimit,
  markQueueFailed,
  markQueueSent,
  rescheduleSendQueueItem,
  type QueueItem,
} from "./db.js";
import { chatIdToDisplay, sendWhatsAppMedia, sendWhatsAppMessage } from "./evolutionapi.js";
import { listActiveUserIds } from "./users.js";

const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 7;
/** Priorité campagne (openers) : envoi immédiat même hors horaires « calmes ». */
const CAMPAIGN_OPENER_MIN_PRIORITY = 6;

let queueRunning = false;

function isQuietHours(start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  const hour = new Date().getHours();
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function bypassQuietHours(item: QueueItem): boolean {
  return (item.priority ?? 0) >= CAMPAIGN_OPENER_MIN_PRIORITY;
}

async function rescheduleQuiet(userId: number, item: QueueItem): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 30, 0, 0);
  const when = formatLocalDateTime(tomorrow);
  await rescheduleSendQueueItem(userId, item.id, when);
  const label = item.recipient_label || chatIdToDisplay(item.recipient);
  console.log(`🌙 Queue #${item.id} → ${label} reporté à ${when} (heures calmes)`);
  if (item.automation_id) {
    await addAutomationLog(
      userId,
      item.automation_id,
      "info",
      `Envoi à ${label} reporté à ${when} (heures calmes 22h–7h).`
    );
  }
}

async function processSendQueueForUser(userId: number, limit: number): Promise<number> {
  if ((await countOutboundToday(userId)) >= (await getEffectiveOutboundLimit(userId))) return 0;

  let sent = 0;
  const items = await getDueQueueItems(userId, limit);

  for (const item of items) {
    if (isQuietHours() && !bypassQuietHours(item)) {
      await rescheduleQuiet(userId, item);
      continue;
    }
    if ((await countOutboundToday(userId)) >= (await getEffectiveOutboundLimit(userId))) break;

    try {
      if (item.media_url && item.media_type) {
        await sendWhatsAppMedia(userId, item.recipient, {
          url: item.media_url,
          type: item.media_type as "image" | "document" | "audio",
          caption: item.message ?? undefined,
        });
      } else if (item.message) {
        await sendWhatsAppMessage(userId, item.recipient, item.message, { enableAutoReply: false });
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
