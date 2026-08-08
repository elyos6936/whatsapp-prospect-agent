import { Clock3, Lock, ShieldCheck, type LucideIcon } from 'lucide-react';
import { TRIAL_DAYS } from '@/lib/pricing';
import { cn } from '@/lib/utils';

export const TRUST_POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Anti-blocage intégré',
    text: 'Rythme adaptatif et garde-fous pour protéger votre numéro.',
  },
  {
    icon: Clock3,
    title: `${TRIAL_DAYS} jours d’essai`,
    text: 'Testez toutes les fonctions avant de décider.',
  },
  {
    icon: Lock,
    title: 'Sans engagement',
    text: 'Résiliable en un clic. Vos données restent les vôtres.',
  },
];

type TrustStripProps = {
  className?: string;
};

/** Trust strip with titles + short subtitles. */
export function TrustStrip({ className }: TrustStripProps) {
  return (
    <section className={cn('border-y border-black/[0.05] bg-white/70', className)}>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:gap-8 sm:px-6 sm:py-9">
        {TRUST_POINTS.map(({ icon: Icon, title, text }) => (
          <div
            key={title}
            className="flex items-start gap-3 sm:flex-col sm:items-center sm:text-center"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/[0.08] text-brand">
              <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-100">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-400 sm:mt-1">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
