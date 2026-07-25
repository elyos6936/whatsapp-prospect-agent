import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShinyButton } from '@/components/ui/shiny-button';
import {
  accountsLabel,
  formatEuro,
  periodSuffix,
  planOldPrice,
  planPrice,
  PLANS,
  REFUND_DAYS,
  TRIAL_DAYS,
  type BillingPeriod,
  type PricingPlan,
} from '@/lib/pricing';

type BillingSectionProps = {
  onStartTrial: () => void;
  className?: string;
};

export function BillingSection({ onStartTrial, className }: BillingSectionProps) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const annual = period === 'annual';

  return (
    <section id="pricing" className={cn('landing-section bg-white', className)}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="landing-h2 text-text-100">Tarifs</h2>
          <p className="landing-lead mt-3 text-text-400">
            Un agent qui prospecte sur WhatsApp.
          </p>
          <p className="landing-lead mt-1 text-text-400">
            Un prix qui suit votre croissance.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label={annual ? 'Facturation annuelle' : 'Facturation mensuelle'}
            onClick={() => setPeriod(annual ? 'monthly' : 'annual')}
            className={cn(
              'relative h-8 w-[52px] shrink-0 rounded-full border transition-colors',
              annual ? 'border-brand bg-brand' : 'border-black/10 bg-[#f7f8fb]',
            )}
          >
            <span
              className={cn(
                'absolute top-1 left-1 size-5 rounded-full bg-white shadow-sm transition-transform',
                annual && 'translate-x-[22px]',
              )}
            />
          </button>
          <span className="text-sm text-text-400">
            Facturation{' '}
            <strong className="font-semibold text-text-100">
              {annual ? 'annuelle' : 'mensuelle'}
            </strong>
          </span>
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-700">
            Annuel = 2 mois offerts
          </span>
        </div>

        <div className="mt-9 grid gap-4 lg:grid-cols-3 lg:items-start">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              period={period}
              onStartTrial={onStartTrial}
            />
          ))}
        </div>

        <p className="mt-5 text-center text-[12px] text-text-500">
          Sans engagement · Annulez en un clic · Garantie remboursement {REFUND_DAYS} jours
        </p>

        <div className="mt-8 grid gap-5 border-t border-black/[0.06] pt-7 sm:grid-cols-3">
          {[
            {
              mark: `${TRIAL_DAYS}j`,
              title: 'Essai gratuit',
              text: 'Testez votre agent en conditions réelles avant tout engagement.',
            },
            {
              mark: `${REFUND_DAYS}j`,
              title: 'Remboursement garanti',
              text: 'Pas convaincu ? Remboursement intégral, sans justification.',
            },
            {
              mark: '0€',
              title: 'Résiliable à tout moment',
              text: 'Aucun engagement. Changez de palier ou annulez en un clic.',
            },
          ].map((item) => (
            <div key={item.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/[0.08] font-mono text-[11px] font-semibold text-brand">
                {item.mark}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-100">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-500">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  period,
  onStartTrial,
}: {
  plan: PricingPlan;
  period: BillingPeriod;
  onStartTrial: () => void;
}) {
  const price = planPrice(plan, period);
  const oldPrice = planOldPrice(plan, period);
  const featured = Boolean(plan.featured);

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border bg-[#f7f8fb] p-5 sm:p-6',
        featured
          ? 'border-brand bg-gradient-to-b from-brand/[0.06] to-[#f7f8fb] shadow-[0_0_0_1px_rgba(32,87,206,0.12)] lg:-mt-1 lg:pb-7 lg:pt-7'
          : 'border-black/[0.08]',
      )}
    >
      {featured && plan.featuredLabel ? (
        <span className="absolute -top-3 left-5 rounded-md bg-brand px-2.5 py-1 font-mono text-[11px] font-medium text-white">
          {plan.featuredLabel}
        </span>
      ) : null}

      <div>
        <p className="text-lg font-semibold tracking-tight text-text-100">{plan.name}</p>
        <p className="mt-0.5 font-mono text-[12px] text-text-500">{accountsLabel(plan.accounts)}</p>
      </div>

      <div className="mt-5 flex items-baseline gap-2">
        <span className="font-mono text-base text-text-500 line-through">{formatEuro(oldPrice)}</span>
        <span className="font-mono text-3xl font-medium tracking-tight text-text-100">
          {formatEuro(price)}
        </span>
        <span className="text-sm text-text-500">{periodSuffix(period)}</span>
      </div>
      <p className="mt-1 text-[12px] text-text-500">
        {period === 'monthly'
          ? plan.perAccountMonthly
          : `${formatEuro(Math.round(price / plan.accounts))} par compte / an`}
        {plan.saveLabel && period === 'monthly' ? (
          <span className="text-emerald-600"> · {plan.saveLabel}</span>
        ) : null}
      </p>

      <div className="my-4 h-px bg-black/[0.06]" />

      <ul className="flex-1 space-y-2">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px] text-text-300">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} />
            <span className="min-w-0">{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        {featured ? (
          <ShinyButton onClick={onStartTrial} className="w-full">
            Démarrer l’essai gratuit
            <ArrowRight className="h-4 w-4 shrink-0" />
          </ShinyButton>
        ) : (
          <button
            type="button"
            onClick={onStartTrial}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-text-100 transition hover:border-brand-border hover:bg-brand/[0.04]"
          >
            Démarrer l’essai gratuit
          </button>
        )}
      </div>
    </div>
  );
}
