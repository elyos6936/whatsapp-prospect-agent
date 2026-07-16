import { useCallback } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { PlanBoard } from '@/components/chat/PlanBoard';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { planToDownloadJson } from '@/lib/automation-plan';
import {
  EXCALI_FONT,
  planDownloadBasename,
  planToExcalidrawSkeleton,
  planToStandaloneHtml,
} from '@/lib/excalidraw-plan';
import { cn } from '@/lib/utils';

type StrategyDockProps = {
  plan: AutomationVisualPlan;
  onClose: () => void;
  className?: string;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Panneau droit permanent : résumé / schéma de la stratégie de campagne. */
export function StrategyDock({ plan, onClose, className }: StrategyDockProps) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(planToDownloadJson(plan));
    } catch {
      alert('Impossible de copier le plan.');
    }
  }, [plan]);

  const handleDownload = useCallback(async () => {
    const base = planDownloadBasename(plan);
    try {
      const { convertToExcalidrawElements, exportToSvg } = await import('@excalidraw/excalidraw');
      const skeleton = planToExcalidrawSkeleton(plan);
      const elements = convertToExcalidrawElements(
        skeleton as Parameters<typeof convertToExcalidrawElements>[0],
        { regenerateIds: false },
      );
      const svg = await exportToSvg({
        elements,
        appState: {
          exportBackground: true,
          viewBackgroundColor: '#ffffff',
          exportWithDarkMode: false,
          currentItemFontFamily: EXCALI_FONT.Nunito,
        },
        files: null,
      });
      const html = planToStandaloneHtml(plan, svg.outerHTML);
      triggerDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`);
    } catch {
      triggerDownload(
        new Blob([planToDownloadJson(plan)], { type: 'application/json' }),
        `${base}.json`,
      );
    }
  }, [plan]);

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full flex-col border-l border-black/[0.06] bg-bg-0',
        className,
      )}
      aria-label="Stratégie de campagne"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-100">{plan.title}</p>
          <p className="text-[11px] text-text-500">Stratégie · résumé permanent</p>
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-lg p-2 text-text-400 hover:bg-bg-200 hover:text-text-100"
          title="Copier"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="rounded-lg p-2 text-text-400 hover:bg-bg-200 hover:text-text-100"
          title="Télécharger"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-text-400 hover:bg-bg-200 hover:text-text-100"
          aria-label="Masquer la stratégie"
          title="Masquer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <PlanBoard key={plan.updatedAt || plan.title} plan={plan} className="min-h-0 flex-1" />
        <p className="shrink-0 text-[11px] leading-relaxed text-text-500">
          Ce panneau reste visible pendant le chat. La simulation et la validation se font au centre ;
          ici tu gardes le résumé de ta stratégie.
        </p>
      </div>
    </aside>
  );
}

/** @deprecated utiliser StrategyDock */
export { StrategyDock as PlanPanel };
