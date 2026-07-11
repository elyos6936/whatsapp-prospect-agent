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

export async function processDueSequences(): Promise<number> {
  const due = await listDueSequences(15);
  let queued = 0;

  for (const seq of due) {
    const step = seq.steps[seq.current_step];
    if (!step) {
      await advanceSequence(seq.id);
      continue;
    }

    if (step.condition === "no_reply") {
      const history = await getContactChatHistory(seq.contact_phone, 5);
      const hasReply = history.some((m) => m.direction === "entrant");
      if (hasReply) {
        await cancelSequencesForContact(seq.contact_phone);
        continue;
      }
    }

    await enqueueSend({
      recipient: seq.contact_phone,
      message: step.message,
      mediaUrl: step.mediaUrl,
      mediaType: step.mediaType,
      priority: seq.automation_id ? 6 : 5,
      automationId: seq.automation_id ?? undefined,
      sequenceId: seq.id,
    });
    await advanceSequence(seq.id);
    queued++;
  }

  return queued;
}

export async function startSequenceForContact(input: {
  contactPhone: string;
  name: string;
  steps: SequenceStep[];
  automationId?: number;
}): Promise<ContactSequence> {
  return createContactSequence(input);
}
