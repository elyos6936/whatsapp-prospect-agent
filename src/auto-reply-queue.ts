/**
 * Auto-reply **indépendant par prospect** :
 * chaque conversation reçoit sa réponse ~60 s après SON message,
 * sans attendre les autres prospects (pas de file FIFO globale).
 *
 * Même chat qui renvoie avant l'envoi → timer reset + dernier texte (debounce).
 */
export type AutoReplyJob = {
  userId: number;
  chatId: string;
  senderName: string;
  text: string;
  enqueuedAt: number;
};

type AutoReplyProcessor = (job: AutoReplyJob) => Promise<void>;

/** Délai cible après le message du prospect (moyenne ~60 s). */
const REPLY_DELAY_MIN_MS = 55_000;
const REPLY_DELAY_MAX_MS = 65_000;

type Pending = AutoReplyJob & { process: AutoReplyProcessor };

const pendingByChat = new Map<string, Pending>();
const timersByChat = new Map<string, ReturnType<typeof setTimeout>>();

function chatKey(userId: number, chatId: string): string {
  return `${userId}:${chatId}`;
}

function pickReplyDelayMs(): number {
  return (
    REPLY_DELAY_MIN_MS +
    Math.floor(Math.random() * (REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS + 1))
  );
}

/**
 * Programme une réponse ~60 s après ce message.
 * Indépendant des autres chats. Nouveau message du même prospect = reset du timer.
 */
export function enqueueAutoReply(
  job: Omit<AutoReplyJob, "enqueuedAt">,
  process: AutoReplyProcessor
): void {
  const key = chatKey(job.userId, job.chatId);
  const prev = timersByChat.get(key);
  if (prev) clearTimeout(prev);

  const delay = pickReplyDelayMs();
  const pending: Pending = {
    ...job,
    enqueuedAt: Date.now(),
    process,
  };
  pendingByChat.set(key, pending);

  console.log(
    `⏳ Réponse auto → ${job.senderName} dans ~${Math.round(delay / 1000)}s (indépendant des autres)`
  );

  const timer = setTimeout(() => {
    timersByChat.delete(key);
    const payload = pendingByChat.get(key);
    pendingByChat.delete(key);
    if (!payload) return;
    void payload.process(payload).catch((err) => {
      console.error(
        `[auto-reply] échec ${payload.senderName}:`,
        err instanceof Error ? err.message : err
      );
    });
  }, delay);

  timersByChat.set(key, timer);
}

/** Nb de réponses encore programmées pour un user (debug). */
export function getAutoReplyQueueSize(userId: number): number {
  let n = 0;
  for (const key of pendingByChat.keys()) {
    if (key.startsWith(`${userId}:`)) n++;
  }
  return n;
}
