/**
 * Anti-ban WhatsApp — rythme humain, warmup, plafonds.
 * Objectif : WhatsApp ne doit jamais « sentir » l'automatisation.
 */

export const ANTI_BAN = {
  /** Espacement entre 2 envois (par utilisateur) */
  minGapMs: 60_000,
  maxGapMs: 180_000,
  /** Présence « en train d'écrire » — court = plus naturel */
  presenceMinMs: 1_500,
  presenceMaxMs: 6_000,
  /** Delay typing intégré aux envois texte Evolution */
  textDelayMaxMs: 6_000,
  /** Soft caps warmup (jours depuis création compte) */
  warmupCaps: [10, 12, 15, 18, 22, 25, 30] as const,
  /** Max openers / jour / campagne si non précisé */
  defaultCampaignMaxPerDay: 15,
  /** Relances par défaut si absentes */
  defaultRelanceDelaysDays: [1, 3] as number[],
  defaultRelanceHour: 10,
  defaultRelanceMessages: [
    "Je me permets de revenir vers vous 🙂 Est-ce que ça vous parle toujours ?",
    "Dernier message de ma part — dites-moi juste oui ou non, j'adapte 🙂",
  ],
} as const;

const lastOutboundByUser = new Map<number, number>();
const nextGapByUser = new Map<number, number>();

function clampGapMs(minSec?: number, maxSec?: number): { min: number; max: number } {
  const min = Math.max(
    ANTI_BAN.minGapMs,
    Number.isFinite(minSec) && (minSec as number) > 0 ? Math.round((minSec as number) * 1000) : ANTI_BAN.minGapMs
  );
  const maxRaw = Number.isFinite(maxSec) && (maxSec as number) > 0 ? Math.round((maxSec as number) * 1000) : ANTI_BAN.maxGapMs;
  const max = Math.max(min, Math.min(Math.max(maxRaw, ANTI_BAN.maxGapMs), 300_000));
  return { min, max: Math.max(min + 5_000, max) };
}

/** Attend l'espacement anti-spam pour CET utilisateur. */
export async function waitOutboundSpacingForUser(
  userId: number,
  opts?: { minDelaySeconds?: number; maxDelaySeconds?: number }
): Promise<void> {
  const last = lastOutboundByUser.get(userId) ?? 0;
  const gap = nextGapByUser.get(userId) ?? 0;
  if (!last || !gap) return;
  const wait = last + gap - Date.now();
  if (wait <= 0) return;
  console.log(`⏳ Espacement anti-spam (user ${userId}) : ${Math.ceil(wait / 1000)}s…`);
  await new Promise((r) => setTimeout(r, wait));
  void opts;
}

/** Enregistre un envoi et tire le prochain gap aléatoire (humain). */
export function markOutboundSentForUser(
  userId: number,
  opts?: { minDelaySeconds?: number; maxDelaySeconds?: number }
): void {
  const { min, max } = clampGapMs(opts?.minDelaySeconds, opts?.maxDelaySeconds);
  lastOutboundByUser.set(userId, Date.now());
  nextGapByUser.set(userId, min + Math.floor(Math.random() * (max - min + 1)));
}

/** Clamp durée de présence typing. */
export function clampPresenceMs(ms: number): number {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 3_000;
  return Math.min(Math.max(Math.round(n), ANTI_BAN.presenceMinMs), ANTI_BAN.presenceMaxMs);
}

/** Clamp delay Evolution text options. */
export function clampTextDelayMs(ms: number | undefined): number | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(Math.round(ms), 500), ANTI_BAN.textDelayMaxMs);
}

/**
 * Plafond journalier warmup : comptes récents = volumes bas.
 * daysSinceCreation 0 → index 0, etc.
 */
export function warmupDailyCap(daysSinceCreation: number): number {
  const d = Math.max(0, Math.floor(daysSinceCreation));
  const caps = ANTI_BAN.warmupCaps;
  return caps[Math.min(d, caps.length - 1)];
}

/** Messages de relance par défaut (sans crochets). */
export function defaultRelanceConfig(): {
  enabled: true;
  delaysDays: number[];
  hour: number;
  messages: string[];
} {
  return {
    enabled: true,
    delaysDays: [...ANTI_BAN.defaultRelanceDelaysDays],
    hour: ANTI_BAN.defaultRelanceHour,
    messages: [...ANTI_BAN.defaultRelanceMessages],
  };
}
