import {
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Zap,
} from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { MAIN_NAV, type MainView } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const NAV_ICONS = {
  chat: MessageSquare,
  automation: Zap,
  settings: Settings,
} as const;

type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mainView: MainView;
  onNavigate: (view: MainView) => void;
  waConnected?: boolean;
};

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mainView,
  onNavigate,
  waConnected = true,
}: AppSidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-white/[0.06] bg-bg-0 transition-[width] duration-300 ease-silk',
        collapsed ? 'w-[68px]' : 'w-[260px]',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center border-b border-white/[0.06] py-2.5',
          collapsed ? 'flex-col gap-2 px-2' : 'justify-between gap-2 px-3',
        )}
      >
        <button
          type="button"
          onClick={() => onNavigate('chat')}
          className="shrink-0 rounded-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          aria-label="Accueil Klanvio"
          title="Klanvio"
        >
          <KlanvioLogo variant={collapsed ? 'icon' : 'full'} size="md" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded-lg p-2 text-text-500 transition hover:bg-bg-200 hover:text-text-200"
          aria-label={collapsed ? 'Ouvrir la barre latérale' : 'Réduire la barre latérale'}
          title={collapsed ? 'Ouvrir' : 'Réduire'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="shrink-0 space-y-0.5 px-2 py-3" aria-label="Navigation principale">
        {MAIN_NAV.map((item) => {
          const Icon = NAV_ICONS[item.id];
          const active = mainView === item.id;
          const disabled = !waConnected && item.id !== 'settings';
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : disabled ? 'Connectez WhatsApp d\'abord' : undefined}
              className={cn(
                'flex w-full items-center rounded-lg text-left text-sm transition-colors',
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5',
                disabled && 'cursor-not-allowed opacity-40',
                active
                  ? 'border border-brand-border bg-brand-muted font-medium text-brand'
                  : 'text-text-400 hover:bg-bg-200 hover:text-text-100',
              )}
            >
              <Icon
                className={cn('h-4 w-4 shrink-0', active ? 'text-brand' : 'text-text-500')}
              />
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
