import { ArrowRight, Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShinyButton } from '@/components/ui/shiny-button';

const PLAN_FEATURES = [
  'Extraction illimitée de groupes',
  'Prospection multi-groupes',
  'Closing e-commerce automatique',
  'Relances intelligentes',
  'Statuts programmés',
  'Gestion complète de groupes',
  'Protection anti-blocage',
  'Support prioritaire',
] as const;

type BillingSectionProps = {
  onStartTrial: () => void;
  className?: string;
};

export function BillingSection({ onStartTrial, className }: BillingSectionProps) {
  return (
    <section id="pricing" className={cn('landing-section bg-white', className)}>
      <div className="mx-auto max-w-lg px-4 sm:px-6">
        <div className="text-center">
          <h2 className="landing-h2 text-text-100">Tarifs</h2>
          <p className="landing-lead mt-2.5 text-text-400">
            Un seul plan, tout inclus. Essayez 7 jours gratuitement, puis 15€/mois.
          </p>
        </div>

        <div className="mt-7 overflow-hidden rounded-2xl border border-black/[0.08] bg-[#f7f8fb]">
          <div className="border-b border-black/[0.06] bg-white px-5 py-5 text-center sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
              Plan Pro
            </p>
            <div className="mt-2 flex items-end justify-center gap-1">
              <span className="text-4xl font-semibold tracking-tight text-text-100">15€</span>
              <span className="mb-1 text-sm text-text-400">/mois</span>
            </div>
            <p className="mt-1.5 text-sm text-text-500">
              Illimité · <span className="font-medium text-brand">7 jours d’essai gratuit</span>
            </p>
          </div>

          <div className="px-5 py-5 sm:px-8">
            <ul className="space-y-2">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-text-300">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} />
                  <span className="min-w-0">{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6">
              <ShinyButton onClick={onStartTrial} className="w-full">
                Commencer l’essai gratuit
                <ArrowRight className="h-4 w-4 shrink-0" />
              </ShinyButton>
            </div>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] leading-snug text-text-500">
              <Lock className="h-3 w-3 shrink-0" strokeWidth={2} />
              <span>Sans engagement · résiliable en un clic</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
