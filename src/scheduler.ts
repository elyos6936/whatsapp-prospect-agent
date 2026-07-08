import {
  getDueScheduledMessages,
  markScheduledFailed,
  markScheduledSent,
} from "./db.js";
import { chatIdToDisplay, sendWhatsAppMessage } from "./greenapi.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function processDue(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const due = getDueScheduledMessages(5);
    for (const job of due) {
      try {
        await sendWhatsAppMessage(job.recipient, job.message);
        markScheduledSent(job.id);

        const label = job.recipient_label || chatIdToDisplay(job.recipient);
        console.log(`⏰ Scheduled #${job.id} envoyé → ${label}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        markScheduledFailed(job.id, msg);
        console.error(`⏰ Scheduled #${job.id} échoué:`, msg);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler(intervalMs = 5000): void {
  if (intervalHandle) return;
  console.log(`⏰ Planificateur de messages actif (toutes les ${intervalMs / 1000}s)`);
  intervalHandle = setInterval(() => {
    void processDue();
  }, intervalMs);
  void processDue();
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
