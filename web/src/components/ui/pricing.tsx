import { useRef, useState } from 'react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import { Check, Star } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ShinyButton } from '@/components/ui/shiny-button';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  PLAN,
  TRIAL_DAYS,
  type BillingPeriod,
} from '@/lib/pricing';
import { cn } from '@/lib/utils';

type PricingProps = {
  onStartTrial: () => void;
  className?: string;
  title?: string;
  description?: string;
};

/**
 * Pricing UI (adapted) — un seul plan Klanvio, toggle mensuel/annuel + confetti.
 */
export function Pricing({
  onStartTrial,
  className,
  title = 'Un seul plan. Tout inclus.',
  description = 'Zéro complexité. Toutes les fonctionnalités. Aucune limite cachée.',
}: PricingProps) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const switchRef = useRef<HTMLButtonElement>(null);
  const isAnnual = period === 'annual';

  const handleToggle = (checked: boolean) => {
    setPeriod(checked ? 'annual' : 'monthly');
    if (checked && isDesktop && switchRef.current) {
      const rect = switchRef.current.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      void confetti({
        particleCount: 48,
        spread: 58,
        origin: { x: x / window.innerWidth, y: y / window.innerHeight },
        colors: ['#2057CE', '#25D366', '#0ea5e9', '#1845A8'],
        ticks: 200,
        gravity: 1.15,
        decay: 0.94,
        startVelocity: 28,
        shapes: ['circle'],
      });
    }
  };

  const displayPrice = isAnnual ? PLAN.annualMonthly : PLAN.monthly;

  return (
    <div className={cn('w-full', className)}>
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <h2 className="landing-h2 text-text-100">{title}</h2>
        <p className="landing-lead whitespace-pre-line text-text-400">{description}</p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
        <Switch
          ref={switchRef}
          checked={isAnnual}
          onCheckedChange={handleToggle}
          aria-label="Facturation annuelle"
        />
        <span className="text-sm font-semibold text-text-200">
          Facturation annuelle{' '}
          <span className="text-brand">(2 mois offerts)</span>
        </span>
      </div>

      <div className="mt-10 flex justify-center">
        <motion.div
          initial={{ y: 28, opacity: 0.96 }}
          whileInView={
            isDesktop
              ? { y: -8, opacity: 1, scale: 1 }
              : { y: 0, opacity: 1 }
          }
          viewport={{ once: true }}
          transition={{
            duration: 1.1,
            type: 'spring',
            stiffness: 110,
            damping: 28,
          }}
          className="relative flex w-full max-w-md flex-col rounded-2xl border-2 border-brand bg-white p-6 text-center shadow-[0_20px_50px_-28px_rgba(32,87,206,0.45)] sm:p-7"
        >
          <div className="absolute top-0 right-0 flex items-center rounded-bl-xl rounded-tr-[14px] bg-brand px-2.5 py-1">
            <Star className="h-3.5 w-3.5 fill-current text-white" />
            <span className="ml-1 text-[11px] font-semibold text-white">Tout inclus</span>
          </div>

          <p className="text-base font-semibold tracking-tight text-text-400">{PLAN.name}</p>
          <p className="mt-1 text-sm text-text-500">{PLAN.valueAnchor}</p>

          <div className="mt-5 flex items-end justify-center gap-1.5">
            <span className="text-5xl font-bold tracking-tight text-text-100 tabular-nums">
              <NumberFlow
                value={displayPrice}
                format={{
                  style: 'currency',
                  currency: 'EUR',
                  currencyDisplay: 'narrowSymbol',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }}
                transformTiming={{ duration: 450, easing: 'ease-out' }}
                willChange
              />
            </span>
            <span className="mb-1.5 text-sm font-semibold text-text-500">/ mois</span>
          </div>
          <p className="mt-1 text-xs text-text-500">
            {isAnnual
              ? `Soit ${PLAN.annual}€ facturés / an`
              : 'Facturé chaque mois · sans engagement'}
          </p>

          <ul className="mt-6 flex flex-col gap-2.5 text-left">
            {PLAN.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2.5} />
                <span className="text-sm leading-snug text-text-300">{feature}</span>
              </li>
            ))}
          </ul>

          <hr className="my-5 border-black/[0.06]" />

          <ShinyButton onClick={onStartTrial} className="w-full">
            Commencer mon essai gratuit de {TRIAL_DAYS} jours
          </ShinyButton>
        </motion.div>
      </div>
    </div>
  );
}

export default Pricing;
