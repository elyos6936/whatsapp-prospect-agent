import { ArrowLeft, BarChart3, Brain, Settings } from 'lucide-react';
import { CampaignStatusToggle } from '@/components/automation/CampaignStatusToggle';
import { MobileNavButton } from '@/components/layout/AppSidebar';
import { getOverlayTitle, type OverlayView } from '@/lib/navigation';
import { cn } from '@/lib/utils';

type AppHeaderProps = {
  overlayView: OverlayView;
  threadTitle: string;
  hasCampaign: boolean;
  campaignStatus?: string | null;
  automationId?: number | null;
  outreachLevel?: number | null;
  memoryLinked?: boolean;
  memoryName?: string | null;
  onGoToChat: () => void;
  onOpenSettings: () => void;
  onOpenStats?: () => void;
  onOpenMemory?: () => void;
  onOpenMobileNav?: () => void;
  onCampaignStatusChange?: () => void | Promise<void>;
};

export function AppHeader({
  overlayView,
  threadTitle,
  hasCampaign,
  campaignStatus,
  automationId,
  outreachLevel,
  memoryLinked = false,
  memoryName,
  onGoToChat,
  onOpenSettings,
  onOpenStats,
  onOpenMemory,
  onOpenMobileNav,
  onCampaignStatusChange,
}: AppHeaderProps) {
  const onChat = overlayView == null;
  const title = onChat ? threadTitle || 'Automatisation' : getOverlayTitle(overlayView);
  const level =
    outreachLevel != null && Number.isFinite(outreachLevel)
      ? Math.min(5, Math.max(1, Math.floor(outreachLevel)))
      : null;

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
        {level != null && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="hidden items-center gap-1 rounded-lg border border-black/[0.08] bg-bg-100 px-2 py-1 font-mono text-[11px] text-text-400 transition hover:border-brand/30 hover:text-text-200 sm:inline-flex"
            title={`Niveau outreach ${level} / 5 — ouvrir Facturation`}
          >
            <span className="text-text-500">Niv.</span>
            <span className="font-semibold text-text-200">{level}</span>
            <span className="text-text-500">/5</span>
          </button>
        )}

        {hasCampaign && automationId != null && campaignStatus && (
          <CampaignStatusToggle
            automationId={automationId}
            status={campaignStatus}
            size="md"
            className="!px-2.5 !py-1.5 !text-xs sm:!px-3"
            onUpdated={onCampaignStatusChange}
          />
        )}

        {onChat && onOpenMemory && (
          <button
            type="button"
            onClick={onOpenMemory}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
              memoryLinked
                ? 'border-brand/30 bg-brand/10 text-brand hover:bg-brand/15'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15',
            )}
            title={
              memoryLinked
                ? `Mémoire : ${memoryName || 'connectée'}`
                : 'Connecter une mémoire à cette automatisation'
            }
          >
            <Brain className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[7rem] truncate sm:max-w-[10rem]">
              {memoryLinked ? memoryName || 'Mémoire' : 'Mémoire'}
            </span>
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
          {level != null && (
            <span className="rounded bg-bg-200 px-1 py-0.5 font-mono text-[10px] text-text-400 sm:hidden">
              N{level}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
