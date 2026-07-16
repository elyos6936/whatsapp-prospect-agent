import { useEffect, useMemo, useState } from 'react';
import '@excalidraw/excalidraw/index.css';
import {
  Excalidraw,
  convertToExcalidrawElements,
} from '@excalidraw/excalidraw';
import type { AutomationVisualPlan } from '@/lib/automation-plan';
import { EXCALI_FONT, planToExcalidrawSkeleton } from '@/lib/excalidraw-plan';

type Props = {
  plan: AutomationVisualPlan;
  editable?: boolean;
};

export function ExcalidrawPlanCanvas({ plan, editable = false }: Props) {
  const [ready, setReady] = useState(false);

  const elements = useMemo(() => {
    try {
      const skeleton = planToExcalidrawSkeleton(plan);
      return convertToExcalidrawElements(skeleton as Parameters<typeof convertToExcalidrawElements>[0], {
        regenerateIds: false,
      });
    } catch (err) {
      console.error('[ExcalidrawPlanCanvas] convert failed', err);
      return [];
    }
  }, [plan]);

  useEffect(() => {
    // Polices Excalifont / Virgil depuis le dist CDN (évite de copier ~fonts dans public/)
    (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
      (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH ??
      'https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/';
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center bg-white text-sm text-slate-500">
        Préparation du canvas…
      </div>
    );
  }

  return (
    <div className="h-full min-h-[320px] w-full overflow-hidden rounded-xl border border-black/10 bg-white">
      <Excalidraw
        initialData={{
          elements,
          appState: {
            viewBackgroundColor: '#ffffff',
            currentItemFontFamily: EXCALI_FONT.Nunito,
            zenModeEnabled: true,
            gridModeEnabled: false,
          },
          scrollToContent: true,
        }}
        viewModeEnabled={!editable}
        zenModeEnabled
        theme="light"
        name={plan.title}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            export: editable ? undefined : false,
          },
        }}
      />
    </div>
  );
}
