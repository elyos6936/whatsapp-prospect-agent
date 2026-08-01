import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { PanelRightClose, PanelRightOpen, Trash2 } from 'lucide-react';
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
import MobileMockup, { type ChatMessage as WaMsg } from '@/components/ui/great-ui-mobile-mockup';

const COLLAPSE_KEY = 'klanvio.phoneSim.collapsed';
const WIDTH_KEY = 'klanvio.phoneSim.width';
const RAIL_W = 44;
const MIN_W = 340;
const MAX_W = 520;
const DEFAULT_W = 380;

type PhoneSimulationPanelProps = {
  threadId: number | null;
  purpose: ThreadPurpose | null;
  automationId: number | null;
  messages: ChatMessage[];
  className?: string;
};

type PersistedPhoneSim = {
  bubbles: PhoneBubble[];
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
  return `klanvio.phoneSim.v2.${threadId}`;
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
    /* ignore */
  }
}

function clearPersisted(threadId: number): void {
  try {
    localStorage.removeItem(storageKey(threadId));
  } catch {
    /* ignore */
  }
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n) && n >= MIN_W && n <= MAX_W) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_W;
}

export function PhoneSimulationPanel({
  threadId,
  purpose,
  automationId,
  messages,
  className,
}: PhoneSimulationPanelProps) {
  const isSupport = purpose === 'support';
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [panelWidth, setPanelWidth] = useState(loadWidth);
  const [opener, setOpener] = useState('');
  const [guide, setGuide] = useState('');
  const [offer, setOffer] = useState('');
  const [phoneBubbles, setPhoneBubbles] = useState<PhoneBubble[]>([]);
  const [ignoredSimKey, setIgnoredSimKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const lastAppliedSimKeyRef = useRef('');
  const timeLabel = useMemo(() => nowTimeLabel(), [phoneBubbles.length, busy]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(panelWidth));
    } catch {
      /* ignore */
    }
  }, [panelWidth]);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: panelWidth };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startX - ev.clientX;
        setPanelWidth(Math.min(MAX_W, Math.max(MIN_W, dragRef.current.startW + delta)));
      };
      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [panelWidth],
  );

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
    const bubbles = stored?.bubbles ?? [];
    if (purpose === 'support') {
      const inboundTest = bubbles.some((b) => b.role === 'prospect');
      setPhoneBubbles(inboundTest ? bubbles : []);
      setIgnoredSimKey(inboundTest ? stored?.ignoredSimKey ?? null : null);
      if (inboundTest && bubbles.length) lastAppliedSimKeyRef.current = simKeyOf(bubbles);
    } else {
      const ok =
        bubbles.length === 0 ||
        (bubbles.length === 1 && bubbles[0]?.role === 'you') ||
        (bubbles.some((b) => b.role === 'you') && bubbles.some((b) => b.role === 'prospect'));
      setPhoneBubbles(ok ? bubbles : []);
      setIgnoredSimKey(ok ? stored?.ignoredSimKey ?? null : null);
      if (ok && bubbles.length) lastAppliedSimKeyRef.current = simKeyOf(bubbles);
    }
    setHydrated(true);
  }, [threadId, purpose]);

  useEffect(() => {
    if (!hydrated || threadId == null) return;
    if (phoneBubbles.length === 0 && !ignoredSimKey) {
      clearPersisted(threadId);
      return;
    }
    savePersisted(threadId, { bubbles: phoneBubbles, ignoredSimKey });
  }, [hydrated, threadId, phoneBubbles, ignoredSimKey]);

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
        /* ignore */
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

  useEffect(() => {
    if (!hydrated || !currentSimKey || simBubbles.length < 2) return;
    if (currentSimKey === ignoredSimKey) return;
    if (currentSimKey === lastAppliedSimKeyRef.current) return;
    lastAppliedSimKeyRef.current = currentSimKey;
    setIgnoredSimKey(null);
    setPhoneBubbles(simBubbles);
  }, [hydrated, currentSimKey, simBubbles, ignoredSimKey]);

  useEffect(() => {
    if (!hydrated || isSupport) return;
    if (currentSimKey && currentSimKey !== ignoredSimKey) return;
    if (ignoredSimKey) return;

    const looksValid =
      phoneBubbles.length === 0 ||
      (phoneBubbles.length === 1 && phoneBubbles[0]?.role === 'you') ||
      (phoneBubbles.some((b) => b.role === 'you') &&
        phoneBubbles.some((b) => b.role === 'prospect'));

    if (!looksValid) {
      setPhoneBubbles(
        opener.trim() ? [{ id: 'opener', role: 'you', text: opener.trim() }] : [],
      );
      lastAppliedSimKeyRef.current = '';
      return;
    }

    if (!opener.trim()) return;
    if (phoneBubbles.length > 0) return;
    setPhoneBubbles([{ id: 'opener', role: 'you', text: opener.trim() }]);
  }, [hydrated, isSupport, phoneBubbles, ignoredSimKey, opener, currentSimKey]);

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
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    });
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
      const history = base.map((b) => ({ role: b.role, text: b.text }));
      const result = await postSimulationPreview({
        opener: isSupport ? '' : opener || base.find((b) => b.role === 'you')?.text || '',
        history,
        prospectMessage: text,
        guide: guide || undefined,
        offer: offer || undefined,
        mode: isSupport ? 'inbound' : 'outbound',
        threadId,
      });
      const next: PhoneBubble[] = (result.history ?? []).map((t, i) => ({
        id: `h-${i}-${t.role}`,
        role: t.role,
        text: t.text,
        name: t.role === 'prospect' ? 'Prospect' : undefined,
      }));
      if (result.reply?.trim() && !next.some((n) => n.role === 'you' && n.text === result.reply)) {
        next.push({ id: `r-${Date.now()}`, role: 'you', text: result.reply.trim() });
      }
      setPhoneBubbles(next);
      if (result.done && result.feedbackPrompt) setError(result.feedbackPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation impossible.');
      setPhoneBubbles(base);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        if (inputRef.current) inputRef.current.style.height = "auto";
      });
    }
  }

  const waMessages: WaMsg[] = phoneBubbles.map((b) => ({
    id: b.id,
    sender: b.role === 'prospect' ? b.name || 'Prospect' : 'Vous',
    text: b.text,
    isCurrentUser: b.role === 'you',
    timestamp: timeLabel,
  }));

  const canClear = phoneBubbles.length > 0;
  const helpLine = isSupport
    ? 'Écrivez comme un client pour tester la réponse.'
    : purpose === 'groupes'
      ? 'Aperçu groupe — aucun envoi réel.'
      : 'Testez ici · rien n’est envoyé sur WhatsApp.';

  return (
    <aside
      className={cn(
        'relative hidden h-full shrink-0 overflow-hidden border-l border-black/[0.06] bg-bg-100 lg:flex',
        className,
      )}
      style={{ width: collapsed ? RAIL_W : panelWidth }}
      aria-label="Simulation WhatsApp"
    >
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner"
          onMouseDown={onResizeStart}
          className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize hover:bg-emerald-500/30 active:bg-emerald-500/40"
        />
      )}

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex h-full w-full flex-col items-center justify-center gap-3 text-text-400 transition hover:bg-black/[0.03] hover:text-emerald-700"
          aria-label="Ouvrir la simulation"
          title="Ouvrir la simulation"
        >
          <PanelRightOpen className="h-4 w-4" strokeWidth={1.8} />
          <span className="text-[10px] font-semibold tracking-[0.14em] [writing-mode:vertical-rl]">
            SIMU
          </span>
        </button>
      ) : (
        <div className="flex h-full min-w-0 flex-1 flex-col pl-1.5">
          <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-400 transition hover:bg-black/5 hover:text-text-200"
              aria-label="Réduire"
              title="Réduire"
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700/80">
                Simulation
              </p>
              <p className="truncate text-[12px] text-text-300">{helpLine}</p>
            </div>
            <button
              type="button"
              onClick={handleClearDiscussion}
              disabled={!canClear}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                canClear
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : 'cursor-not-allowed bg-zinc-100 text-zinc-300',
              )}
            >
              <Trash2 className="h-3 w-3" strokeWidth={2} />
              Effacer
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-2 pb-3">
            <MobileMockup
              interactive
              autoPlay={false}
              headerTitle={isSupport ? 'Client' : 'Prospect'}
              headerSubtitle={isSupport ? 'en ligne' : 'simulation'}
              avatarFallback={isSupport ? 'C' : 'P'}
              messages={waMessages}
              draft={draft}
              onDraftChange={setDraft}
              onSend={() => void sendAsProspect()}
              busy={busy}
              placeholder={isSupport ? 'Message du client…' : 'Répondre comme le prospect…'}
              inputRef={inputRef}
              scrollRef={scrollRef}
              emptyHint={
                isSupport
                  ? 'Tapez un message client pour tester.'
                  : 'Le premier message apparaîtra ici.'
              }
            />
          </div>

          {error ? (
            <p className="shrink-0 px-4 pb-3 text-[11px] text-amber-800">{error}</p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
