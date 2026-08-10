/**
 * Niveaux d'outreach — mapping pur (pas de DB).
 * Niveau = lifetime messages sortants counts_toward_quota.
 * Plafonds jour = nouveaux fils (entrant / sortant), pas chaque message d'un fil ouvert.
 */

export type OutreachLevel = 1 | 2 | 3 | 4 | 5;

export type SubscriptionStatus = "trial" | "active" | "expired";

/** Nouvelles conversations (fils) à vie pendant l’essai — pas un plafond journalier. */
export const TRIAL_MAX_CONVERSATIONS = 50;

/**
 * Pendant l’essai : nombre de groupes WhatsApp distincts dont on peut extraire
 * les membres (get_group_members / prospection groupe) par jour calendaire local.
 */
export const TRIAL_MAX_GROUP_EXTRACTS_PER_DAY = 1;

/** Essai gratuit en jours (aligné landing / pricing). */
export const TRIAL_DAYS = 3;

/** Durée abonnement après paiement Money Fusion. */
export const SUBSCRIPTION_DAYS_MONTHLY = 30;
export const SUBSCRIPTION_DAYS_ANNUAL = 365;

/** Seuils inclusifs : [minMessages, level] */
const LEVEL_THRESHOLDS: Array<{ min: number; level: OutreachLevel }> = [
  { min: 4000, level: 5 },
  { min: 3000, level: 4 },
  { min: 2000, level: 3 },
  { min: 1000, level: 2 },
  { min: 0, level: 1 },
];

/** Plafonds journaliers (nouveaux fils) par niveau. */
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

export function outreachLevelFromTotalSent(totalMessagesSent: number): OutreachLevel {
  const n = Math.max(0, Math.floor(Number(totalMessagesSent) || 0));
  for (const row of LEVEL_THRESHOLDS) {
    if (n >= row.min) return row.level;
  }
  return 1;
}

export function dailyCapsForLevel(level: OutreachLevel): { inbound: number; outbound: number } {
  return LEVEL_DAILY_CAPS[level] ?? LEVEL_DAILY_CAPS[1];
}

/** Messages restants avant le prochain niveau (null si déjà au plafond). */
export function messagesUntilNextLevel(totalMessagesSent: number): number | null {
  const n = Math.max(0, Math.floor(Number(totalMessagesSent) || 0));
  if (n >= 4000) return null;
  if (n >= 3000) return 4000 - n;
  if (n >= 2000) return 3000 - n;
  if (n >= 1000) return 2000 - n;
  return 1000 - n;
}
