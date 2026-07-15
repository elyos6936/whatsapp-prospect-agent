import {
  advanceSequence,
  cancelSequencesForContact,
  createContactSequence,
  enqueueSend,
  getAutomation,
  getContactChatHistory,
  isContactBlocked,
  listDueSequences,
  postponeSequence,
  repairStuckSequences,
  type ContactSequence,
  type SequenceStep,
} from "./db.js";
import { listActiveUserIds } from "./users.js";

function defaultNurtureSteps(guide?: string): SequenceStep[] {
  const soft =
    guide?.trim().slice(0, 120) ||
    "Je voulais juste savoir si tu avais encore une question 🙂";
  return [
    {
      delayDays: 2,
      message: soft,
      condition: "stale_after_reply",
    },
    {
      delayDays: 3,
      message: "Toujours dispo si tu veux en discuter — dis-moi simplement 🙂",
      condition: "stale_after_reply",
    },
  ];
}

async function startNurtureAfterReply(
  userId: number,
  seq: ContactSequence
): Promise<void> {
  if (!seq.automation_id) return;
  if (seq.name.includes("Nurture")) return;
  const auto = await getAutomation(userId, seq.automation_id);
  if (!auto || auto.status !== "active") return;
  if (auto.config.enableAutoReply === false) return;

  await createContactSequence(userId, {
    contactPhone: seq.contact_phone,
    name: `Nurture — ${auto.name}`,
    automationId: auto.id,
    steps: defaultNurtureSteps(
      auto.config.followUpInstructions || auto.config.conversationGuide
    ),
  });
}

async function processDueSequencesForUser(userId: number): Promise<number> {
  const repaired = await repairStuckSequences(userId);
  if (repaired > 0) {
    console.log(`🔧 ${repaired} séquence(s) relance réparée(s) (user ${userId})`);
  }

  const due = await listDueSequences(userId, 15);
  let queued = 0;

  for (const seq of due) {
    const step = seq.steps[seq.current_step];
    if (!step) {
      await advanceSequence(userId, seq.id);
      continue;
    }

    if (await isContactBlocked(userId, seq.contact_phone)) {
      await cancelSequencesForContact(userId, seq.contact_phone);
      continue;
    }

    if (step.condition === "no_reply") {
      const history = await getContactChatHistory(userId, seq.contact_phone, 8);
      const hasReply = history.some((m) => m.direction === "entrant");
      if (hasReply) {
        await cancelSequencesForContact(userId, seq.contact_phone);
        try {
          await startNurtureAfterReply(userId, seq);
        } catch (err) {
          console.error("Nurture post-réponse échoué:", err);
        }
        continue;
      }
    }

    if (step.condition === "stale_after_reply") {
      const history = await getContactChatHistory(userId, seq.contact_phone, 10);
      const last = history[history.length - 1];
      if (last?.direction === "entrant") {
        await postponeSequence(userId, seq.id, 2);
        continue;
      }
      const hasInbound = history.some((m) => m.direction === "entrant");
      if (!hasInbound) {
        await advanceSequence(userId, seq.id);
        continue;
      }
      if (seq.automation_id) {
        const auto = await getAutomation(userId, seq.automation_id);
        if (!auto || auto.status !== "active") {
          await cancelSequencesForContact(userId, seq.contact_phone);
          continue;
        }
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
