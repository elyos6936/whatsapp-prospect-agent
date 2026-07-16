import { LayoutTemplate } from 'lucide-react';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { cn } from '@/lib/utils';

type PlanCardProps = {
  plan: AutomationVisualPlan;
  onOpen: () => void;
};

export function PlanCard({ plan, onOpen }: PlanCardProps) {
  const steps = plan.nodes?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group my-2 flex w-full max-w-md items-stretch overflow-hidden rounded-xl border border-brand/30 bg-bg-100 text-left',
        'shadow-sm transition hover:border-brand/55 hover:bg-bg-200/80',
      )}
    >
      <div className="min-w-0 flex-1 px-3.5 py-3">
        <p className="truncate text-sm font-medium text-text-100">{plan.title || 'Plan d’automatisation'}</p>
        <p className="mt-0.5 text-xs text-text-500">
          Plan interactif{steps ? ` · ${steps} étape${steps > 1 ? 's' : ''}` : ''}
        </p>
      </div>
      <div className="flex w-14 shrink-0 items-center justify-center border-l border-brand/20 bg-brand-muted text-brand transition group-hover:bg-brand/20">
        <LayoutTemplate className="h-5 w-5" strokeWidth={1.75} />
      </div>
    </button>
  );
}
