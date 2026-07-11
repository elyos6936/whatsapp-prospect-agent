import {
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

const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 7;

let queueRunning = false;

function isQuietHours(start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  const hour = new Date().getHours();
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

async function rescheduleQuiet(item: QueueItem): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 30, 0, 0);
  await rescheduleSendQueueItem(item.id, formatLocalDateTime(tomorrow));
}

export async function processSendQueue(limit = 2): Promise<number> {
  if (queueRunning) return 0;
  if ((await countOutboundToday()) >= (await getEffectiveOutboundLimit())) return 0;

  queueRunning = true;
  let sent = 0;

  try {
    const items = await getDueQueueItems(limit);

    for (const item of items) {
      if (isQuietHours()) {
        await rescheduleQuiet(item);
        continue;
      }
      if ((await countOutboundToday()) >= (await getEffectiveOutboundLimit())) break;

      try {
        if (item.media_url && item.media_type) {
          await sendWhatsAppMedia(item.recipient, {
            url: item.media_url,
            type: item.media_type as "image" | "document" | "audio",
            caption: item.message ?? undefined,
          });
        } else if (item.message) {
          await sendWhatsAppMessage(item.recipient, item.message, { enableAutoReply: false });
        } else {
          await markQueueFailed(item.id, "Message ou média manquant");
          continue;
        }
        await markQueueSent(item.id);
        sent++;
        console.log(`📤 Queue #${item.id} → ${chatIdToDisplay(item.recipient)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markQueueFailed(item.id, msg);
      }
    }
  } finally {
    queueRunning = false;
  }

  return sent;
}

export { cancelPendingSendQueue };
