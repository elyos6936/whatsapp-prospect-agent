import { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  LEVEL_DAILY_CAPS,
  LEVEL_MIN_SENT,
  OUTREACH_LEVELS,
  clampOutreachLevel,
  messagesUntilNextLevel,
  type OutreachLevel,
} from '@/lib/outreach-level';
import { cn } from '@/lib/utils';

type OutreachLevelModalProps = {
  open: boolean;
  level?: number | null;
  totalMessagesSent?: number | null;
  onClose: () => void;
};

export function OutreachLevelModal({
  open,
  level,
  totalMessagesSent = 0,
  onClose,
}: OutreachLevelModalProps) {
  const current = clampOutreachLevel(level);
  const sent = Math.max(0, Math.floor(Number(totalMessagesSent) || 0));
  const untilNext = messagesUntilNextLevel(sent);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outreach-level-title"
        className="relative z-10 w-full max-w-[420px] rounded-2xl border border-black/[0.08] bg-bg-0 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="outreach-level-title" className="text-base font-semibold text-text-100">
              Niveau {current} / 5
            </h2>
            <p className="mt-1 text-xs text-text-500">
              {untilNext == null
                ? 'Niveau max atteint'
                : `${untilNext} envois pour le suivant`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-500 transition hover:bg-bg-200 hover:text-text-200"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-4 space-y-1.5">
          {OUTREACH_LEVELS.map((lv) => {
            const caps = LEVEL_DAILY_CAPS[lv];
            const active = lv === current;
            return (
              <li
                key={lv}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs',
                  active
                    ? 'border-brand/30 bg-brand/[0.06]'
                    : 'border-black/[0.06] bg-bg-100/50',
                )}
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      'font-semibold',
                      active ? 'text-brand' : 'text-text-200',
                    )}
                  >
                    Niv. {lv}
                    {active ? ' · actuel' : ''}
                  </p>
                  <p className="mt-0.5 text-text-500">
                    {lv === 1
                      ? 'Départ'
                      : `Dès ${LEVEL_MIN_SENT[lv].toLocaleString('fr-FR')} envois`}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono text-[11px] text-text-400">
                  <p>{caps.outbound} sort. / j</p>
                  <p>{caps.inbound} entr. / j</p>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[11px] leading-relaxed text-text-500">
          Le niveau monte avec tes messages WhatsApp envoyés (lifetime).
        </p>
      </div>
    </div>
  );
}

export type { OutreachLevel };
