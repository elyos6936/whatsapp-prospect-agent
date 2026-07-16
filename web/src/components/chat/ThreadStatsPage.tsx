import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CampaignCharts } from '@/components/automation/CampaignCharts';
import { PlanBoard } from '@/components/chat/PlanBoard';
import { fetchThreadCampaign, type AutomationDetail } from '@/lib/api';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
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
  const counts = TARGET_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = targets.filter((t) => t.status === s).length;
    return acc;
  }, {});
  const totalTargets = targets.length;
  const handled = Number(stats.messagesHandled ?? 0);
  const conversions = Number(stats.conversions ?? 0);
  const visualPlan = (a?.config as { visualPlan?: AutomationVisualPlan } | undefined)?.visualPlan;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="brand-radial">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="font-serif text-2xl font-light text-text-100">Statistiques</h1>
              <p className="mt-1 text-sm text-text-400">
                Campagne liée à cette automatisation — isolation complète des autres fils.
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

          {a && (
            <div className="mt-6 space-y-5">
              <header className="panel flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <h2 className="text-lg font-medium text-text-100">{a.name}</h2>
                  <p className="mt-1 text-sm text-text-500">
                    {TYPE_LABELS[a.type] || a.type} · {a.status} · {fmtTime(a.created_at)}
                  </p>
                </div>
              </header>

              {visualPlan && visualPlan.nodes?.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text-200">Plan de l’automatisation</h3>
                  <PlanBoard plan={visualPlan} className="h-[420px] min-h-[320px]" />
                </section>
              )}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {isOutboundType(a.type) ? (
                  <>
                    <div className="panel-inset p-4">
                      <span className="text-xs text-text-500">Atteints</span>
                      <p className="mt-1 text-2xl font-semibold text-text-100">{metrics.reached}</p>
                    </div>
                    <div className="panel-inset p-4">
                      <span className="text-xs text-text-500">Réponses</span>
                      <p className="mt-1 text-2xl font-semibold text-text-100">{metrics.answered}</p>
                    </div>
                    <div className="panel-inset p-4">
                      <span className="text-xs text-text-500">Taux</span>
                      <p className="mt-1 text-2xl font-semibold text-text-100">
                        {metrics.rate != null ? `${metrics.rate}%` : '—'}
                      </p>
                    </div>
                    <div className="panel-inset p-4">
                      <span className="text-xs text-text-500">Intéressés</span>
                      <p className="mt-1 text-2xl font-semibold text-emerald-600">{metrics.interested}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="panel-inset p-4">
                      <span className="text-xs text-text-500">Messages</span>
                      <p className="mt-1 text-2xl font-semibold text-text-100">{handled}</p>
                    </div>
                    <div className="panel-inset p-4">
                      <span className="text-xs text-text-500">Conversions</span>
                      <p className="mt-1 text-2xl font-semibold text-text-100">
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
        </div>
      </div>
    </div>
  );
}
