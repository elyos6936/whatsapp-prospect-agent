/**
 * Espacement anti-blocage proportionnel au volume de prospects.
 * Peu de prospects → délais courts ; beaucoup → délais plus sûrs.
 */
export function recommendOutboundGaps(prospectCount: number): {
  minDelaySeconds: number;
  maxDelaySeconds: number;
} {
  const n = Math.max(0, Math.floor(Number(prospectCount) || 0));
  if (n <= 5) return { minDelaySeconds: 20, maxDelaySeconds: 40 };
  if (n <= 15) return { minDelaySeconds: 30, maxDelaySeconds: 60 };
  if (n <= 40) return { minDelaySeconds: 45, maxDelaySeconds: 90 };
  if (n <= 100) return { minDelaySeconds: 60, maxDelaySeconds: 150 };
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
