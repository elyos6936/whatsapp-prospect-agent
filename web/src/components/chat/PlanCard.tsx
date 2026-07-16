import { LayoutTemplate } from 'lucide-react';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { cn } from '@/lib/utils';

type PlanCardProps = {
  plan: AutomationVisualPlan;
  onOpen: () => void;
};

/** Petit rappel dans le chat — la stratégie s’affiche à droite. */
export function PlanCard({ plan, onOpen }: PlanCardProps) {
  const steps = plan.nodes?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group my-2 flex w-full max-w-sm items-center gap-2 rounded-xl border border-brand/25 bg-brand-muted/60 px-3 py-2 text-left',
        'transition hover:border-brand/50 hover:bg-brand-muted',
      )}
    >
      <LayoutTemplate className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-text-100">
          Stratégie mise à jour{steps ? ` · ${steps} étapes` : ''}
        </p>
        <p className="truncate text-[11px] text-text-500">Voir le panneau à droite</p>
      </div>
    </button>
  );
}
