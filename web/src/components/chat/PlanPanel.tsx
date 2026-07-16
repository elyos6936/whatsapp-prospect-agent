import { X } from 'lucide-react';
import { SimulationChatPanel } from '@/components/chat/SimulationChatPanel';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { cn } from '@/lib/utils';

type StrategyDockProps = {
  plan: AutomationVisualPlan;
  onClose: () => void;
  className?: string;
};

/** Panneau droit : simulation de conversation (pas d’envoi WhatsApp). */
export function StrategyDock({ plan, onClose, className }: StrategyDockProps) {
  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full flex-col border-l border-black/[0.06] bg-bg-0',
        className,
      )}
      aria-label="Simulation de conversation"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-text-100 break-words">
            {plan.title.replace(/\s*#\d+\s*$/, '').replace(/^Campagne\s+\d+$/i, 'Automatisation')}
          </p>
          <p className="text-[11px] text-text-500">Simulation · testez les réponses IA</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-text-400 hover:bg-bg-200 hover:text-text-100"
          aria-label="Masquer la simulation"
          title="Masquer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <SimulationChatPanel
          key={`${plan.automationId ?? 'p'}-${plan.updatedAt}-${plan.nodes?.length ?? 0}`}
          plan={plan}
        />
      </div>
    </aside>
  );
}

/** @deprecated utiliser StrategyDock */
export { StrategyDock as PlanPanel };
