/** Miroir front des niveaux outreach (src/outreach-level.ts). */

export type OutreachLevel = 1 | 2 | 3 | 4 | 5;

export const LEVEL_DAILY_CAPS: Record<
  OutreachLevel,
  { inbound: number; outbound: number }
> = {
  1: { inbound: 200, outbound: 100 },
  2: { inbound: 250, outbound: 150 },
  3: { inbound: 300, outbound: 200 },
  4: { inbound: 350, outbound: 250 },
  5: { inbound: 400, outbound: 300 },
};

/** Messages sortants cumulés pour atteindre le niveau. */
export const LEVEL_MIN_SENT: Record<OutreachLevel, number> = {
  1: 0,
  2: 1000,
  3: 2000,
  4: 3000,
  5: 4000,
};

export const OUTREACH_LEVELS: OutreachLevel[] = [1, 2, 3, 4, 5];

export function clampOutreachLevel(n: number | null | undefined): OutreachLevel {
  if (n == null || !Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.floor(n))) as OutreachLevel;
}

export function messagesUntilNextLevel(totalMessagesSent: number): number | null {
  const n = Math.max(0, Math.floor(Number(totalMessagesSent) || 0));
  if (n >= 4000) return null;
  if (n >= 3000) return 4000 - n;
  if (n >= 2000) return 3000 - n;
  if (n >= 1000) return 2000 - n;
  return 1000 - n;
}
