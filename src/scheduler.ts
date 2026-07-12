import {
  getDueScheduledMessages,
  markScheduledFailed,
  markScheduledSent,
} from "./db.js";
import { chatIdToDisplay, sendWhatsAppMessage } from "./evolutionapi.js";
import { listActiveUserIds } from "./users.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function processDueForUser(userId: number): Promise<void> {
  const due = await getDueScheduledMessages(userId, 5);
  for (const job of due) {
    try {
      await sendWhatsAppMessage(userId, job.recipient, job.message);
      await markScheduledSent(userId, job.id);

      const label = job.recipient_label || chatIdToDisplay(job.recipient);
      console.log(`⏰ Scheduled #${job.id} envoyé → ${label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markScheduledFailed(userId, job.id, msg);
      console.error(`⏰ Scheduled #${job.id} échoué:`, msg);
    }
  }
}

async function processDue(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const userIds = await listActiveUserIds();
    for (const userId of userIds) {
      try {
        await processDueForUser(userId);
      } catch (err) {
        console.error(`⏰ Scheduler user ${userId} échoué:`, err);
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
