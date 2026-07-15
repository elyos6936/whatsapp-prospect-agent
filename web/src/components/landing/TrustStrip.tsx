import { Clock3, Lock, ShieldCheck } from 'lucide-react';

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'Anti-blocage intégré',
    text: 'Rythme adaptatif et garde-fous pour protéger votre numéro.',
  },
  {
    icon: Clock3,
    title: '7 jours d’essai',
    text: 'Testez toutes les fonctions avant de décider.',
  },
  {
    icon: Lock,
    title: 'Sans engagement',
    text: 'Résiliable en un clic. Vos données restent les vôtres.',
  },
] as const;

/** Sobriety trust strip — no invented stats or testimonials. */
export function TrustStrip() {
  return (
    <section className="border-y border-black/[0.05] bg-white/70">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 sm:gap-8 sm:px-6 sm:py-9">
        {POINTS.map(({ icon: Icon, title, text }) => (
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
