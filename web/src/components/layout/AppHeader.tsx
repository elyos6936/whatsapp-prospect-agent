import { ArrowLeft, BarChart3, Eye, Settings } from 'lucide-react';
import { MobileNavButton } from '@/components/layout/AppSidebar';
import { getOverlayTitle, type OverlayView } from '@/lib/navigation';

type AppHeaderProps = {
  overlayView: OverlayView;
  threadTitle: string;
  hasCampaign: boolean;
  hasStrategy: boolean;
  strategyOpen: boolean;
  onGoToChat: () => void;
  onOpenSettings: () => void;
  onOpenStats?: () => void;
  onToggleStrategy?: () => void;
  onOpenMobileNav?: () => void;
};

export function AppHeader({
  overlayView,
  threadTitle,
  hasCampaign,
  hasStrategy,
  strategyOpen,
  onGoToChat,
  onOpenSettings,
  onOpenStats,
  onToggleStrategy,
  onOpenMobileNav,
}: AppHeaderProps) {
  const onChat = overlayView == null;
  const title = onChat ? threadTitle || 'Automatisation' : getOverlayTitle(overlayView);

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
        {onChat && hasStrategy && onToggleStrategy && (
          <button
            type="button"
            onClick={onToggleStrategy}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 transition hover:bg-bg-200 hover:text-text-100"
            title={strategyOpen ? 'Masquer la simulation' : 'Afficher la simulation'}
            aria-pressed={strategyOpen}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{strategyOpen ? 'Masquer' : 'Simulation'}</span>
          </button>
        )}

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

        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 transition hover:bg-bg-200 hover:text-text-100"
          title="Réglages"
          aria-current={overlayView === 'settings' ? 'page' : undefined}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Paramètres</span>
        </button>
      </div>
    </header>
  );
}
