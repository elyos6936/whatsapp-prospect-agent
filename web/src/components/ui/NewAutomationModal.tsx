import { useEffect, useState } from 'react';
import { Headphones, Megaphone, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ThreadPurpose = 'prospection' | 'support' | 'groupes';

type NewAutomationModalProps = {
  open: boolean;
  busy?: boolean;
  onConfirm: (title: string, description: string, purpose: ThreadPurpose) => void;
  onCancel: () => void;
};

/** Popup centrée : type + nom + description avant création. */
export function NewAutomationModal({
  open,
  busy = false,
  onConfirm,
  onCancel,
}: NewAutomationModalProps) {
  const [purpose, setPurpose] = useState<ThreadPurpose | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setPurpose(null);
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

  const canSubmit = purpose != null && title.trim().length >= 2 && !busy;

  const namePlaceholder =
    purpose === 'support'
      ? 'Ex. Florelle Bio — Support intéressés'
      : purpose === 'groupes'
        ? 'Ex. Florelle Bio — Annonces communauté'
        : 'Ex. Florelle Bio — Prospection groupe';

  const descPlaceholder =
    purpose === 'support'
      ? 'Ex. Répondre quand quelqu’un écrit « je suis intéressé » et closer la vente.'
      : purpose === 'groupes'
        ? 'Ex. Publier une annonce puis un rappel J+1 / J+3 dans mes groupes admin.'
        : 'Ex. Prospecter les membres du groupe et proposer la cure minceur naturelle.';

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
        className="relative z-10 w-full max-w-[520px] rounded-2xl border border-black/[0.08] bg-bg-0 p-5 shadow-2xl sm:p-6"
      >
        <h2 id="new-auto-title" className="text-lg font-semibold text-text-100">
          Nouvelle automatisation
        </h2>
        <p className="mt-1.5 text-sm text-text-400">
          Choisissez d&apos;abord le type — l&apos;agent ne mélangera pas prospection, support et
          groupes.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || !purpose) return;
            onConfirm(title.trim(), description.trim(), purpose);
          }}
        >
          <div>
            <p className="mb-1.5 block text-xs font-medium text-text-400">Type</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPurpose('prospection')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition',
                  purpose === 'prospection'
                    ? 'border-brand bg-brand/[0.06] ring-1 ring-brand/20'
                    : 'border-black/10 bg-bg-100 hover:border-black/15',
                  busy && 'opacity-60',
                )}
              >
                <Megaphone
                  className={cn(
                    'h-4 w-4',
                    purpose === 'prospection' ? 'text-brand' : 'text-text-400',
                  )}
                />
                <span className="text-sm font-semibold text-text-100">Prospection</span>
                <span className="text-[11px] leading-snug text-text-500">
                  Contacter des prospects en privé (liste ou membres d&apos;un groupe).
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPurpose('support')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition',
                  purpose === 'support'
                    ? 'border-brand bg-brand/[0.06] ring-1 ring-brand/20'
                    : 'border-black/10 bg-bg-100 hover:border-black/15',
                  busy && 'opacity-60',
                )}
              >
                <Headphones
                  className={cn(
                    'h-4 w-4',
                    purpose === 'support' ? 'text-brand' : 'text-text-400',
                  )}
                />
                <span className="text-sm font-semibold text-text-100">Support client</span>
                <span className="text-[11px] leading-snug text-text-500">
                  Réponses entrantes : phrases déclencheurs ou tout le compte WhatsApp.
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPurpose('groupes')}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition',
                  purpose === 'groupes'
                    ? 'border-brand bg-brand/[0.06] ring-1 ring-brand/20'
                    : 'border-black/10 bg-bg-100 hover:border-black/15',
                  busy && 'opacity-60',
                )}
              >
                <UsersRound
                  className={cn(
                    'h-4 w-4',
                    purpose === 'groupes' ? 'text-brand' : 'text-text-400',
                  )}
                />
                <span className="text-sm font-semibold text-text-100">Groupes WhatsApp</span>
                <span className="text-[11px] leading-snug text-text-500">
                  Publier et programmer des messages dans les groupes (admin).
                </span>
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="auto-name" className="mb-1.5 block text-xs font-medium text-text-400">
              Nom
            </label>
            <input
              id="auto-name"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={namePlaceholder}
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
              placeholder={descPlaceholder}
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
