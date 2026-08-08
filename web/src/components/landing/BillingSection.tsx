import { cn } from '@/lib/utils';
import { Pricing } from '@/components/ui/pricing';
import { REFUND_DAYS, TRIAL_DAYS } from '@/lib/pricing';

type BillingSectionProps = {
  onStartTrial: () => void;
  className?: string;
};

const GUARANTEES = [
  {
    mark: `${TRIAL_DAYS}j`,
    title: 'Essai gratuit',
    text: 'Sans carte bancaire. Testez avant de payer.',
  },
  {
    mark: `${REFUND_DAYS}j`,
    title: 'Remboursement',
    text: 'Pas convaincu ? Remboursement intégral.',
  },
  {
    mark: '0€',
    title: 'Sans engagement',
    text: 'Annulez en un clic, quand vous voulez.',
  },
] as const;

export function BillingSection({ onStartTrial, className }: BillingSectionProps) {
  return (
    <section id="pricing" className={cn('landing-section bg-white', className)}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Pricing
          onStartTrial={onStartTrial}
          title="Un seul plan. Tout inclus."
          description="L'agent IA qui prospecte pour toi sur WhatsApp — 20€/mois, aucune surprise."
        />

        <div className="mx-auto mt-12 max-w-3xl border-t border-black/[0.06] pt-8">
          <ul className="grid gap-6 sm:grid-cols-3 sm:gap-5">
            {GUARANTEES.map((item) => (
              <li key={item.title} className="flex gap-3 sm:flex-col sm:items-center sm:text-center">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/[0.08] font-mono text-[11px] font-semibold text-brand">
                  {item.mark}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-100">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-400">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
