import { useEffect, useMemo, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
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

  // Reset au changement de fil
  useEffect(() => {
    setInteractive([]);
    setDraft('');
    setError('');
    setOpener('');
    setGuide('');
    setOffer('');
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

  const helpTitle = isSupport ? 'Simulation support' : 'Simulation prospection';
  const helpBody = isSupport
    ? 'L’écran reste vide jusqu’à ce qu’un client écrive. Tape ici comme un prospect pour voir comment l’agent répond — sans envoyer sur WhatsApp. Les changements demandés dans le chat mettent à jour le comportement.'
    : 'Le premier message de contact s’affiche ici. Quand l’agent lance une simulation dans le chat, le fil apparaît sur le téléphone. Demande dans le chat de changer le ton, l’accroche ou le script — l’aperçu se met à jour. Aucun envoi réel.';

  return (
    <aside
      className={cn(
        'hidden h-full shrink-0 border-l border-black/[0.06] bg-bg-50/80 lg:flex',
        className,
      )}
      aria-label="Aperçu simulation WhatsApp"
    >
      <div className="flex h-full w-[min(42vw,460px)] items-center justify-center gap-3 px-3 py-4">
        {/* Téléphone centré */}
        <div className="flex h-full max-h-[720px] w-[270px] shrink-0 flex-col items-center justify-center">
          <div className="relative flex h-[min(100%,640px)] w-full flex-col overflow-hidden rounded-[2rem] border-[3px] border-zinc-800 bg-zinc-900 shadow-xl">
            {/* Notch */}
            <div className="absolute left-1/2 top-0 z-20 h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-zinc-900" />

            {/* Status bar */}
            <div className="relative z-10 flex items-center justify-between px-5 pb-1 pt-3 text-[10px] font-medium text-zinc-300">
              <span>{nowTimeLabel()}</span>
              <span className="flex items-center gap-1">
                <Smartphone className="h-3 w-3 opacity-70" />
                Sim
              </span>
            </div>

            {/* Chat header */}
            <div className="border-b border-white/10 bg-[#075E54] px-3 py-2.5 text-white">
              <p className="text-[11px] font-semibold tracking-wide">
                {isSupport ? 'Client WhatsApp' : 'Prospect'}
              </p>
              <p className="text-[10px] text-white/70">
                {isSupport ? 'Support — messages entrants' : 'Prospection — aperçu'}
              </p>
            </div>

            {/* Bubbles */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-2 overflow-y-auto bg-[#ECE5DD] px-2.5 py-3"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 20% 20%, rgba(0,0,0,0.03) 0, transparent 40%)',
              }}
            >
              {bubbles.length === 0 ? (
                <div className="flex h-full min-h-[200px] items-center justify-center px-4 text-center">
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
                        'max-w-[88%] rounded-xl px-2.5 py-1.5 text-[12px] leading-snug shadow-sm',
                        b.role === 'you'
                          ? 'rounded-br-sm bg-[#DCF8C6] text-zinc-900'
                          : 'rounded-bl-sm bg-white text-zinc-900',
                      )}
                    >
                      {b.role === 'prospect' && b.name ? (
                        <p className="mb-0.5 text-[10px] font-semibold text-emerald-700">{b.name}</p>
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

            {/* Composer prospect */}
            <div className="border-t border-black/10 bg-[#F0F0F0] px-2 py-2">
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
                  className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-emerald-600/40"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  className="rounded-full bg-[#075E54] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  OK
                </button>
              </form>
              {error ? (
                <p className="mt-1.5 px-1 text-[10px] leading-snug text-amber-800">{error}</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Consignes à droite du téléphone */}
        <div className="hidden w-[140px] shrink-0 flex-col justify-center xl:flex">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-400">
            {helpTitle}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-text-500">{helpBody}</p>
          <p className="mt-3 text-[11px] leading-relaxed text-text-500">
            Campagne active : demande les modifs dans le chat — l’aperçu suit.
          </p>
        </div>
      </div>
    </aside>
  );
}
