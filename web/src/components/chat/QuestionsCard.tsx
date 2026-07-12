import { useMemo, useState } from 'react';
import { Check, ListChecks, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChoiceQuestion {
  id?: string;
  prompt: string;
  options: string[];
  allowMultiple?: boolean;
  allowOther?: boolean;
}

export interface QuestionsPayload {
  questions: ChoiceQuestion[];
}

interface QuestionsCardProps {
  payload: QuestionsPayload;
  /** Envoie les réponses compilées comme un nouveau message. */
  onSubmit?: (text: string) => void;
  /** Désactive l'interaction (ex. carte d'un ancien message). */
  disabled?: boolean;
}

const OTHER_KEY = '__other__';

function normalize(payload: QuestionsPayload): ChoiceQuestion[] {
  if (!payload || !Array.isArray(payload.questions)) return [];
  return payload.questions
    .filter((q) => q && typeof q.prompt === 'string' && Array.isArray(q.options))
    .map((q) => ({
      ...q,
      prompt: q.prompt.trim(),
      options: q.options.map((o) => String(o)).filter((o) => o.trim().length > 0),
    }))
    .filter((q) => q.prompt.length > 0 && q.options.length > 0);
}

export function QuestionsCard({ payload, onSubmit, disabled }: QuestionsCardProps) {
  const questions = useMemo(() => normalize(payload), [payload]);
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  if (questions.length === 0) return null;

  const isLocked = disabled || submitted;

  const toggle = (qIndex: number, value: string, allowMultiple?: boolean) => {
    if (isLocked) return;
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[qIndex] ?? []);
      if (allowMultiple) {
        if (current.has(value)) current.delete(value);
        else current.add(value);
      } else {
        if (current.has(value)) current.clear();
        else {
          current.clear();
          current.add(value);
        }
      }
      next[qIndex] = current;
      return next;
    });
  };

  const answersFor = (qIndex: number, q: ChoiceQuestion): string[] => {
    const set = selections[qIndex] ?? new Set<string>();
    const picked = q.options.filter((opt) => set.has(opt));
    if (set.has(OTHER_KEY) && otherText[qIndex]?.trim()) {
      picked.push(otherText[qIndex].trim());
    }
    return picked;
  };

  const hasAnyAnswer = questions.some((q, i) => answersFor(i, q).length > 0);

  const handleSubmit = () => {
    if (isLocked || !hasAnyAnswer) return;
    const lines = questions
      .map((q, i) => {
        const answers = answersFor(i, q);
        if (answers.length === 0) return null;
        return `• ${q.prompt} : ${answers.join(', ')}`;
      })
      .filter((l): l is string => l !== null);
    const text =
      lines.length === 1
        ? lines[0].replace(/^•\s*/, '')
        : `Voici mes réponses :\n${lines.join('\n')}`;
    setSubmitted(true);
    onSubmit?.(text);
  };

  return (
    <div className="mt-1 space-y-3 rounded-xl border border-brand-border bg-bg-100/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand">
        <ListChecks className="h-3.5 w-3.5" />
        Sélectionne tes réponses
      </div>

      {questions.map((q, qIndex) => {
        const set = selections[qIndex] ?? new Set<string>();
        return (
          <div key={q.id ?? qIndex} className="space-y-1.5">
            <p className="text-[13px] font-medium text-text-100">{q.prompt}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const active = set.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={isLocked}
                    onClick={() => toggle(qIndex, opt, q.allowMultiple)}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] transition-colors',
                      active
                        ? 'border-brand bg-brand text-white'
                        : 'border-white/15 bg-bg-200 text-text-200 hover:border-brand-border hover:bg-bg-300',
                      isLocked && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    {active && <Check className="h-3 w-3" />}
                    {opt}
                  </button>
                );
              })}
              {q.allowOther && (
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => toggle(qIndex, OTHER_KEY, q.allowMultiple)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[12.5px] transition-colors',
                    set.has(OTHER_KEY)
                      ? 'border-brand bg-brand text-white'
                      : 'border-dashed border-white/25 bg-bg-200 text-text-300 hover:border-brand-border',
                    isLocked && 'cursor-not-allowed opacity-70',
                  )}
                >
                  Autre…
                </button>
              )}
            </div>
            {q.allowOther && set.has(OTHER_KEY) && (
              <input
                type="text"
                value={otherText[qIndex] ?? ''}
                disabled={isLocked}
                onChange={(e) =>
                  setOtherText((prev) => ({ ...prev, [qIndex]: e.target.value }))
                }
                placeholder="Précise ta réponse…"
                className="w-full rounded-lg border border-white/15 bg-bg-200 px-2.5 py-1.5 text-[13px] text-text-100 outline-none placeholder:text-text-500 focus:border-brand-border disabled:opacity-70"
              />
            )}
          </div>
        );
      })}

      {!isLocked && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasAnyAnswer}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          Valider mes réponses
        </button>
      )}
      {submitted && (
        <p className="text-[12px] text-text-500">Réponses envoyées.</p>
      )}
    </div>
  );
}
