import {
  advanceSequence,
  cancelSequencesForContact,
  createContactSequence,
  enqueueSend,
  getContactChatHistory,
  listDueSequences,
  type ContactSequence,
  type SequenceStep,
} from "./db.js";
import { listActiveUserIds } from "./users.js";

async function processDueSequencesForUser(userId: number): Promise<number> {
  const due = await listDueSequences(userId, 15);
  let queued = 0;

  for (const seq of due) {
    const step = seq.steps[seq.current_step];
    if (!step) {
      await advanceSequence(userId, seq.id);
      continue;
    }

    if (step.condition === "no_reply") {
      const history = await getContactChatHistory(userId, seq.contact_phone, 5);
      const hasReply = history.some((m) => m.direction === "entrant");
      if (hasReply) {
        await cancelSequencesForContact(userId, seq.contact_phone);
        continue;
      }
    }

    await enqueueSend(userId, {
      recipient: seq.contact_phone,
      message: step.message,
      mediaUrl: step.mediaUrl,
      mediaType: step.mediaType,
      priority: seq.automation_id ? 6 : 5,
      automationId: seq.automation_id ?? undefined,
      sequenceId: seq.id,
    });
    await advanceSequence(userId, seq.id);
    queued++;
  }

  return queued;
}

export async function processDueSequences(): Promise<number> {
  const userIds = await listActiveUserIds();
  let queued = 0;
  for (const userId of userIds) {
    try {
      queued += await processDueSequencesForUser(userId);
    } catch (err) {
      console.error(`Séquences user ${userId} échouées:`, err);
    }
  }
  return queued;
}

export async function startSequenceForContact(
  userId: number,
  input: {
    contactPhone: string;
    name: string;
    steps: SequenceStep[];
    automationId?: number;
  }
): Promise<ContactSequence> {
  return createContactSequence(userId, input);
}
