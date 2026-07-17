import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type NewAutomationModalProps = {
  open: boolean;
  busy?: boolean;
  onConfirm: (title: string, description: string) => void;
  onCancel: () => void;
};

/** Popup centrée : nom + courte description avant création d'une automatisation. */
export function NewAutomationModal({
  open,
  busy = false,
  onConfirm,
  onCancel,
}: NewAutomationModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const canSubmit = title.trim().length >= 2 && !busy;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fermer"
        disabled={busy}
        onClick={() => !busy && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-auto-title"
        className="relative z-10 w-full max-w-[420px] rounded-2xl border border-black/[0.08] bg-bg-0 p-5 shadow-2xl sm:p-6"
      >
        <h2 id="new-auto-title" className="text-lg font-semibold text-text-100">
          Nouvelle automatisation
        </h2>
        <p className="mt-1.5 text-sm text-text-400">
          Donnez un nom et un objectif court — l&apos;agent s&apos;en servira pour vous guider.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onConfirm(title.trim(), description.trim());
          }}
        >
          <div>
            <label htmlFor="auto-name" className="mb-1.5 block text-xs font-medium text-text-400">
              Nom
            </label>
            <input
              id="auto-name"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Florelle Bio — Prospection"
              maxLength={80}
              autoFocus
              disabled={busy}
              className="w-full rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2.5 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand-border focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="auto-desc" className="mb-1.5 block text-xs font-medium text-text-400">
              Description <span className="text-text-500">(optionnel)</span>
            </label>
            <textarea
              id="auto-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex. Prospecter les membres du groupe et proposer la cure minceur naturelle."
              rows={3}
              maxLength={280}
              disabled={busy}
              className="w-full resize-none rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2.5 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand-border focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
            />
            <p className="mt-1 text-right text-[11px] text-text-500">{description.length}/280</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-xl px-4 py-2 text-sm font-medium text-text-400 transition hover:bg-bg-200 hover:text-text-100 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'rounded-xl px-4 py-2 text-sm font-medium text-white transition',
                canSubmit ? 'bg-brand hover:bg-brand/90' : 'cursor-not-allowed bg-brand/40',
              )}
            >
              {busy ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
