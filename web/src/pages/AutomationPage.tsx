import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bot,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  fetchAutomationDetail,
  fetchAutomations,
  reloadAutomationMembers,
  sendChatMessage,
  updateAutomationStatus,
  type AutomationDetail,
  type AutomationSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';

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

const SUGGESTIONS = [
  'Lundi à 8h, envoie « Bonjour, on est ouvert ! » à +229…',
  'Prospecte ces contacts pour ma formation',
  'Relance les personnes qui n’ont pas répondu',
];

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
  const contacted = (a.stats?.contacted as number) ?? 0;
  const pending = (a.stats?.pending as number) ?? 0;
  return a.status === 'failed' || (contacted === 0 && pending === 0);
}

function responseRate(stats?: Record<string, number | string>): number | null {
  const contacted = Number(stats?.contacted ?? 0);
  const replied = Number(stats?.replied ?? 0);
  if (!contacted) return null;
  return Math.round((replied / contacted) * 100);
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="panel-inset p-4">
      <span className="text-xs text-text-500">{label}</span>
      <p className="mt-1 text-2xl font-semibold text-text-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-500">{hint}</p>}
    </div>
  );
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
        status === 'completed' && 'bg-white/10 text-text-400',
      )}
    >
      {(status === 'active') && <span className="status-dot" style={{ background: '#34d399' }} />}
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function StatusControls({
  auto,
  onChange,
  size = 'sm',
}: {
  auto: AutomationSummary;
  onChange: () => void | Promise<void>;
  size?: 'sm' | 'md';
}) {
  const cls = cn(
    'inline-flex items-center gap-1.5 rounded-lg font-medium transition',
    size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-2 text-sm',
  );
  if (auto.status === 'active') {
    return (
      <button
        type="button"
        onClick={async () => {
          await updateAutomationStatus(auto.id, 'paused');
          await onChange();
        }}
        className={cn(cls, 'border border-white/10 text-text-300 hover:bg-bg-200')}
      >
        <Pause className="h-3.5 w-3.5" />
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
        <Play className="h-3.5 w-3.5" />
        {auto.status === 'draft' ? 'Activer' : 'Réactiver'}
      </button>
    );
  }
  return null;
}

// ─── Chat builder (mode Manuel) ─────────────────────────────────────────────
// NOTE: temporairement retiré de l'interface (voir AutomationPage). Le code est
// conservé pour être réintégré plus tard avec un canal dédié (hors chat principal).
type ChatMsg = { role: 'user' | 'assistant'; content: string };

