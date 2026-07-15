import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { CampaignCharts } from '@/components/automation/CampaignCharts';
import { fetchThreadCampaign, type AutomationDetail } from '@/lib/api';
import { outreachMetrics, pct, TARGET_META, TARGET_ORDER } from '@/lib/campaign-metrics';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<string, string> = {
  group_prospect: 'Prospection groupe',
  contact_prospect: 'Prospection contacts',
  keyword_sales: 'Vente sur mots-clés',
  custom_followup: 'Suivi personnalisé',
};

function isOutboundType(type: string): boolean {
  return type === 'group_prospect' || type === 'contact_prospect';
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

type ThreadStatsPanelProps = {
  threadId: number;
  onClose: () => void;
};

export function ThreadStatsPanel({ threadId, onClose }: ThreadStatsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AutomationDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchThreadCampaign(threadId);
      setDetail(data.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les stats');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const a = detail?.automation;
  const stats = a?.stats ?? {};
  const targets = detail?.targets ?? [];
  const logs = detail?.logs ?? [];
  const metrics = outreachMetrics(stats as Record<string, number>);
  const counts = TARGET_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = targets.filter((t) => t.status === s).length;
    return acc;
  }, {});
  const totalTargets = targets.length;
  const handled = Number(stats.messagesHandled ?? 0);
  const conversions = Number(stats.conversions ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l border-black/[0.08] bg-bg-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
          <h2 className="text-sm font-semibold text-text-100">Statistiques de la campagne</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg p-2 text-text-400 hover:bg-bg-200"
              aria-label="Actualiser"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-text-400 hover:bg-bg-200"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {loading && !a && (
            <div className="space-y-3">
              <div className="panel h-24 animate-pulse" />
              <div className="panel h-40 animate-pulse" />
            </div>
          )}
          {a && (
            <div className="space-y-4">
              <header className="panel p-4">
                <h3 className="font-medium text-text-100">{a.name}</h3>
                <p className="mt-1 text-xs text-text-500">
                  {TYPE_LABELS[a.type] || a.type} · {a.status} · {fmtTime(a.created_at)}
                </p>
              </header>

              <div className="grid grid-cols-2 gap-3">
                {isOutboundType(a.type) ? (
                  <>
                    <div className="panel-inset p-3">
                      <span className="text-xs text-text-500">Atteints</span>
                      <p className="mt-1 text-xl font-semibold text-text-100">{metrics.reached}</p>
                    </div>
                    <div className="panel-inset p-3">
                      <span className="text-xs text-text-500">Réponses</span>
                      <p className="mt-1 text-xl font-semibold text-text-100">{metrics.answered}</p>
                    </div>
                    <div className="panel-inset p-3">
                      <span className="text-xs text-text-500">Taux</span>
                      <p className="mt-1 text-xl font-semibold text-text-100">
                        {metrics.rate != null ? `${metrics.rate}%` : '—'}
                      </p>
                    </div>
                    <div className="panel-inset p-3">
                      <span className="text-xs text-text-500">Intéressés</span>
                      <p className="mt-1 text-xl font-semibold text-emerald-600">{metrics.interested}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="panel-inset p-3">
                      <span className="text-xs text-text-500">Messages</span>
                      <p className="mt-1 text-xl font-semibold text-text-100">{handled}</p>
                    </div>
                    <div className="panel-inset p-3">
                      <span className="text-xs text-text-500">Conversions</span>
                      <p className="mt-1 text-xl font-semibold text-text-100">
                        {conversions}
                        {handled ? ` (${pct(conversions, handled)}%)` : ''}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {isOutboundType(a.type) && totalTargets > 0 && (
                <CampaignCharts
                  counts={counts}
                  totalTargets={totalTargets}
                  reached={metrics.reached}
                  answered={metrics.answered}
                  interested={metrics.interested}
                />
              )}

              {targets.length > 0 && (
                <section className="panel p-4">
                  <h4 className="text-sm font-semibold text-text-200">Cibles ({targets.length})</h4>
                  <div className="mt-2 space-y-1">
                    {targets.slice(0, 20).map((t) => {
                      const meta = TARGET_META[t.status] ?? { label: t.status, color: '#94a3b8' };
                      return (
                        <div
                          key={t.target_id}
                          className="flex items-center justify-between rounded-lg bg-bg-0 px-2.5 py-1.5 text-sm"
                        >
                          <span className="truncate text-text-300">{t.target_label || t.target_id}</span>
                          <span className="ml-2 shrink-0 text-[11px]" style={{ color: meta.color }}>
                            {meta.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {logs.length > 0 && (
                <section className="panel p-4">
                  <h4 className="text-sm font-semibold text-text-200">Journal</h4>
                  <div className="mt-2 space-y-1">
                    {logs.slice(0, 10).map((l, i) => (
                      <p key={i} className="text-xs text-text-400">
                        <span className="text-text-500">{fmtTime(l.created_at)} · </span>
                        {l.message}
                      </p>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
