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

/** Résolution native iPhone (échelle visuelle via aspect-ratio). */
const IPHONE_W = 1179;
const IPHONE_H = 2556;

/** Insets de l’écran dans le mockup `iphone-frame.png` (écran percé, island conservée). */
const SCREEN_INSET = {
  top: '2.2%',
  right: '6.5%',
  bottom: '7.9%',
  left: '6.5%',
} as const;

type PhoneSimulationPanelProps = {
  threadId: number | null;
  purpose: ThreadPurpose | null;
  automationId: number | null;
  messages: ChatMessage[];
  className?: string;
};

type PersistedPhoneSim = {
  bubbles: PhoneBubble[];
  /** Clé de la dernière simu agent volontairement ignorée après « Effacer ». */
  ignoredSimKey: string | null;
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

function storageKey(threadId: number): string {
  return `klanvio.phoneSim.v1.${threadId}`;
}

function simKeyOf(bubbles: PhoneBubble[]): string {
  return bubbles.map((b) => `${b.role}:${b.text}`).join('|');
}

function loadPersisted(threadId: number): PersistedPhoneSim | null {
  try {
    const raw = localStorage.getItem(storageKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPhoneSim;
    if (!parsed || !Array.isArray(parsed.bubbles)) return null;
    return {
      bubbles: parsed.bubbles.filter(
        (b) =>
          b &&
          (b.role === 'you' || b.role === 'prospect') &&
          typeof b.text === 'string' &&
          b.text.trim(),
      ),
      ignoredSimKey: typeof parsed.ignoredSimKey === 'string' ? parsed.ignoredSimKey : null,
    };
  } catch {
    return null;
  }
}

function savePersisted(threadId: number, data: PersistedPhoneSim): void {
  try {
    localStorage.setItem(storageKey(threadId), JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

function clearPersisted(threadId: number): void {
  try {
    localStorage.removeItem(storageKey(threadId));
  } catch {
    /* ignore */
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
  /** Fil affiché / joué sur l’iPhone (persisté). */
  const [phoneBubbles, setPhoneBubbles] = useState<PhoneBubble[]>([]);
  const [ignoredSimKey, setIgnoredSimKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAppliedSimKeyRef = useRef('');

  // Charger / hydrater au changement de fil
  useEffect(() => {
    setDraft('');
    setError('');
    setOpener('');
    setGuide('');
    setOffer('');
    lastAppliedSimKeyRef.current = '';
    setHydrated(false);

    if (threadId == null) {
      setPhoneBubbles([]);
      setIgnoredSimKey(null);
      setHydrated(true);
      return;
    }

    const stored = loadPersisted(threadId);
    setPhoneBubbles(stored?.bubbles ?? []);
    setIgnoredSimKey(stored?.ignoredSimKey ?? null);
    if (stored?.bubbles?.length) {
      lastAppliedSimKeyRef.current = simKeyOf(stored.bubbles);
    }
    setHydrated(true);
  }, [threadId]);

  // Persister l’échange (sauf si vide + pas d’ignore → on peut nettoyer la clé)
  useEffect(() => {
    if (!hydrated || threadId == null) return;
    if (phoneBubbles.length === 0 && !ignoredSimKey) {
      clearPersisted(threadId);
      return;
    }
    savePersisted(threadId, { bubbles: phoneBubbles, ignoredSimKey });
  }, [hydrated, threadId, phoneBubbles, ignoredSimKey]);

  // Opener / guide campagne
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
        /* pas de campagne encore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, automationId, messages.length]);

  const simBubbles = useMemo(() => extractLatestSimulationBubbles(messages), [messages]);
  const currentSimKey = useMemo(
    () => (simBubbles.length >= 2 ? simKeyOf(simBubbles) : ''),
    [simBubbles],
  );

  // Nouvelle simu agent → remplace l’écran (sauf si cette simu a été effacée)
  useEffect(() => {
    if (!hydrated || !currentSimKey || simBubbles.length < 2) return;
    if (currentSimKey === ignoredSimKey) return;
    if (currentSimKey === lastAppliedSimKeyRef.current) return;
    lastAppliedSimKeyRef.current = currentSimKey;
    setIgnoredSimKey(null);
    setPhoneBubbles(simBubbles);
  }, [hydrated, currentSimKey, simBubbles, ignoredSimKey]);

  // Prospection : afficher l’opener si écran vide et pas d’effacement volontaire
  useEffect(() => {
    if (!hydrated || isSupport) return;
    if (phoneBubbles.length > 0) return;
    if (ignoredSimKey) return;
    if (!opener.trim()) return;
    if (currentSimKey && currentSimKey !== ignoredSimKey) return;
    setPhoneBubbles([{ id: 'opener', role: 'you', text: opener }]);
  }, [hydrated, isSupport, phoneBubbles.length, ignoredSimKey, opener, currentSimKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [phoneBubbles.length, busy]);

  function handleClearDiscussion() {
    const keyToIgnore = currentSimKey || lastAppliedSimKeyRef.current || null;
    setPhoneBubbles([]);
    setIgnoredSimKey(keyToIgnore);
    setDraft('');
    setError('');
    lastAppliedSimKeyRef.current = '';
    if (threadId != null) {
      savePersisted(threadId, { bubbles: [], ignoredSimKey: keyToIgnore });
    }
  }

  async function sendAsProspect() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setDraft('');

    const base = phoneBubbles;
    const withProspect: PhoneBubble[] = [
      ...base,
      { id: `p-${Date.now()}`, role: 'prospect', text, name: 'Prospect' },
    ];
    setPhoneBubbles(withProspect);
    setIgnoredSimKey(null);

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
      setPhoneBubbles(next);
      if (result.done && result.feedbackPrompt) {
        setError(result.feedbackPrompt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation impossible.');
      setPhoneBubbles(base);
    } finally {
      setBusy(false);
    }
  }

  const helpLine = isSupport
    ? 'Tapez comme un client pour tester la réponse. Aucun envoi WhatsApp réel.'
    : purpose === 'groupes'
      ? 'Aperçu d’un message publié dans un groupe. Aucun envoi WhatsApp réel.'
      : 'Aperçu du premier contact et des échanges. Testez sans envoyer sur WhatsApp.';

  const canClear = phoneBubbles.length > 0;

  return (
    <aside
      className={cn(
        'hidden h-full shrink-0 border-l border-black/[0.06] bg-bg-100/90 lg:flex',
        className,
      )}
      aria-label="Aperçu simulation WhatsApp"
    >
      <div className="flex h-full w-[min(48vw,440px)] flex-col items-center px-3">
        <div className="flex w-full shrink-0 flex-col items-center pt-4 pb-2">
          <p className="max-w-[340px] text-center text-[13px] font-medium leading-relaxed text-text-300">
            {helpLine}
          </p>
        </div>

        <div className="flex min-h-0 w-full flex-1 items-center justify-center py-2">
          <div
            className="relative h-full max-h-full shrink-0"
            style={{
              aspectRatio: `${IPHONE_W} / ${IPHONE_H}`,
              maxWidth: '100%',
              width: 'auto',
            }}
          >
            {/* Contenu WhatsApp dans l’écran du mockup */}
            <div
              className="absolute z-10 flex min-h-0 flex-col overflow-hidden bg-black"
              style={{
                top: SCREEN_INSET.top,
                right: SCREEN_INSET.right,
                bottom: SCREEN_INSET.bottom,
                left: SCREEN_INSET.left,
                borderRadius: '12.5% / 6.2%',
              }}
            >
              {/* Espace sous la Dynamic Island du mockup */}
              <div className="relative z-20 flex items-center justify-between bg-[#075E54] px-[6%] pb-1 pt-[7%] text-[clamp(9px,2.6cqi,11px)] font-semibold tracking-tight text-white">
                <span className="min-w-[2.5rem]">{nowTimeLabel()}</span>
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

              <div className="flex items-center gap-2.5 border-b border-black/10 bg-[#075E54] px-3 py-2 text-white">
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

              <div
                ref={scrollRef}
                className="flex-1 space-y-2 overflow-y-auto px-2.5 py-3"
                style={{
                  backgroundColor: '#ECE5DD',
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23c4b8a8\' fill-opacity=\'0.12\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/svg%3E")',
                }}
              >
                {phoneBubbles.length === 0 ? (
                  <div className="flex h-full min-h-[120px] items-center justify-center px-4 text-center">
                    <p className="text-[12px] leading-relaxed text-zinc-600">
                      {isSupport
                        ? 'En attente d’un message entrant…'
                        : 'Le premier message s’affichera ici après le brief ou la simulation.'}
                    </p>
                  </div>
                ) : (
                  phoneBubbles.map((b) => (
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
                <div className="mx-auto mt-2 mb-1 h-[4px] w-[36%] max-w-[108px] rounded-full bg-zinc-900/85" />
              </div>
            </div>

            <img
              src="/images/iphone-frame.png"
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full select-none object-fill"
            />
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-2 pt-2 pb-4">
          <button
            type="button"
            onClick={handleClearDiscussion}
            disabled={!canClear}
            className={cn(
              'rounded-lg border px-3.5 py-2 text-[12px] font-semibold transition',
              canClear
                ? 'border-red-500/40 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700'
                : 'cursor-not-allowed border-red-200/60 bg-red-50/40 text-red-300',
            )}
          >
            Effacer la discussion
          </button>
        </div>
      </div>
    </aside>
  );
}
