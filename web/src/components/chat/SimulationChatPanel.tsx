import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Send } from 'lucide-react';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { postSimulationPreview } from '@/lib/api';
import { cn } from '@/lib/utils';

type Turn = { role: 'you' | 'prospect'; text: string };

function openerFromPlan(plan: AutomationVisualPlan): string {
  const msg = plan.nodes?.find(
    (n) => n.kind === 'message' || /message|accroche|opener/i.test(n.label ?? ''),
  );
  const text = (msg?.subtitle || msg?.label || '').trim();
  return text || 'Bonjour ! Je me permets de vous écrire rapidement 🙂';
}

function guideFromPlan(plan: AutomationVisualPlan): string | undefined {
  const reply = plan.nodes?.find((n) => n.kind === 'reply' || n.kind === 'goal');
  return (reply?.subtitle || reply?.label || '').trim() || undefined;
}

type SimulationChatPanelProps = {
  plan: AutomationVisualPlan;
  className?: string;
};

/** Chat de simulation à droite — aucun numéro WhatsApp, 0 envoi réel. */
export function SimulationChatPanel({ plan, className }: SimulationChatPanelProps) {
  const opener = useMemo(() => openerFromPlan(plan), [plan]);
  const guide = useMemo(() => guideFromPlan(plan), [plan]);

  const [history, setHistory] = useState<Turn[]>([{ role: 'you', text: opener }]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setHistory([{ role: 'you', text: opener }]);
    setDraft('');
    setError(null);
    setFeedback(null);
    setDone(false);
  }, [opener, plan.updatedAt, plan.automationId]);

  async function sendAsProspect() {
    const text = draft.trim();
    if (!text || loading || done) return;
    setLoading(true);
    setError(null);
    setDraft('');
    try {
      const result = await postSimulationPreview({
        opener,
        history,
        prospectMessage: text,
        guide,
      });
      setHistory(result.history);
      setDone(result.done);
      if (result.feedbackPrompt) setFeedback(result.feedbackPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation impossible');
      setDraft(text);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setHistory([{ role: 'you', text: opener }]);
    setDraft('');
    setError(null);
    setFeedback(null);
    setDone(false);
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <p className="mb-3 shrink-0 text-[12px] leading-relaxed text-text-500">
        Jouez le prospect ici. L’IA répond comme votre agent — sans WhatsApp réel. Max 4
        messages, puis feedback pour améliorer.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl bg-bg-100/80 p-3">
        {history.map((t, i) => (
          <div
            key={`${i}-${t.role}`}
            className={cn(
              'max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-snug',
              t.role === 'you'
                ? 'ml-auto bg-brand text-white'
                : 'mr-auto border border-black/[0.06] bg-white text-text-100',
            )}
          >
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
              {t.role === 'you' ? 'Agent' : 'Prospect (vous)'}
            </p>
            {t.text}
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-white px-3 py-2 text-[12px] text-text-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            L’agent répond…
          </div>
        )}
      </div>

      {feedback && (
        <div className="mt-3 shrink-0 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-[12px] leading-relaxed text-amber-950 whitespace-pre-wrap">
          {feedback}
        </div>
      )}

      {error && (
        <p className="mt-2 shrink-0 text-[12px] text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 flex shrink-0 items-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl border border-black/[0.08] p-2.5 text-text-500 hover:bg-bg-200 hover:text-text-100"
          title="Recommencer"
          aria-label="Recommencer la simulation"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendAsProspect();
            }
          }}
          disabled={loading || done}
          rows={2}
          placeholder={
            done
              ? 'Simulation terminée — recommencez ou validez au milieu'
              : 'Répondez comme un prospect…'
          }
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[13px] text-text-100 placeholder:text-text-400 focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void sendAsProspect()}
          disabled={loading || done || !draft.trim()}
          className="rounded-xl bg-brand p-2.5 text-white hover:bg-brand/90 disabled:opacity-40"
          aria-label="Envoyer"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
