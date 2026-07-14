export const TARGET_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente', color: '#94a3b8' },
  contacted: { label: 'Sans réponse', color: '#2057ce' },
  replied: { label: 'Réponses', color: '#0ea5e9' },
  interested: { label: 'Intéressés', color: '#10b981' },
  stopped: { label: 'Arrêtés', color: '#f59e0b' },
  error: { label: 'Erreurs', color: '#ef4444' },
};

export const TARGET_ORDER = [
  'interested',
  'replied',
  'contacted',
  'pending',
  'stopped',
  'error',
] as const;

/** Métriques réelles : « contacté » DB = encore sans réponse ; « atteints » = tous ceux touchés. */
export function outreachMetrics(stats?: Record<string, number | string | undefined> | null) {
  const pending = Number(stats?.pending ?? 0);
  const waitingReply = Number(stats?.contacted ?? 0);
  const replied = Number(stats?.replied ?? 0);
  const interested = Number(stats?.interested ?? 0);
  const stopped = Number(stats?.stopped ?? 0);
  const errors = Number(stats?.errors ?? 0);
  const reached = waitingReply + replied + interested + stopped;
  const answered = replied + interested;
  const rate = reached > 0 ? Math.round((answered / reached) * 100) : null;
  const interestRate = answered > 0 ? Math.round((interested / answered) * 100) : null;
  return {
    pending,
    waitingReply,
    replied,
    interested,
    stopped,
    errors,
    reached,
    answered,
    rate,
    interestRate,
  };
}

export function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
