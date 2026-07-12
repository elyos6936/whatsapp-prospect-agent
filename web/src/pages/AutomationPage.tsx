import { useCallback, useEffect, useState } from 'react';
import {
  fetchAutomationDetail,
  fetchAutomations,
  fetchHandoffs,
  fetchRoiDashboard,
  reloadAutomationMembers,
  resolveHandoff,
  updateAutomationStatus,
  type AutomationDetail,
  type AutomationSummary,
  type HandoffItem,
  type RoiDashboard,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type AutoTab = 'list' | 'roi' | 'handoffs';

const TYPE_LABELS: Record<string, string> = {
  group_prospect: 'Prospection groupe',
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

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-bg-100 p-4">
      <span className="text-xs text-text-500">{label}</span>
      <p className="mt-1 text-xl font-semibold text-text-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-500">{hint}</p>}
    </div>
  );
}

function needsMemberReload(a: AutomationSummary): boolean {
  if (a.type !== 'group_prospect') return false;
  const contacted = (a.stats?.contacted as number) ?? 0;
  const pending = (a.stats?.pending as number) ?? 0;
  return a.status === 'failed' || (contacted === 0 && pending === 0);
}

export function AutomationPage() {
  const [tab, setTab] = useState<AutoTab>('list');
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [roi, setRoi] = useState<RoiDashboard | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAutomations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAutomations(await fetchAutomations());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoi = useCallback(async () => {
    setLoading(true);
    try {
      setRoi(await fetchRoiDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHandoffs = useCallback(async () => {
    setLoading(true);
    try {
      setHandoffs(await fetchHandoffs());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  const showDetail = useCallback(async (id: number) => {
    setLoading(true);
    try {
      setDetail(await fetchAutomationDetail(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'list' && !detail) void loadAutomations();
    if (tab === 'roi') void loadRoi();
    if (tab === 'handoffs') void loadHandoffs();
  }, [tab, detail, loadAutomations, loadRoi, loadHandoffs]);

  const handleReloadMembers = async (id: number, onDone?: () => void) => {
    if (
      !confirm(
        'Recharger les membres du groupe depuis Evolution API ? WhatsApp doit être connecté.',
      )
    ) {
      return;
    }
    try {
      const data = await reloadAutomationMembers(id);
      alert(`${data.targetsAdded ?? 0} membre(s) ajouté(s).`);
      if (onDone) await onDone();
      else await loadAutomations();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Échec');
    }
  };

  const tabs: { id: AutoTab; label: string }[] = [
    { id: 'list', label: 'Campagnes' },
    { id: 'roi', label: 'ROI' },
    { id: 'handoffs', label: 'Handoffs' },
  ];

  const a = detail?.automation;
  const stats = a?.stats ?? {};
  const targets = detail?.targets ?? [];
  const logs = detail?.logs ?? [];

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-light text-text-100">Automatisation</h1>
            <p className="mt-1 text-sm text-text-400">Campagnes, ROI et handoffs humains.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (tab === 'list' && !detail) void loadAutomations();
              if (tab === 'roi') void loadRoi();
              if (tab === 'handoffs') void loadHandoffs();
            }}
            className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-text-400 hover:bg-bg-200"
          >
            Actualiser
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id === 'list') setDetail(null);
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                tab === t.id
                  ? 'bg-brand-muted text-brand border border-brand-border'
                  : 'text-text-400 border border-white/10 hover:bg-bg-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {loading && <p className="mt-4 text-sm text-text-500">Chargement…</p>}

        {tab === 'list' && !detail && (
          <div className="mt-6 space-y-3">
            {automations.length === 0 ? (
              <p className="text-sm text-text-500">
                Aucune automatisation. Demandez à l&apos;agent IA de lancer une campagne.
              </p>
            ) : (
              automations.map((auto) => {
                const contacted = (auto.stats?.contacted as number) ?? 0;
                const pending = (auto.stats?.pending as number) ?? 0;
                const replied = (auto.stats?.replied as number) ?? 0;
                const handled = (auto.stats?.messagesHandled as number) ?? 0;
                const progress =
                  auto.type === 'group_prospect'
                    ? `${contacted} contacté(s) · ${pending} restant(s) · ${replied} réponse(s)`
                    : `${handled} message(s) traité(s)`;

                return (
                  <article
                    key={auto.id}
                    className="cursor-pointer rounded-2xl border border-white/10 bg-bg-100 p-5 transition hover:border-brand-border"
                    onClick={() => void showDetail(auto.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium text-text-100">{auto.name}</h3>
                        <span className="text-xs text-brand">
                          {TYPE_LABELS[auto.type] || auto.type}
                        </span>
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          auto.status === 'active' && 'bg-emerald-500/20 text-emerald-400',
                          auto.status === 'draft' && 'bg-blue-500/20 text-blue-400',
                          auto.status === 'paused' && 'bg-amber-500/20 text-amber-400',
                          auto.status === 'failed' && 'bg-red-500/20 text-red-400',
                          auto.status === 'completed' && 'bg-bg-300 text-text-400',
                        )}
                      >
                        {STATUS_LABELS[auto.status] || auto.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-text-400">{auto.summary || '—'}</p>
                    <p className="mt-1 text-xs text-text-500">{progress}</p>
                    <div
                      className="mt-3 flex flex-wrap gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => void showDetail(auto.id)}
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-bg-200"
                      >
                        Détail
                      </button>
                      {needsMemberReload(auto) && (
                        <button
                          type="button"
                          onClick={() => void handleReloadMembers(auto.id)}
                          className="rounded-lg bg-brand px-3 py-1 text-xs text-white"
                        >
                          Recharger membres
                        </button>
                      )}
                      {auto.status === 'active' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await updateAutomationStatus(auto.id, 'paused');
                            await loadAutomations();
                          }}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-bg-200"
                        >
                          Désactiver
                        </button>
                      )}
                      {auto.status === 'paused' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await updateAutomationStatus(auto.id, 'active');
                            await loadAutomations();
                          }}
                          className="rounded-lg bg-brand px-3 py-1 text-xs text-white"
                        >
                          Réactiver
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}

        {tab === 'list' && detail && a && (
          <div className="mt-6 space-y-6">
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-sm text-brand hover:underline"
            >
              ← Retour à la liste
            </button>

            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-medium text-text-100">{a.name}</h2>
                <p className="text-sm text-text-500">
                  {TYPE_LABELS[a.type] || a.type} · Créée le {fmtTime(a.created_at)}
                </p>
              </div>
              <span className="text-sm text-text-400">
                {STATUS_LABELS[a.status] || a.status}
              </span>
            </header>

            <p className="text-text-300">{a.summary || '—'}</p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {a.type === 'group_prospect' ? (
                <>
                  <StatCard label="Contactés" value={(stats.contacted as number) ?? 0} />
                  <StatCard label="Restants" value={(stats.pending as number) ?? 0} />
                  <StatCard label="Réponses" value={(stats.replied as number) ?? 0} />
                  <StatCard label="Intéressés" value={(stats.interested as number) ?? 0} />
                </>
              ) : (
                <>
                  <StatCard label="Messages traités" value={(stats.messagesHandled as number) ?? 0} />
                  <StatCard label="Budget" value={`${a.budget_fcfa || 0} FCFA`} />
                </>
              )}
            </div>

            {typeof stats.report === 'string' && stats.report && (
              <section>
                <h3 className="text-sm font-medium text-text-200">Rapport</h3>
                <p className="mt-2 text-sm text-text-400">{stats.report}</p>
              </section>
            )}

            {targets.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-text-200">Cibles ({targets.length})</h3>
                <div className="mt-2 space-y-1">
                  {targets.slice(0, 30).map((t) => (
                    <div
                      key={t.target_id}
                      className="flex justify-between rounded-lg bg-bg-100 px-3 py-2 text-sm"
                    >
                      <span>{t.target_label || t.target_id}</span>
                      <span className="text-text-500">{t.status}</span>
                    </div>
                  ))}
                  {targets.length > 30 && (
                    <p className="text-xs text-text-500">… et {targets.length - 30} autre(s)</p>
                  )}
                </div>
              </section>
            )}

            <section>
              <h3 className="text-sm font-medium text-text-200">Journal récent</h3>
              <div className="mt-2 space-y-1">
                {logs.length === 0 ? (
                  <p className="text-sm text-text-500">Aucun événement.</p>
                ) : (
                  logs.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm',
                        l.level === 'error' && 'bg-red-500/10 text-red-300',
                        l.level !== 'error' && 'bg-bg-100 text-text-300',
                      )}
                    >
                      <span className="mr-2 text-xs text-text-500">{fmtTime(l.created_at)}</span>
                      {l.message}
                    </div>
                  ))
                )}
              </div>
            </section>

            <div className="flex flex-wrap gap-2">
              {needsMemberReload(a) && (
                <button
                  type="button"
                  onClick={() => void handleReloadMembers(a.id, () => showDetail(a.id))}
                  className="rounded-xl bg-brand px-4 py-2 text-sm text-white"
                >
                  Recharger les membres
                </button>
              )}
              {a.status === 'active' && (
                <button
                  type="button"
                  onClick={async () => {
                    await updateAutomationStatus(a.id, 'paused');
                    await showDetail(a.id);
                  }}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-bg-200"
                >
                  Désactiver
                </button>
              )}
              {a.status === 'paused' && (
                <button
                  type="button"
                  onClick={async () => {
                    await updateAutomationStatus(a.id, 'active');
                    await showDetail(a.id);
                  }}
                  className="rounded-xl bg-brand px-4 py-2 text-sm text-white"
                >
                  Réactiver
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'roi' && roi && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Contactés" value={roi.totals?.contacted ?? 0} />
              <StatCard label="Réponses" value={roi.totals?.replied ?? 0} />
              <StatCard label="Intéressés" value={roi.totals?.interested ?? 0} />
              <StatCard label="Conversions" value={roi.totals?.conversions ?? 0} />
              <StatCard label="Revenus" value={`${roi.totals?.revenueFcfa ?? 0} FCFA`} />
              <StatCard label="Budget" value={`${roi.totals?.budgetFcfa ?? 0} FCFA`} />
              <StatCard label="Leads chauds" value={roi.totals?.hotLeads ?? 0} />
              <StatCard
                label="Msgs sortants/jour"
                value={roi.totals?.messagesToday ?? 0}
              />
            </div>
            <section>
              <h3 className="text-sm font-medium text-text-200">Par campagne</h3>
              <div className="mt-3 space-y-2">
                {(roi.automations ?? []).length === 0 ? (
                  <p className="text-sm text-text-500">Aucune campagne.</p>
                ) : (
                  roi.automations!.map((item, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-bg-100 p-4">
                      <h4 className="font-medium text-text-200">{item.name}</h4>
                      <p className="text-sm text-text-500">
                        ROI: {item.roiPercent != null ? `${item.roiPercent}%` : '—'} · Coût/réponse:{' '}
                        {item.costPerReply != null ? `${item.costPerReply} FCFA` : '—'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'handoffs' && (
          <div className="mt-6 space-y-3">
            {handoffs.length === 0 ? (
              <p className="text-sm text-text-500">
                Aucun handoff en attente. L&apos;IA vous alertera quand un humain doit reprendre.
              </p>
            ) : (
              handoffs.map((h) => (
                <article key={h.id} className="rounded-2xl border border-white/10 bg-bg-100 p-5">
                  <h4 className="font-medium text-text-200">
                    {h.contact_name || h.contact_phone}
                  </h4>
                  <p className="mt-1 text-sm font-medium text-brand">{h.reason}</p>
                  {h.summary && <p className="mt-2 text-sm text-text-400">{h.summary}</p>}
                  {h.suggested_reply && (
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-bg-0 p-3 text-xs text-text-300">
                      {h.suggested_reply}
                    </pre>
                  )}
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await resolveHandoff(h.id, 'resolved');
                        await loadHandoffs();
                      }}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs text-white"
                    >
                      Traité
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await resolveHandoff(h.id, 'dismissed');
                        await loadHandoffs();
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-bg-200"
                    >
                      Ignorer
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
