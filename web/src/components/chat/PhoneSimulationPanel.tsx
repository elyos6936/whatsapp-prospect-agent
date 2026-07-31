import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchThreadCampaign,
  postSimulationPreview,
  type ChatMessage,
  type ThreadPurpose,
} from '@/lib/api';
import {
  extractLatestSimulationBubbles,
  type PhoneBubble,
} from '@/lib/parse-simulation-turns';
import { cn } from '@/lib/utils';

type PhoneSimulationPanelProps = {
  threadId: number | null;
  purpose: ThreadPurpose | null;
  automationId: number | null;
  messages: ChatMessage[];
  className?: string;
};

function nowTimeLabel(): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
  } catch {
    return '';
  }
}

export function PhoneSimulationPanel({
  threadId,
  purpose,
  automationId,
  messages,
  className,
}: PhoneSimulationPanelProps) {
  const isSupport = purpose === 'support';
  const [opener, setOpener] = useState('');
  const [guide, setGuide] = useState('');
  const [offer, setOffer] = useState('');
  const [interactive, setInteractive] = useState<PhoneBubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSimKeyRef = useRef('');

  // Reset au changement de fil
  useEffect(() => {
    setInteractive([]);
    setDraft('');
    setError('');
    setOpener('');
    setGuide('');
    setOffer('');
    lastSimKeyRef.current = '';
  }, [threadId]);

  // Charger opener / guide depuis la campagne liée
  useEffect(() => {
    if (threadId == null || automationId == null) {
      setOpener('');
      setGuide('');
      setOffer('');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchThreadCampaign(threadId);
        if (cancelled) return;
        const cfg = (data.detail?.automation?.config ?? {}) as Record<string, unknown>;
        const initial =
          String(cfg.initialMessage ?? cfg.initial_message ?? '').trim() ||
          String((cfg.visualPlan as { openerText?: string } | undefined)?.openerText ?? '').trim();
        setOpener(initial);
        setGuide(String(cfg.conversationGuide ?? cfg.conversation_guide ?? '').trim());
        setOffer(String(cfg.productName ?? cfg.product_name ?? '').trim());
      } catch {
        if (!cancelled) {
          /* pas de campagne encore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, automationId, messages.length]);

  const simBubbles = useMemo(() => extractLatestSimulationBubbles(messages), [messages]);

  // Nouvelle simu agent → reprendre le fil chat (ne pas rester bloqué sur l’interaction locale)
  useEffect(() => {
    if (simBubbles.length < 2) return;
    const key = simBubbles.map((b) => `${b.role}:${b.text}`).join('|');
    if (key === lastSimKeyRef.current) return;
    lastSimKeyRef.current = key;
    setInteractive([]);
  }, [simBubbles]);

  const bubbles: PhoneBubble[] = useMemo(() => {
    if (interactive.length > 0) return interactive;
    if (simBubbles.length > 0) return simBubbles;
    if (!isSupport && opener) {
      return [{ id: 'opener', role: 'you', text: opener }];
    }
    return [];
  }, [interactive, simBubbles, isSupport, opener]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles.length, busy]);

  async function sendAsProspect() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setDraft('');

    const base: PhoneBubble[] =
      interactive.length > 0
        ? interactive
        : simBubbles.length > 0
          ? simBubbles
          : !isSupport && opener
            ? [{ id: 'opener', role: 'you' as const, text: opener }]
            : [];

    const withProspect: PhoneBubble[] = [
      ...base,
      { id: `p-${Date.now()}`, role: 'prospect', text, name: 'Prospect' },
    ];
    setInteractive(withProspect);

    try {
      const history = base.map((b) => ({
        role: b.role,
        text: b.text,
      }));
      const result = await postSimulationPreview({
        opener: isSupport ? '' : opener || base.find((b) => b.role === 'you')?.text || '',
        history,
        prospectMessage: text,
        guide: guide || undefined,
        offer: offer || undefined,
        mode: isSupport ? 'inbound' : 'outbound',
      });
      const next = (result.history ?? []).map((t, i) => ({
        id: `h-${i}-${t.role}`,
        role: t.role,
        text: t.text,
        name: t.role === 'prospect' ? 'Prospect' : undefined,
      }));
      if (result.reply?.trim() && !next.some((n) => n.role === 'you' && n.text === result.reply)) {
        next.push({ id: `r-${Date.now()}`, role: 'you', text: result.reply.trim() });
      }
      setInteractive(next);
      if (result.done && result.feedbackPrompt) {
        setError(result.feedbackPrompt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation impossible.');
      setInteractive(base);
    } finally {
      setBusy(false);
    }
  }

  const helpLine = isSupport
    ? 'Tapez comme un client pour tester la réponse — aucun envoi WhatsApp réel.'
    : 'Aperçu du premier contact et des échanges — testez sans envoyer sur WhatsApp.';

  return (
    <aside
      className={cn(
        'hidden h-full shrink-0 border-l border-black/[0.06] bg-bg-100/90 lg:flex',
        className,
      )}
      aria-label="Aperçu simulation WhatsApp"
    >
      <div className="flex h-full w-[min(36vw,340px)] flex-col items-center justify-center px-4 py-5">
        <p className="mb-3 max-w-[280px] text-center text-[12px] leading-snug text-text-500">
          {helpLine}
        </p>

        {/* Coque iPhone */}
        <div className="relative flex h-[min(100%,680px)] w-[278px] shrink-0 items-stretch justify-center">
          {/* Boutons latéraux */}
          <div
            className="absolute -left-[3px] top-[118px] z-30 h-[28px] w-[3px] rounded-l-sm bg-gradient-to-b from-zinc-500 to-zinc-700"
            aria-hidden
          />
          <div
            className="absolute -left-[3px] top-[168px] z-30 h-[52px] w-[3px] rounded-l-sm bg-gradient-to-b from-zinc-500 to-zinc-700"
            aria-hidden
          />
          <div
            className="absolute -left-[3px] top-[230px] z-30 h-[52px] w-[3px] rounded-l-sm bg-gradient-to-b from-zinc-500 to-zinc-700"
            aria-hidden
          />
          <div
            className="absolute -right-[3px] top-[190px] z-30 h-[88px] w-[3px] rounded-r-sm bg-gradient-to-b from-zinc-500 to-zinc-700"
            aria-hidden
          />

          <div
            className="relative flex h-full w-full flex-col overflow-hidden rounded-[2.65rem] p-[10px]"
            style={{
              background:
                'linear-gradient(145deg, #3f3f46 0%, #18181b 38%, #27272a 62%, #09090b 100%)',
              boxShadow:
                '0 28px 56px -18px rgba(15, 23, 42, 0.45), 0 0 0 1px rgba(255,255,255,0.08) inset, 0 1px 0 rgba(255,255,255,0.18) inset',
            }}
          >
            {/* Reflet bezel */}
            <div
              className="pointer-events-none absolute inset-0 z-20 rounded-[2.65rem]"
              style={{
                background:
                  'linear-gradient(125deg, rgba(255,255,255,0.22) 0%, transparent 28%, transparent 72%, rgba(255,255,255,0.06) 100%)',
              }}
              aria-hidden
            />

            {/* Écran */}
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.15rem] bg-black">
              {/* Dynamic Island */}
              <div className="pointer-events-none absolute left-1/2 top-[10px] z-30 h-[28px] w-[96px] -translate-x-1/2 rounded-full bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
                <div className="absolute right-[18px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full bg-[#0c1220] ring-1 ring-zinc-800" />
              </div>

              {/* Status bar iOS */}
              <div className="relative z-20 flex items-center justify-between px-6 pb-1 pt-[14px] text-[11px] font-semibold tracking-tight text-white">
                <span className="min-w-[42px]">{nowTimeLabel()}</span>
                <div className="flex items-center gap-[5px]">
                  <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor" aria-hidden>
                    <rect x="0" y="7" width="2.5" height="4" rx="0.5" opacity="0.35" />
                    <rect x="3.5" y="5" width="2.5" height="6" rx="0.5" opacity="0.55" />
                    <rect x="7" y="2.5" width="2.5" height="8.5" rx="0.5" opacity="0.75" />
                    <rect x="10.5" y="0" width="2.5" height="11" rx="0.5" />
                  </svg>
                  <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor" aria-hidden>
                    <path d="M7 2.2c1.7 0 3.2.7 4.3 1.8l-1.1 1.1A4.4 4.4 0 0 0 7 3.8c-1.2 0-2.3.5-3.1 1.3L2.8 4A5.8 5.8 0 0 1 7 2.2Zm0 2.8c1 0 1.9.4 2.6 1.1L8.5 7.2A2.2 2.2 0 0 0 7 6.5c-.6 0-1.1.2-1.5.6L4.4 6.1A3.6 3.6 0 0 1 7 5Zm0 2.8c.5 0 .9.2 1.2.5L7 9.5 5.8 8.3c.3-.3.7-.5 1.2-.5Z" />
                  </svg>
                  <div className="relative h-[10px] w-[22px] rounded-[3px] border border-white/90">
                    <div className="absolute inset-[1.5px] right-[3px] rounded-[1.5px] bg-white" />
                    <div className="absolute -right-[3px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r-sm bg-white/90" />
                  </div>
                </div>
              </div>

              {/* En-tête WhatsApp */}
              <div className="flex items-center gap-2.5 border-b border-black/10 bg-[#075E54] px-3 py-2.5 text-white">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">
                  {isSupport ? 'C' : 'P'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold leading-tight tracking-wide">
                    {isSupport ? 'Client WhatsApp' : 'Prospect'}
                  </p>
                  <p className="text-[10px] text-white/70">
                    {isSupport ? 'en ligne' : 'aperçu simulation'}
                  </p>
                </div>
              </div>

              {/* Bulles */}
              <div
                ref={scrollRef}
                className="flex-1 space-y-2 overflow-y-auto px-2.5 py-3"
                style={{
                  backgroundColor: '#ECE5DD',
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23c4b8a8\' fill-opacity=\'0.12\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/svg%3E")',
                }}
              >
                {bubbles.length === 0 ? (
                  <div className="flex h-full min-h-[180px] items-center justify-center px-4 text-center">
                    <p className="text-[12px] leading-relaxed text-zinc-600">
                      {isSupport
                        ? 'En attente d’un message entrant…'
                        : 'Le premier message s’affichera ici après le brief ou la simulation.'}
                    </p>
                  </div>
                ) : (
                  bubbles.map((b) => (
                    <div
                      key={b.id}
                      className={cn('flex', b.role === 'you' ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[88%] rounded-2xl px-2.5 py-1.5 text-[12.5px] leading-snug shadow-sm',
                          b.role === 'you'
                            ? 'rounded-br-md bg-[#DCF8C6] text-zinc-900'
                            : 'rounded-bl-md bg-white text-zinc-900',
                        )}
                      >
                        {b.role === 'prospect' && b.name ? (
                          <p className="mb-0.5 text-[10px] font-semibold text-emerald-700">
                            {b.name}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap">{b.text}</p>
                      </div>
                    </div>
                  ))
                )}
                {busy ? (
                  <p className="px-2 text-[11px] text-zinc-500">L’agent répond…</p>
                ) : null}
              </div>

              {/* Composer */}
              <div className="border-t border-black/5 bg-[#F0F0F0] px-2 pb-1 pt-2">
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendAsProspect();
                  }}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy}
                    placeholder={
                      isSupport ? 'Écrire comme le client…' : 'Répondre comme le prospect…'
                    }
                    className="min-w-0 flex-1 rounded-full border border-black/8 bg-white px-3.5 py-2 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-emerald-600/35"
                  />
                  <button
                    type="submit"
                    disabled={busy || !draft.trim()}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-40"
                    aria-label="Envoyer comme prospect"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  </button>
                </form>
                {error ? (
                  <p className="mt-1.5 px-1 text-[10px] leading-snug text-amber-800">{error}</p>
                ) : null}
                {/* Home indicator */}
                <div className="mx-auto mt-2 mb-1 h-[4px] w-[108px] rounded-full bg-zinc-900/85" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
