import { useCallback } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { PlanBoard } from '@/components/chat/PlanBoard';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { planToDownloadJson } from '@/lib/automation-plan';
import { planToExcalidrawFile, planToExcalidrawSkeleton } from '@/lib/excalidraw-plan';

type PlanPanelProps = {
  plan: AutomationVisualPlan;
  onClose: () => void;
};

export function PlanPanel({ plan, onClose }: PlanPanelProps) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(planToDownloadJson(plan));
    } catch {
      alert('Impossible de copier le plan.');
    }
  }, [plan]);

  const handleDownload = useCallback(async () => {
    try {
      const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw');
      const skeleton = planToExcalidrawSkeleton(plan);
      const elements = convertToExcalidrawElements(
        skeleton as Parameters<typeof convertToExcalidrawElements>[0],
        { regenerateIds: false },
      );
      const body = planToExcalidrawFile(plan, elements);
      const blob = new Blob([body], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(plan.title || 'plan-automatisation').replace(/[^\w\-]+/g, '_')}.excalidraw`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      const blob = new Blob([planToDownloadJson(plan)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(plan.title || 'plan-automatisation').replace(/[^\w\-]+/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [plan]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-2xl flex-col border-l border-black/[0.08] bg-bg-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-100">{plan.title}</p>
            <p className="text-[11px] text-text-500">Plan d’automatisation</p>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 hover:bg-bg-200 hover:text-text-100"
            title="Copier le JSON"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copier</span>
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 hover:bg-bg-200 hover:text-text-100"
            title="Télécharger .excalidraw"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Télécharger</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-400 hover:bg-bg-200"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <PlanBoard plan={plan} className="min-h-0 flex-1" />
          <p className="shrink-0 text-xs text-text-500">
            Ce plan se met à jour quand tu modifies la campagne avec l’agent dans ce même fil.
          </p>
        </div>
      </aside>
    </div>
  );
}
