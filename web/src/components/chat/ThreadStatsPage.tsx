import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CampaignCharts } from '@/components/automation/CampaignCharts';
import { CampaignStatusToggle } from '@/components/automation/CampaignStatusToggle';
import { fetchThreadCampaign, type AutomationDetail } from '@/lib/api';
import { goalAwareStatCards, outreachMetrics, TARGET_META, TARGET_ORDER } from '@/lib/campaign-metrics';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<string, string> = {
  group_prospect: 'Prospection groupe',
  contact_prospect: 'Prospection contacts',
  keyword_sales: 'Vente / support mots-clés',
  custom_followup: 'Suivi personnalisé',
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

type ThreadStatsPageProps = {
  threadId: number;
};

export function ThreadStatsPage({ threadId }: ThreadStatsPageProps) {
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
  const config = (a?.config ?? {}) as {
    closingGoal?: string;
    productName?: string;
    mode?: string;
  };
  const goalPack = a
    ? goalAwareStatCards({
        type: a.type,
        closingGoal: config.closingGoal,
        productName: config.productName || a.name,
        stats: stats as Record<string, number>,
      })
    : null;
  const counts = TARGET_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = targets.filter((t) => t.status === s).length;
    return acc;
  }, {});
  const totalTargets = targets.length;
  const isOutbound = a?.type === 'group_prospect' || a?.type === 'contact_prospect';

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="brand-radial">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="font-serif text-2xl font-light text-text-100">Statistiques</h1>
              <p className="mt-1 text-sm text-text-400">
                Indicateurs adaptés à l’objectif de cette campagne uniquement.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-sm text-text-300 transition hover:bg-bg-200"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Actualiser
            </button>
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          {loading && !a && (
            <div className="mt-6 space-y-3">
              <div className="panel h-28 animate-pulse" />
              <div className="panel h-48 animate-pulse" />
            </div>
          )}

          {a && goalPack && (
            <div className="mt-6 space-y-5">
              <header className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <h2 className="text-lg font-medium text-text-100">{a.name}</h2>
                  <p className="mt-1 text-sm text-text-500">
                    {TYPE_LABELS[a.type] || a.type} · {a.status} · {fmtTime(a.created_at)}
                  </p>
                  <p className="mt-2 text-sm text-brand">
                    {goalPack.title}
                    <span className="text-text-500"> — {goalPack.subtitle}</span>
                  </p>
                </div>
                <CampaignStatusToggle
                  automationId={a.id}
                  status={a.status}
                  onUpdated={load}
                />
              </header>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {goalPack.cards.map((card) => (
                  <div key={card.key} className="panel-inset p-4">
                    <span className="text-xs text-text-500">{card.label}</span>
                    <p
                      className={cn(
                        'mt-1 text-2xl font-semibold',
                        card.accent === 'success' && 'text-emerald-600',
                        card.accent === 'warn' && 'text-amber-600',
                        (!card.accent || card.accent === 'default') && 'text-text-100',
                      )}
                    >
                      {card.value}
                    </p>
                    {card.hint && <p className="mt-1 text-[11px] text-text-500">{card.hint}</p>}
                  </div>
                ))}
              </div>

              {isOutbound && totalTargets > 0 && (
                <CampaignCharts
                  counts={counts}
                  totalTargets={totalTargets}
                  reached={metrics.reached}
                  answered={metrics.answered}
                  interested={
                    Number(stats.conversions ?? 0) > 0 &&
                    (config.closingGoal === 'appointment' ||
                      config.closingGoal === 'payment' ||
                      config.closingGoal === 'link')
                      ? Number(stats.conversions)
                      : metrics.interested
                  }
                  funnelLabels={goalPack.funnelLabels}
                />
              )}

              {targets.length > 0 && (
                <section className="panel p-5">
                  <h3 className="text-sm font-semibold text-text-200">Cibles ({targets.length})</h3>
                  <div className="mt-3 space-y-1.5">
                    {targets.slice(0, 40).map((t) => {
                      const meta = TARGET_META[t.status] ?? { label: t.status, color: '#94a3b8' };
                      return (
                        <div
                          key={t.target_id}
                          className="flex items-center justify-between rounded-lg bg-bg-0 px-3 py-2 text-sm"
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
                <section className="panel p-5">
                  <h3 className="text-sm font-semibold text-text-200">Journal</h3>
                  <div className="mt-3 space-y-1.5">
                    {logs.slice(0, 25).map((l, i) => (
                      <p key={i} className="text-sm text-text-400">
                        <span className="text-xs text-text-500">{fmtTime(l.created_at)} · </span>
                        {l.message}
                      </p>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {!loading && !a && !error && (
            <p className="mt-8 text-sm text-text-500">
              Aucune campagne liée à cette automatisation pour le moment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
