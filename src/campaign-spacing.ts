/**
 * Espacement anti-blocage proportionnel au volume de prospects.
 * Plancher : 30–60 s (jamais en dessous) ; volume élevé → délais plus longs.
 */
export function recommendOutboundGaps(prospectCount: number): {
  minDelaySeconds: number;
  maxDelaySeconds: number;
} {
  const n = Math.max(0, Math.floor(Number(prospectCount) || 0));
  if (n <= 5) return { minDelaySeconds: 30, maxDelaySeconds: 60 };
  if (n <= 15) return { minDelaySeconds: 40, maxDelaySeconds: 75 };
  if (n <= 40) return { minDelaySeconds: 50, maxDelaySeconds: 90 };
  if (n <= 100) return { minDelaySeconds: 60, maxDelaySeconds: 120 };
  return { minDelaySeconds: 75, maxDelaySeconds: 180 };
}

/** Estime le nb de cibles depuis les args create_automation. */
export function estimateProspectCountFromArgs(args: Record<string, unknown>): number {
  const contacts = Array.isArray(args.contacts) ? args.contacts.length : 0;
  if (contacts > 0) return contacts;
  const maxMembers = Number(args.max_members);
  if (Number.isFinite(maxMembers) && maxMembers > 0) return Math.round(maxMembers);
  return 30; // défaut raisonnable (groupe moyen)
}
