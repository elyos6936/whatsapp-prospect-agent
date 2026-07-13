import { ArrowLeft, Trash2 } from 'lucide-react';
import { getViewTitle, type MainView } from '@/lib/navigation';

type AppHeaderProps = {
  mainView: MainView;
  onGoToChat: () => void;
  onClearHistory?: () => void;
  clearing?: boolean;
};

export function AppHeader({
  mainView,
  onGoToChat,
  onClearHistory,
  clearing,
}: AppHeaderProps) {
  const onChat = mainView === 'chat';
  const title = onChat ? 'Agent WhatsApp' : getViewTitle(mainView);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-4 border-b border-black/[0.06] bg-bg-0/95 px-4 backdrop-blur-md sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
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

        <div className={onChat ? 'min-w-0' : 'min-w-0 border-l border-black/[0.08] pl-3'}>
          <p className="truncate text-sm font-medium text-text-200">{title}</p>
        </div>
      </div>

      {onChat && onClearHistory && (
        <button
          type="button"
          onClick={onClearHistory}
          disabled={clearing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-400 transition hover:bg-bg-200 hover:text-text-100 disabled:opacity-50"
          title="Effacer l'historique agent"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Effacer</span>
        </button>
      )}
    </header>
  );
}
