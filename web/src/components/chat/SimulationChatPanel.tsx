import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RotateCcw, Send } from 'lucide-react';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import {
  postSimulationPreview,
  validateSimulation,
  validateSimulationAndLaunch,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type Turn = { role: 'you' | 'prospect'; text: string };

function openerFromPlan(plan: AutomationVisualPlan): string {
  if (plan.openerText?.trim()) return plan.openerText.trim();
  const msg = plan.nodes?.find(
    (n) => n.kind === 'message' || /message|accroche|opener|ouverture/i.test(n.label ?? ''),
  );
  const text = (msg?.subtitle || msg?.label || '').trim();
  return text || 'Bonjour ! Je me permets de vous écrire rapidement.';
}

function guideFromPlan(plan: AutomationVisualPlan): string | undefined {
  const reply = plan.nodes?.find((n) => n.kind === 'reply' || n.kind === 'goal');
  return (reply?.subtitle || reply?.label || '').trim() || undefined;
}

type SimulationChatPanelProps = {
  plan: AutomationVisualPlan;
  className?: string;
  onLaunched?: (message: string) => void;
};

/** Chat de simulation à droite — aucun numéro WhatsApp, 0 envoi réel. */
export function SimulationChatPanel({ plan, className, onLaunched }: SimulationChatPanelProps) {
  const opener = useMemo(() => openerFromPlan(plan), [plan]);
  const guide = useMemo(() => guideFromPlan(plan), [plan]);
  const automationId = plan.automationId;

  const [history, setHistory] = useState<Turn[]>([{ role: 'you', text: opener }]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [awaitingActivateConfirm, setAwaitingActivateConfirm] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);

  useEffect(() => {
    setHistory([{ role: 'you', text: opener }]);
    setDraft('');
    setError(null);
    setFeedback(null);
    setDone(false);
    setAwaitingActivateConfirm(false);
    setConfirmPrompt(null);
    setLaunched(false);
    setLaunchMessage(null);
  }, [opener, plan.updatedAt, plan.automationId, plan.title]);

  async function sendAsProspect() {
    const text = draft.trim();
    if (!text || loading || done || awaitingActivateConfirm || launched) return;
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
    setAwaitingActivateConfirm(false);
    setConfirmPrompt(null);
  }

  async function handleValidate() {
    if (!automationId || validating || launched || awaitingActivateConfirm) return;
    setValidating(true);
    setError(null);
    try {
      const result = await validateSimulation(automationId);
      setAwaitingActivateConfirm(true);
      setConfirmPrompt(
        result.message ||
          `Simulation validée. Veux-tu activer « ${result.name || plan.title} » maintenant ?`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de valider');
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirmActivate() {
    if (!automationId || activating || launched) return;
    setActivating(true);
    setError(null);
    try {
      const result = await validateSimulationAndLaunch(automationId);
      setLaunched(true);
      setAwaitingActivateConfirm(false);
      setLaunchMessage(result.message || 'Automatisation lancée.');
      onLaunched?.(result.message || 'Automatisation lancée.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de lancer');
    } finally {
      setActivating(false);
    }
  }

  function handleLater() {
    setAwaitingActivateConfirm(false);
    setConfirmPrompt(null);
    setFeedback(
      'Simulation validée — tu pourras activer plus tard avec le bouton Lancer / en le demandant dans le chat.',
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <p className="mb-3 shrink-0 text-[12px] leading-relaxed text-text-500">
        Jouez le prospect ici (sans WhatsApp réel). Si la simulation vous convient, cliquez sur{' '}
        <span className="font-semibold text-text-200">Valider</span> — on vous demandera ensuite si
        vous voulez activer l’automatisation.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl bg-bg-100/80 p-3">
        {history.map((t, i) => (
          <div
            key={`${i}-${t.role}`}
            className={cn(
              'max-w-[95%] rounded-2xl px-3 py-2.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap',
              t.role === 'you'
                ? 'ml-auto bg-brand text-white'
                : 'mr-auto border border-black/[0.06] bg-white text-text-100',
            )}
          >
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
              {t.role === 'you' ? 'Agent' : 'Prospect (vous)'}
            </p>
            <p className="whitespace-pre-wrap break-words">{t.text}</p>
          </div>
        ))}
        {loading && (
          <div className="mr-auto flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-white px-3 py-2 text-[12px] text-text-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            L’agent répond…
          </div>
        )}
      </div>

      {feedback && !launched && !awaitingActivateConfirm && (
        <div className="mt-3 shrink-0 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-[12px] leading-relaxed text-amber-950 whitespace-pre-wrap">
          {feedback}
        </div>
      )}

      {awaitingActivateConfirm && confirmPrompt && !launched && (
        <div className="mt-3 shrink-0 space-y-2 rounded-xl border border-brand/25 bg-brand/5 px-3 py-3">
          <p className="text-[13px] leading-relaxed text-text-100">{confirmPrompt}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleConfirmActivate()}
              disabled={activating}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {activating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Activation…
                </>
              ) : (
                'Oui, activer'
              )}
            </button>
            <button
              type="button"
              onClick={handleLater}
              disabled={activating}
              className="flex flex-1 items-center justify-center rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[13px] font-medium text-text-200 hover:bg-bg-100 disabled:opacity-50"
            >
              Plus tard
            </button>
          </div>
        </div>
      )}

      {launchMessage && (
        <div className="mt-3 shrink-0 rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-950">
          {launchMessage}
        </div>
      )}

      {error && (
        <p className="mt-2 shrink-0 text-[12px] text-red-600" role="alert">
          {error}
        </p>
      )}

      {automationId != null && !launched && !awaitingActivateConfirm && (
        <button
          type="button"
          onClick={() => void handleValidate()}
          disabled={validating}
          className="mt-3 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50"
        >
          {validating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Validation…
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Valider
            </>
          )}
        </button>
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
          disabled={loading || done || launched || awaitingActivateConfirm}
          rows={2}
          placeholder={
            launched
              ? 'Automatisation lancée'
              : awaitingActivateConfirm
                ? 'Confirmez l’activation ci-dessus'
                : done
                  ? 'Simulation terminée — cliquez Valider'
                  : 'Répondez comme un prospect…'
          }
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[13px] text-text-100 placeholder:text-text-400 focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void sendAsProspect()}
          disabled={loading || done || launched || awaitingActivateConfirm || !draft.trim()}
          className="rounded-xl bg-brand p-2.5 text-white hover:bg-brand/90 disabled:opacity-40"
          aria-label="Envoyer"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
