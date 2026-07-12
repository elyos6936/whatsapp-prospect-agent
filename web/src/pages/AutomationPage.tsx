import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Zap } from 'lucide-react';
import { AutomationListCard } from '@/components/automation/AutomationListCard';
import { AutomationStatsView } from '@/components/automation/AutomationStatsView';
import { BuilderSplitView } from '@/components/automation/BuilderSplitView';
import {
  cancelScheduledMessage,
  fetchAutomations,
  fetchAutomationStats,
  fetchHandoffs,
  fetchScheduledMessages,
  reloadAutomationMembers,
  resolveHandoff,
  updateAutomationStatus,
  type AutomationStats,
  type AutomationSummary,
  type HandoffItem,
  type ScheduledMessageItem,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type Section = 'manual' | 'automatic';
type View = 'list' | 'builder' | 'stats';

function needsMemberReload(a: AutomationSummary): boolean {
  if (a.type !== 'group_prospect') return false;
  const contacted = (a.stats?.contacted as number) ?? 0;
  const pending = (a.stats?.pending as number) ?? 0;
  return a.status === 'failed' || (contacted === 0 && pending === 0);
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

function ScheduledCard({
  item,
  onCancel,
}: {
  item: ScheduledMessageItem;
  onCancel?: () => void;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-bg-100 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-text-100">
            {item.recipient_label || item.recipient}
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-text-400">{item.message}</p>
          <p className="mt-2 text-xs text-text-500">Prévu : {fmtTime(item.send_at)}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs',
            item.status === 'pending' && 'bg-amber-500/20 text-amber-400',
            item.status === 'sent' && 'bg-emerald-500/20 text-emerald-400',
            item.status === 'failed' && 'bg-red-500/20 text-red-400',
            item.status === 'cancelled' && 'bg-bg-300 text-text-500',
          )}
        >
          {item.status}
        </span>
      </div>
      {item.status === 'pending' && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-bg-200"
        >
          Annuler
        </button>
      )}
    </article>
  );
}