export function ManualBuilder({
  automations,
  loading,
  onRefresh,
  onOpenStats,
}: {
  automations: AutomationSummary[];
  loading: boolean;
  onRefresh: () => void;
  onOpenStats: (id: number) => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value || sending) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setMessages((m) => [...m, { role: 'user', content: value }]);
    setSending(true);
    try {
      const res = await sendChatMessage(value);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      onRefresh();
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: err instanceof Error ? err.message : 'Erreur, réessaie.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_340px]">
      {/* Colonne chat */}
      <div className="panel flex h-[68vh] min-h-[460px] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.02] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-muted text-brand">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-text-100">Créer une automatisation</h3>
            <p className="text-xs text-text-400">Décris ce que tu veux, je le mets en place.</p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto custom-scrollbar p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-muted text-brand">
                <Bot className="h-7 w-7" />
              </span>
              <h4 className="mt-4 font-serif text-lg font-light text-text-100">
                Qu’est-ce que tu veux automatiser ?
              </h4>
              <p className="mt-1 max-w-sm text-sm text-text-400">
                Écris-le en langage naturel. Je te pose les bonnes questions et je demande
                confirmation avant d’activer.
              </p>
              <div className="mt-5 flex w-full max-w-md flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="group flex items-center gap-2 rounded-xl border border-white/10 bg-bg-0 px-3.5 py-2.5 text-left text-sm text-text-300 transition hover:border-brand-border hover:bg-brand-muted hover:text-text-100"
                  >
                    <Plus className="h-4 w-4 shrink-0 text-text-500 transition group-hover:text-brand" />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'flex animate-rise-in items-end gap-2',
                  m.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                {m.role === 'assistant' && (
                  <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
                    <Bot className="h-4 w-4" />
                  </span>
                )}
                <div
                  className={cn(
                    'max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'rounded-br-md bg-brand text-white'
                      : 'rounded-bl-md border border-white/10 bg-bg-200 text-text-200',
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex animate-rise-in items-end gap-2">
              <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
                <Bot className="h-4 w-4" />
              </span>
              <div className="flex gap-1 rounded-2xl rounded-bl-md border border-white/10 bg-bg-200 px-4 py-3">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-500 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-500 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-500" />
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-bg-0 p-2 transition focus-within:border-brand-border focus-within:ring-2 focus-within:ring-brand/20">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Écris ton automatisation…"
              className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text-100 outline-none placeholder:text-text-500"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={sending || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-dark disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Colonne automatisations */}
      <div className="panel flex h-[68vh] min-h-[460px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-4 py-3">
          <h3 className="text-sm font-semibold text-text-100">Mes automatisations</h3>
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-text-400 transition hover:bg-bg-200 hover:text-text-100"
            title="Actualiser"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto custom-scrollbar p-3">
          {automations.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <MessageSquare className="h-8 w-8 text-text-500" />
              <p className="mt-3 text-sm text-text-400">
                Aucune automatisation. Décris-en une dans le chat pour commencer.
              </p>
            </div>
          ) : (
            automations.map((auto) => (
              <div key={auto.id} className="panel-inset p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-100">{auto.name}</p>
                    <span className="text-[11px] text-brand">
                      {TYPE_LABELS[auto.type] || auto.type}
                    </span>
                  </div>
                  <StatusBadge status={auto.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenStats(auto.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-text-300 transition hover:bg-bg-200"
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Statistiques
                  </button>
                  <StatusControls auto={auto} onChange={onRefresh} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function AutomationPage() {
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
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
    if (!detail) void loadAutomations();
  }, [detail, loadAutomations]);

  const handleReloadMembers = async (id: number, onDone?: () => void) => {
    if (!confirm('Recharger les membres du groupe ? WhatsApp doit être connecté.')) return;
    try {
      const data = await reloadAutomationMembers(id);
      alert(`${data.targetsAdded ?? 0} membre(s) ajouté(s).`);
      if (onDone) await onDone();
      else await loadAutomations();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Échec');
    }
  };

  const a = detail?.automation;
  const stats = a?.stats ?? {};
  const targets = detail?.targets ?? [];
  const logs = detail?.logs ?? [];
  const rate = responseRate(stats);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="brand-radial">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          {/* En-tête */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-serif text-2xl font-light text-text-100">Automatisation</h1>
              <p className="mt-1 text-sm text-text-400">
                Retrouve ici les campagnes lancées depuis le chat, avec leur état et leurs
                statistiques.
              </p>
            </div>
            {!detail && (
              <button
                type="button"
                onClick={loadAutomations}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-text-300 transition hover:bg-bg-200"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Actualiser
              </button>
            )}
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          {/* ── CAMPAGNES ── */}
          {!detail && (
            <div className="mt-6 space-y-3">
              {loading && automations.length === 0 ? (
                <div className="space-y-3">
                  <div className="panel h-28 animate-pulse" />
                  <div className="panel h-28 animate-pulse" />
                </div>
              ) : automations.length === 0 ? (
                <div className="panel flex flex-col items-center py-14 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-muted text-brand">
                    <Bot className="h-7 w-7" />
                  </span>
                  <h3 className="mt-4 font-serif text-lg font-light text-text-100">
                    Aucune campagne pour l’instant
                  </h3>
                  <p className="mt-1 max-w-sm text-sm text-text-400">
                    Demande à l’agent IA de lancer une campagne depuis le Chat. Elle apparaîtra ici
                    automatiquement.
                  </p>
                </div>
              ) : (
                automations.map((auto) => {
                  const contacted = (auto.stats?.contacted as number) ?? 0;
                  const pending = (auto.stats?.pending as number) ?? 0;
                  const replied = (auto.stats?.replied as number) ?? 0;
                  const handled = (auto.stats?.messagesHandled as number) ?? 0;

                  return (
                    <article
                      key={auto.id}
                      className="panel cursor-pointer p-5 transition hover:border-brand-border"
                      onClick={() => void showDetail(auto.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-medium text-text-100">{auto.name}</h3>
                          <span className="text-xs text-brand">
                            {TYPE_LABELS[auto.type] || auto.type}
                          </span>
                        </div>
                        <StatusBadge status={auto.status} />
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-text-400">{auto.summary || '—'}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-400">
                        {isOutboundType(auto.type) ? (
                          <>
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-text-500" />
                              {contacted} contacté(s)
                            </span>
                            <span>{pending} restant(s)</span>
                            <span className="inline-flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-text-500" />
                              {replied} réponse(s)
                            </span>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-text-500" />
                            {handled} message(s) traité(s)
                          </span>
                        )}
                      </div>

                      <div
                        className="mt-4 flex flex-wrap gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => void showDetail(auto.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-text-300 transition hover:bg-bg-200"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          Statistiques
                        </button>
                        {needsMemberReload(auto) && (
                          <button
                            type="button"
                            onClick={() => void handleReloadMembers(auto.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-dark"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Recharger membres
                          </button>
                        )}
                        <StatusControls auto={auto} onChange={loadAutomations} size="md" />
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          )}

          {/* ── DÉTAIL / STATISTIQUES ── */}
          {detail && a && (
            <div className="mt-6 space-y-6">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Retour
              </button>

              <header className="panel flex items-start justify-between gap-4 p-5">
                <div>
                  <h2 className="text-xl font-medium text-text-100">{a.name}</h2>
                  <p className="mt-1 text-sm text-text-500">
                    {TYPE_LABELS[a.type] || a.type} · Créée le {fmtTime(a.created_at)}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </header>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {isOutboundType(a.type) ? (
                  <>
                    <StatCard label="Contactés" value={(stats.contacted as number) ?? 0} />
                    <StatCard label="Restants" value={(stats.pending as number) ?? 0} />
                    <StatCard label="Réponses" value={(stats.replied as number) ?? 0} />
                    <StatCard
                      label="Taux de réponse"
                      value={rate != null ? `${rate}%` : '—'}
                      hint={`${(stats.interested as number) ?? 0} intéressé(s)`}
                    />
                  </>
                ) : (
                  <>
                    <StatCard
                      label="Messages traités"
                      value={(stats.messagesHandled as number) ?? 0}
                    />
                    <StatCard label="Intéressés" value={(stats.interested as number) ?? 0} />
                    <StatCard label="Conversions" value={(stats.conversions as number) ?? 0} />
                    <StatCard label="Budget" value={`${a.budget_fcfa || 0} FCFA`} />
                  </>
                )}
              </div>

              {typeof stats.report === 'string' && stats.report && (
                <section className="panel p-5">
                  <h3 className="text-sm font-semibold text-text-200">Rapport</h3>
                  <p className="mt-2 text-sm text-text-400">{stats.report}</p>
                </section>
              )}

              {targets.length > 0 && (
                <section className="panel p-5">
                  <h3 className="text-sm font-semibold text-text-200">Cibles ({targets.length})</h3>
                  <div className="mt-3 space-y-1.5">
                    {targets.slice(0, 30).map((t) => (
                      <div
                        key={t.target_id}
                        className="flex justify-between rounded-lg bg-bg-0 px-3 py-2 text-sm"
                      >
                        <span className="text-text-300">{t.target_label || t.target_id}</span>
                        <span className="text-text-500">{t.status}</span>
                      </div>
                    ))}
                    {targets.length > 30 && (
                      <p className="text-xs text-text-500">… et {targets.length - 30} autre(s)</p>
                    )}
                  </div>
                </section>
              )}

              <section className="panel p-5">
                <h3 className="text-sm font-semibold text-text-200">Journal récent</h3>
                <div className="mt-3 space-y-1.5">
                  {logs.length === 0 ? (
                    <p className="text-sm text-text-500">Aucun événement.</p>
                  ) : (
                    logs.map((l, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm',
                          l.level === 'error'
                            ? 'bg-red-500/10 text-red-300'
                            : 'bg-bg-0 text-text-300',
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
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Recharger les membres
                  </button>
                )}
                <StatusControls auto={a} onChange={() => showDetail(a.id)} size="md" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
