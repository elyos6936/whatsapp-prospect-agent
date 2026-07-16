import { useCallback, useEffect, useState } from 'react';
import { Bot, MessageSquare, Pause, Play, RefreshCw, Users } from 'lucide-react';
import {
  fetchThreadCampaign,
  reloadAutomationMembers,
  updateAutomationStatus,
  type AutomationDetail,
  type AutomationSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { PlanBoard } from '@/components/chat/PlanBoard';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { outreachMetrics } from '@/lib/campaign-metrics';

const TYPE_LABELS: Record<string, string> = {
  group_prospect: 'Prospection groupe',
  contact_prospect: 'Prospection contacts',
  keyword_sales: 'Vente sur mots-clés',
  custom_followup: 'Suivi personnalisé',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  active: 'Active',
  paused: 'En pause',
  completed: 'Terminée',
  failed: 'Échouée',
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

function isOutboundType(type: string): boolean {
  return type === 'group_prospect' || type === 'contact_prospect';
}

function needsMemberReload(a: AutomationSummary): boolean {
  if (a.type !== 'group_prospect') return false;
  const m = outreachMetrics(a.stats as Record<string, number>);
  return a.status === 'failed' || (m.reached === 0 && m.pending === 0);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        status === 'active' && 'bg-emerald-500/15 text-emerald-400',
        status === 'draft' && 'bg-blue-500/15 text-blue-300',
        status === 'paused' && 'bg-amber-500/15 text-amber-400',
        status === 'failed' && 'bg-red-500/15 text-red-400',
        status === 'completed' && 'bg-black/[0.06] text-text-400',
      )}
    >
      {status === 'active' && <span className="status-dot" style={{ background: '#34d399' }} />}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function StatusControls({
  auto,
  onChange,
}: {
  auto: AutomationSummary;
  onChange: () => void | Promise<void>;
}) {
  const cls =
    'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition shadow-sm';
  if (auto.status === 'active') {
    return (
      <button
        type="button"
        onClick={async () => {
          await updateAutomationStatus(auto.id, 'paused');
          await onChange();
        }}
        className={cn(
          cls,
          'border border-amber-500/40 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25',
        )}
        title="Stoppe les envois et les réponses automatiques"
      >
        <Pause className="h-4 w-4" />
        Désactiver
      </button>
    );
  }
  if (auto.status === 'paused' || auto.status === 'draft') {
    return (
      <button
        type="button"
        onClick={async () => {
          await updateAutomationStatus(auto.id, 'active');
          await onChange();
        }}
        className={cn(cls, 'bg-brand text-white hover:bg-brand-dark')}
      >
        <Play className="h-4 w-4" />
        {auto.status === 'draft' ? 'Activer' : 'Réactiver'}
      </button>
    );
  }
  return null;
}

type AutomationPageProps = {
  threadId: number | null;
};

export function AutomationPage({ threadId }: AutomationPageProps) {
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (threadId == null) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchThreadCampaign(threadId);
      setDetail(data.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger l’automatisation');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReloadMembers = async (id: number) => {
    if (!confirm('Recharger les membres du groupe ? WhatsApp doit être connecté.')) return;
    try {
      const data = await reloadAutomationMembers(id);
      alert(`${data.targetsAdded ?? 0} membre(s) ajouté(s).`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Échec');
    }
  };

  const a = detail?.automation;
  const stats = a?.stats ?? {};
  const metrics = a ? outreachMetrics(stats as Record<string, number>) : null;
  const handled = Number(stats.messagesHandled ?? 0);
  const visualPlan = (a?.config as { visualPlan?: AutomationVisualPlan } | undefined)?.visualPlan;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="brand-radial">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-serif text-2xl font-light text-text-100">Automatisation</h1>
              <p className="mt-1 text-sm text-text-400">
                Campagne liée à ce chat — isolée des autres fils.
              </p>
            </div>
            {threadId != null && (
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-sm text-text-300 transition hover:bg-bg-200"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Actualiser
              </button>
            )}
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          {threadId == null && (
            <div className="panel mt-6 flex flex-col items-center py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-muted text-brand">
                <Bot className="h-7 w-7" />
              </span>
              <h3 className="mt-4 font-serif text-lg font-light text-text-100">Aucun fil sélectionné</h3>
              <p className="mt-1 max-w-sm text-sm text-text-400">
                Ouvre ou crée une automatisation dans la barre latérale pour voir son plan ici.
              </p>
            </div>
          )}

          {threadId != null && loading && !a && (
            <div className="mt-6 space-y-3">
              <div className="panel h-28 animate-pulse" />
              <div className="panel h-48 animate-pulse" />
            </div>
          )}

          {threadId != null && !loading && !a && !error && (
            <div className="panel mt-6 flex flex-col items-center py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-muted text-brand">
                <Bot className="h-7 w-7" />
              </span>
              <h3 className="mt-4 font-serif text-lg font-light text-text-100">
                Pas encore de campagne
              </h3>
              <p className="mt-1 max-w-sm text-sm text-text-400">
                Demande à l’agent de lancer une campagne dans ce chat. Le plan et les contrôles
                apparaîtront ici.
              </p>
            </div>
          )}

          {a && metrics && (
            <div className="mt-6 space-y-5 sm:space-y-6">
              <header className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <h2 className="text-lg font-medium text-text-100 sm:text-xl">{a.name}</h2>
                  <p className="mt-1 text-sm text-text-500">
                    {TYPE_LABELS[a.type] || a.type} · Créée le {fmtTime(a.created_at)}
                  </p>
                  {stats.lastActionAt && (
                    <p className="mt-0.5 text-xs text-text-500">
                      Dernière activité : {fmtTime(stats.lastActionAt as string)}
                    </p>
                  )}
                </div>
                <StatusBadge status={a.status} />
              </header>

              {visualPlan && visualPlan.nodes?.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-text-200">Plan de l’automatisation</h3>
                  <PlanBoard plan={visualPlan} className="h-[420px] min-h-[320px]" />
                </section>
              )}

              <div className="flex flex-wrap gap-3 text-sm text-text-400">
                {isOutboundType(a.type) ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-text-500" />
                      {metrics.reached} atteint(s)
                    </span>
                    <span>{metrics.pending} restant(s)</span>
                    <span className="inline-flex items-center gap-1.5">
                      <MessageSquare className="h-4 w-4 text-text-500" />
                      {metrics.answered} réponse(s)
                      {metrics.rate != null && (
                        <span className="text-text-500">· {metrics.rate}%</span>
                      )}
                    </span>
                    {metrics.interested > 0 && (
                      <span className="text-emerald-600">{metrics.interested} intéressé(s)</span>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-text-500" />
                    {handled} message(s) traité(s)
                  </span>
                )}
              </div>

              {typeof stats.report === 'string' && stats.report && (
                <section className="panel p-5">
                  <h3 className="text-sm font-semibold text-text-200">Rapport</h3>
                  <p className="mt-2 text-sm text-text-400">{stats.report}</p>
                </section>
              )}

              <div className="flex flex-wrap gap-2">
                {needsMemberReload(a) && (
                  <button
                    type="button"
                    onClick={() => void handleReloadMembers(a.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Recharger les membres
                  </button>
                )}
                <StatusControls auto={a} onChange={load} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
