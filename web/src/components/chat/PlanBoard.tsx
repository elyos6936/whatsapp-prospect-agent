import { lazy, Suspense, useMemo } from 'react';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { cn } from '@/lib/utils';

const ExcalidrawCanvas = lazy(() =>
  import('@/components/chat/ExcalidrawPlanCanvas').then((m) => ({
    default: m.ExcalidrawPlanCanvas,
  })),
);

type PlanBoardProps = {
  plan: AutomationVisualPlan;
  className?: string;
  /** viewMode = lecture seule (défaut true) */
  editable?: boolean;
};

/** Board plan : vrai Excalidraw (lazy) avec fallback léger le temps du chargement. */
export function PlanBoard({ plan, className, editable = false }: PlanBoardProps) {
  const key = useMemo(
    () => `${plan.automationId ?? 'p'}-${plan.updatedAt}-${plan.nodes.length}`,
    [plan],
  );

  return (
    <div
      className={cn(
        'relative h-full min-h-[320px] w-full overflow-hidden rounded-xl',
        className,
      )}
    >
      <Suspense
        fallback={
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-black/10 bg-white text-sm text-slate-500">
            Chargement du tableau Excalidraw…
          </div>
        }
      >
        <ExcalidrawCanvas key={key} plan={plan} editable={editable} />
      </Suspense>
    </div>
  );
}
