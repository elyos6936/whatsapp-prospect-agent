import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Sparkles } from 'lucide-react';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { KlanvioChatInput } from '@/components/ui/klanvio-chat-input';
import { AutomationListCard } from '@/components/automation/AutomationListCard';
import { AutomationStatsBar } from '@/components/automation/AutomationStatsBar';
import {
  fetchAutomations,
  fetchAutomationStats,
  fetchBuilderHistory,
  sendBuilderMessage,
  updateAutomationStatus,
  type AutomationStats,
  type AutomationSummary,
  type ChatMessage,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const BUILDER_SUGGESTIONS = [
  { label: 'Envoi programmé', prompt: 'Lundi à 9h, envoie « Bonjour » à +229…' },
  { label: 'Prospection groupe', prompt: 'Prospecte tous les membres du groupe …' },
  { label: 'Relance J+2', prompt: 'Relance les gens qui ne répondent pas 2 jours après' },
] as const;

function toChatMessage(m: { id: number; role: string; content: string; created_at: string }): ChatMessage {
  return {
    id: `builder-${m.id}`,
    kind: m.role === 'user' ? 'user' : m.content.startsWith('❌') ? 'error' : 'assistant',
    content: m.content,
    created_at: m.created_at,
    label: m.role === 'user' ? 'Vous' : 'Constructeur',
  };
}

function configPreview(auto: AutomationSummary): string[] {
  const c = auto.config ?? {};
  const lines: string[] = [];
  if (c.initialMessage) lines.push(`Premier message : ${String(c.initialMessage).slice(0, 120)}…`);
  if (c.groupName || c.groupId) lines.push(`Groupe : ${String(c.groupName || c.groupId)}`);
  if (c.objective) lines.push(`Objectif : ${String(c.objective)}`);
  if (c.sellingWhat) lines.push(`Offre : ${String(c.sellingWhat)}`);
  if (c.conversationStyle) lines.push(`Style : ${String(c.conversationStyle)}`);
  if (Array.isArray(c.keywords) && c.keywords.length)
    lines.push(`Mots-clés : ${(c.keywords as string[]).join(', ')}`);
  if (Array.isArray(c.triggerPhrases) && c.triggerPhrases.length)
    lines.push(`Déclencheurs : ${(c.triggerPhrases as string[]).join(' | ')}`);
  const fu = c.followUp as { enabled?: boolean; maxFollowUps?: number; intervalDays?: number } | undefined;
  if (fu?.enabled) {
    lines.push(
      `Relances : ${fu.maxFollowUps ?? 1}×, tous les ${fu.intervalDays ?? 2} jour(s)`,
    );
  }
  return lines;
}

interface BuilderSplitViewProps {
  onBack: () => void;
  onStats: (id: number) => void;
  initialAutomationId?: number | null;
}

export function BuilderSplitView({ onBack, onStats, initialAutomationId }: BuilderSplitViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<AutomationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(initialAutomationId ?? null);
  const [selectedStats, setSelectedStats] = useState<AutomationStats | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshDrafts = useCallback(async () => {
    const all = await fetchAutomations();
    const manual = all.filter((a) => (a.config?.origin as string) === 'manual');
    setDrafts(manual);
    if (!selectedId && manual.length > 0) {
      setSelectedId(manual[0].id);
    } else if (selectedId && !manual.find((a) => a.id === selectedId) && manual.length > 0) {
      setSelectedId(manual[0].id);
    }
  }, [selectedId]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const hist = await fetchBuilderHistory();
        setMessages(hist.map(toChatMessage));
        await refreshDrafts();
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshDrafts]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  useEffect(() => {
    if (selectedId == null) {
      setSelectedStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await fetchAutomationStats(selectedId);
        if (!cancelled) setSelectedStats(s);
      } catch {
        if (!cancelled) setSelectedStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, drafts]);

  const handleSend = async (text: string) => {
    if (!text.trim()) return;
    const optimistic: ChatMessage = {
      id: `builder-opt-${Date.now()}`,
      kind: 'user',
      content: text,
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      label: 'Vous',
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    try {
      const result = await sendBuilderMessage(text);
      setMessages((prev) => [
        ...prev,
        {
          id: `builder-${result.id}`,
          kind: result.error ? 'error' : 'assistant',
          content: result.reply,
          created_at: result.created_at,
          label: 'Constructeur',
        },
      ]);
      await refreshDrafts();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `builder-err-${Date.now()}`,
          kind: 'error',
          content: err instanceof Error ? err.message : 'Erreur',
          created_at: new Date().toISOString(),
          label: 'Erreur',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const selected = drafts.find((a) => a.id === selectedId) ?? drafts[0] ?? null;

  const handleToggle = async (id: number, status: 'active' | 'paused') => {
    await updateAutomationStatus(id, status);
    await refreshDrafts();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        <span className="text-sm text-text-400">Nouvelle automatisation</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Chat constructeur */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-white/10 lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-white/5 px-4 py-2">
            <p className="text-xs text-text-500">
              Décrivez ce que vous voulez automatiser. L&apos;IA construit l&apos;automatisation en
              direct à droite.
            </p>
          </div>

          {selectedStats && (
            <div className="shrink-0 border-b border-white/5 px-4 py-3">
              <AutomationStatsBar data={selectedStats} />
            </div>
          )}

          <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {loading ? (
              <p className="text-sm text-text-500">Chargement…</p>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bot className="mb-3 h-10 w-10 text-brand" />
                <p className="text-sm font-medium text-text-200">Qu&apos;est-ce que tu veux faire ?</p>
                <p className="mt-1 max-w-xs text-xs text-text-500">
                  Ex. « Lundi, envoie tel message à telle personne » ou « Prospecte le groupe X »
                </p>
              </div>
            ) : (
              <div className="mx-auto flex max-w-xl flex-col gap-3">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
                {sending && <TypingIndicator />}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 p-3">
            {!loading && messages.length === 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {BUILDER_SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void handleSend(s.prompt)}
                    disabled={sending}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-text-400 hover:bg-bg-200"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <KlanvioChatInput
              onSend={handleSend}
              disabled={sending}
              placeholder="Ex. Lundi à 8h, envoie « Bonjour » à +229…"
              hideHint
            />
          </div>
        </div>

        {/* Aperçu automatisation */}
        <div className="flex min-h-0 flex-1 flex-col bg-bg-100/50 lg:w-1/2">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
            <Sparkles className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-medium text-text-200">Automatisation en cours</h3>
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            {drafts.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-6 text-center">
                <p className="text-sm text-text-400">Rien encore de créé.</p>
                <p className="mt-1 text-xs text-text-500">
                  Dès que l&apos;IA crée ou modifie une automatisation, elle apparaît ici.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {drafts.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {drafts.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedId(d.id)}
                        className={cn(
                          'rounded-lg px-3 py-1 text-xs',
                          selected?.id === d.id
                            ? 'bg-brand text-white'
                            : 'border border-white/10 text-text-400 hover:bg-bg-200',
                        )}
                      >
                        #{d.id} {d.name.slice(0, 20)}
                      </button>
                    ))}
                  </div>
                )}

                {selected && (
                  <>
                    <AutomationListCard
                      auto={selected}
                      onStats={() => onStats(selected.id)}
                      onToggleStatus={() =>
                        void handleToggle(
                          selected.id,
                          selected.status === 'active' ? 'paused' : 'active',
                        )
                      }
                    />

                    {configPreview(selected).length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-bg-100 p-4">
                        <h4 className="text-xs font-medium uppercase tracking-wide text-text-500">
                          Configuration
                        </h4>
                        <ul className="mt-2 space-y-1">
                          {configPreview(selected).map((line) => (
                            <li key={line} className="text-sm text-text-300">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selected.status === 'paused' && (
                      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                        Brouillon — validez dans le chat (« oui, active ») ou cliquez Activer
                        ci-dessus.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
