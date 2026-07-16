import { useEffect } from 'react';
import { cn } from '@/lib/utils';

type ConfirmDialogProps = {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Modale centrée Oui / Non (remplace window.confirm). */
export function ConfirmDialog({
  open,
  title = 'Confirmation',
  message,
  confirmLabel = 'Oui',
  cancelLabel = 'Non',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fermer"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="klanvio-confirm-title"
        aria-describedby="klanvio-confirm-desc"
        className="relative z-10 w-full max-w-[360px] rounded-2xl border border-black/[0.08] bg-bg-0 p-5 shadow-2xl"
      >
        <h2 id="klanvio-confirm-title" className="text-base font-semibold text-text-100">
          {title}
        </h2>
        <p id="klanvio-confirm-desc" className="mt-2 text-sm leading-relaxed text-text-400">
          {message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium text-text-400 transition hover:bg-bg-200 hover:text-text-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'rounded-xl px-4 py-2 text-sm font-medium text-white transition',
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand/90',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