export function AutomationPage() {
  const [section, setSection] = useState<Section>('automatic');
  const [view, setView] = useState<View>('list');
  const [statsData, setStatsData] = useState<AutomationStats | null>(null);
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessageItem[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [autos, sched, ho] = await Promise.all([
        fetchAutomations(),
        fetchScheduledMessages(),
        fetchHandoffs(),
      ]);
      setAutomations(autos);
      setScheduled(sched);
      setHandoffs(ho);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'list') void loadAll();
  }, [view, section, loadAll]);

  const chatAutomations = automations.filter(
    (a) => ((a.config?.origin as string) ?? 'chat') === 'chat',
  );
  const manualAutomations = automations.filter(
    (a) => (a.config?.origin as string) === 'manual',
  );

  const openStats = async (id: number) => {
    setLoading(true);
    try {
      setStatsData(await fetchAutomationStats(id));
      setView('stats');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (id: number, status: 'active' | 'paused') => {
    await updateAutomationStatus(id, status);
    await loadAll();
  };

  const handleReloadMembers = async (id: number) => {
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
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Échec');
    }
  };

  if (view === 'builder') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <BuilderSplitView
          onBack={() => {
            setView('list');
            setSection('manual');
          }}
          onStats={(id) => void openStats(id)}
        />
      </div>
    );
  }

  if (view === 'stats' && statsData) {
    return (
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <AutomationStatsView
            data={statsData}
            onBack={() => {
              setStatsData(null);
              setView('list');
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-light text-text-100">Automatisation</h1>
            <p className="mt-1 text-sm text-text-400">
              Créez, suivez et contrôlez vos automatisations WhatsApp.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-text-400 hover:bg-bg-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Actualiser
            </button>
            {section === 'manual' && (
              <button
                type="button"
                onClick={() => setView('builder')}
                className="inline-flex items-center gap-1 rounded-xl bg-brand px-4 py-1.5 text-xs font-medium text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Créer
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {(
            [
              { id: 'automatic' as const, label: 'Automatique' },
              { id: 'manual' as const, label: 'Manuel' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSection(t.id)}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition',
                section === t.id
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

        {section === 'automatic' && (
          <div className="mt-6 space-y-8">
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-brand" />
                <h2 className="text-sm font-medium text-text-200">
                  Campagnes créées depuis le chat ({chatAutomations.length})
                </h2>
              </div>
              <p className="mb-4 text-xs text-text-500">
                Automatisations lancées par l&apos;agent dans le chat principal. Vous pouvez les
                désactiver ou les réactiver ici.
              </p>
              {chatAutomations.length === 0 ? (
                <p className="text-sm text-text-500">
                  Aucune campagne automatique. Demandez à l&apos;agent dans le chat : « Prospecte le
                  groupe X » ou « Quand quelqu&apos;un dit … ».
                </p>
              ) : (
                <div className="space-y-3">
                  {chatAutomations.map((auto) => (
                    <div key={auto.id}>
                      <AutomationListCard
                        auto={auto}
                        onStats={() => void openStats(auto.id)}
                        onToggleStatus={() =>
                          void toggleStatus(
                            auto.id,
                            auto.status === 'active' ? 'paused' : 'active',
                          )
                        }
                      />
                      {needsMemberReload(auto) && (
                        <button
                          type="button"
                          onClick={() => void handleReloadMembers(auto.id)}
                          className="mt-2 text-xs text-brand hover:underline"
                        >
                          Recharger les membres du groupe
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-medium text-text-200">
                Envois programmés ({scheduled.filter((s) => s.status === 'pending').length} en
                attente)
              </h2>
              <p className="mb-4 text-xs text-text-500">
                Messages planifiés depuis le chat (ex. « envoie dans 10 minutes »). Exécution
                garantie côté serveur.
              </p>
              {scheduled.length === 0 ? (
                <p className="text-sm text-text-500">Aucun envoi programmé.</p>
              ) : (
                <div className="space-y-3">
                  {scheduled.slice(0, 30).map((item) => (
                    <ScheduledCard
                      key={item.id}
                      item={item}
                      onCancel={
                        item.status === 'pending'
                          ? async () => {
                              await cancelScheduledMessage(item.id);
                              await loadAll();
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </section>

            {handoffs.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-medium text-text-200">
                  Handoffs ({handoffs.length})
                </h2>
                <div className="space-y-3">
                  {handoffs.map((h) => (
                    <article
                      key={h.id}
                      className="rounded-2xl border border-white/10 bg-bg-100 p-4"
                    >
                      <h4 className="font-medium text-text-200">
                        {h.contact_name || h.contact_phone}
                      </h4>
                      <p className="mt-1 text-sm text-brand">{h.reason}</p>
                      {h.summary && <p className="mt-2 text-sm text-text-400">{h.summary}</p>}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await resolveHandoff(h.id, 'resolved');
                            await loadAll();
                          }}
                          className="rounded-lg bg-brand px-3 py-1 text-xs text-white"
                        >
                          Traité
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await resolveHandoff(h.id, 'dismissed');
                            await loadAll();
                          }}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-bg-200"
                        >
                          Ignorer
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {section === 'manual' && (
          <div className="mt-6 space-y-6">
            <p className="text-sm text-text-400">
              Créez une automatisation via le chat constructeur. L&apos;aperçu se met à jour en
              direct ; validez avant activation.
            </p>

            {manualAutomations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
                <p className="text-sm text-text-400">Aucune automatisation manuelle.</p>
                <button
                  type="button"
                  onClick={() => setView('builder')}
                  className="mt-4 inline-flex items-center gap-1 rounded-xl bg-brand px-4 py-2 text-sm text-white"
                >
                  <Plus className="h-4 w-4" />
                  Créer une automatisation
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {manualAutomations.map((auto) => (
                  <AutomationListCard
                    key={auto.id}
                    auto={auto}
                    onOpen={() => setView('builder')}
                    onStats={() => void openStats(auto.id)}
                    onToggleStatus={() =>
                      void toggleStatus(auto.id, auto.status === 'active' ? 'paused' : 'active')
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
