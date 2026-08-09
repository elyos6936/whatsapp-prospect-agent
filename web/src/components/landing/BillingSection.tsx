import { cn } from '@/lib/utils';
import { Pricing } from '@/components/ui/pricing';

type BillingSectionProps = {
  onStartTrial: () => void;
  className?: string;
};

export function BillingSection({ onStartTrial, className }: BillingSectionProps) {
  return (
    <section id="pricing" className={cn('landing-section bg-[#f7f8fb]', className)}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Pricing
          onStartTrial={onStartTrial}
          title="Un seul plan. Tout inclus."
          description="L'agent IA qui prospecte pour toi sur WhatsApp — 20€/mois, aucune surprise."
        />
      </div>
    </section>
  );
}
