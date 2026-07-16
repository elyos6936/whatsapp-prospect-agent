import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, Settings, Zap } from 'lucide-react';
import { MobileNavButton } from '@/components/layout/AppSidebar';
import { getOverlayTitle, type OverlayView } from '@/lib/navigation';

type AppHeaderProps = {
  overlayView: OverlayView;
  threadTitle: string;
  hasCampaign: boolean;
  onGoToChat: () => void;
  onOpenSettings: () => void;
  onOpenAutomation: () => void;
  onOpenStats?: () => void;
  onOpenMobileNav?: () => void;
};

export function AppHeader({
  overlayView,
  threadTitle,
  hasCampaign,
  onGoToChat,
  onOpenSettings,
  onOpenAutomation,
  onOpenStats,
  onOpenMobileNav,
}: AppHeaderProps) {
  const onChat = overlayView == null;
  const title = onChat ? threadTitle || 'Automatisation' : getOverlayTitle(overlayView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.06] bg-bg-0/95 px-3 backdrop-blur-md sm:h-14 sm:gap-4 sm:px-5">
      {onOpenMobileNav && <MobileNavButton onClick={onOpenMobileNav} />}

      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {!onChat && (
          <button
            type="button"
            onClick={onGoToChat}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-400 transition hover:bg-bg-200 hover:text-text-100"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Chat</span>
          </button>
        )}

        <div className={onChat ? 'min-w-0' : 'min-w-0 border-l border-black/[0.08] pl-2 sm:pl-3'}>
          <p className="truncate text-sm font-medium text-text-200">{title}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {onChat && hasCampaign && onOpenStats && (
          <button
            type="button"
            onClick={onOpenStats}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 transition hover:bg-bg-200 hover:text-text-100"
            title="Statistiques de la campagne"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Statistiques</span>
            <span className="sm:hidden">Stats</span>
          </button>
        )}

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 transition hover:bg-bg-200 hover:text-text-100"
            title="Paramètres"
            aria-expanded={settingsOpen}
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Paramètres</span>
          </button>

          {settingsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-black/[0.08] bg-bg-0 py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-300 transition hover:bg-bg-200 hover:text-text-100"
              >
                <Settings className="h-4 w-4 text-text-500" />
                Réglages
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  onOpenAutomation();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-300 transition hover:bg-bg-200 hover:text-text-100"
              >
                <Zap className="h-4 w-4 text-text-500" />
                Automatisation
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
