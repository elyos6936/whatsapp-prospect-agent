import { useCallback, useState } from 'react';
import { Copy, Download, Maximize2, Minimize2, X } from 'lucide-react';
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

type PlanPanelProps = {
  plan: AutomationVisualPlan;
  onClose: () => void;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PlanPanel({ plan, onClose }: PlanPanelProps) {
  const [expanded, setExpanded] = useState(false);

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
    <div
      className={cn(
        'fixed inset-0 z-50 bg-black/40',
        expanded ? 'flex items-center justify-center p-3 sm:p-5' : 'flex justify-end',
      )}
      onClick={onClose}
    >
      <aside
        className={cn(
          'flex flex-col border border-black/[0.08] bg-bg-0 shadow-2xl',
          expanded
            ? 'h-full w-full max-w-6xl rounded-2xl'
            : 'h-full w-full max-w-2xl rounded-none border-y-0 border-r-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-100">{plan.title}</p>
            <p className="text-[11px] text-text-500">Plan d’automatisation</p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 hover:bg-bg-200 hover:text-text-100"
            title={expanded ? 'Réduire' : 'Agrandir'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{expanded ? 'Réduire' : 'Agrandir'}</span>
          </button>
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
            title="Télécharger en HTML (ouvrable dans le navigateur)"
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
          <PlanBoard
            key={expanded ? 'expanded' : 'docked'}
            plan={plan}
            className="min-h-0 flex-1"
          />
          <p className="shrink-0 text-xs text-text-500">
            Ce plan se met à jour quand tu modifies la campagne avec l’agent dans ce même fil.
            Télécharge en HTML pour l’ouvrir directement dans un navigateur.
          </p>
        </div>
      </aside>
    </div>
  );
}
