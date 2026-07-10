import {
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
  db,
  formatLocalDateTime,
  getDueQueueItems,
  markQueueFailed,
  markQueueSent,
  type QueueItem,
} from "./db.js";
import { chatIdToDisplay, sendWhatsAppMedia, sendWhatsAppMessage } from "./greenapi.js";

const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 7;

function isQuietHours(start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  const hour = new Date().getHours();
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function rescheduleQuiet(item: QueueItem): void {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 30, 0, 0);
  db.prepare(`UPDATE send_queue SET send_at = ? WHERE id = ?`).run(formatLocalDateTime(tomorrow), item.id);
}

export async function processSendQueue(limit = 2): Promise<number> {
  if (countOutboundToday() >= DAILY_OUTBOUND_LIMIT) return 0;

  const items = getDueQueueItems(limit);
  let sent = 0;

  for (const item of items) {
    if (isQuietHours()) {
      rescheduleQuiet(item);
      continue;
    }
    if (countOutboundToday() >= DAILY_OUTBOUND_LIMIT) break;

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
        markQueueFailed(item.id, "Message ou média manquant");
        continue;
      }
      markQueueSent(item.id);
      sent++;
      console.log(`📤 Queue #${item.id} → ${chatIdToDisplay(item.recipient)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markQueueFailed(item.id, msg);
    }
  }
  return sent;
}
