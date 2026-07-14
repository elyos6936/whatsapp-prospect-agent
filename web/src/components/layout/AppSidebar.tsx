import { useEffect } from 'react';
import {
  MessageSquare,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
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
  mobileOpen: boolean;
  onMobileClose: () => void;
};

function NavItems({
  collapsed,
  mainView,
  onNavigate,
  waConnected,
  onAfterNavigate,
}: {
  collapsed: boolean;
  mainView: MainView;
  onNavigate: (view: MainView) => void;
  waConnected: boolean;
  onAfterNavigate?: () => void;
}) {
  return (
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
            onClick={() => {
              onNavigate(item.id);
              onAfterNavigate?.();
            }}
            title={collapsed ? item.label : disabled ? "Connectez WhatsApp d'abord" : undefined}
            className={cn(
              'flex w-full items-center rounded-lg text-left text-sm transition-colors',
              collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5',
              disabled && 'cursor-not-allowed opacity-40',
              active
                ? 'border border-brand-border bg-brand-muted font-medium text-brand'
                : 'text-text-400 hover:bg-bg-200 hover:text-text-100',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand' : 'text-text-500')} />
            {!collapsed && <span className="font-medium">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mainView,
  onNavigate,
  waConnected = true,
  mobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'hidden h-full shrink-0 flex-col border-r border-black/[0.06] bg-bg-0 transition-[width] duration-300 ease-silk md:flex',
          collapsed ? 'w-[68px]' : 'w-[240px]',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center border-b border-black/[0.06] py-2.5',
            collapsed ? 'flex-col gap-2 px-2' : 'justify-between gap-2 px-3',
          )}
        >
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            className="shrink-0 rounded-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label="Accueil Klanvio"
          >
            <KlanvioLogo variant={collapsed ? 'icon' : 'full'} size="md" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-lg p-2 text-text-500 transition hover:bg-bg-200 hover:text-text-200"
            aria-label={collapsed ? 'Ouvrir la barre latérale' : 'Réduire la barre latérale'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <NavItems
          collapsed={collapsed}
          mainView={mainView}
          onNavigate={onNavigate}
          waConnected={waConnected}
        />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Fermer le menu"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(86vw,280px)] flex-col border-r border-black/[0.06] bg-bg-0 shadow-xl transition-transform duration-300 ease-silk md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2.5">
          <KlanvioLogo variant="full" size="md" />
          <button
            type="button"
            onClick={onMobileClose}
            className="rounded-lg p-2 text-text-500 hover:bg-bg-200"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <NavItems
          collapsed={false}
          mainView={mainView}
          onNavigate={onNavigate}
          waConnected={waConnected}
          onAfterNavigate={onMobileClose}
        />
      </aside>
    </>
  );
}

export function MobileNavButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-400 transition hover:bg-bg-200 hover:text-text-100 md:hidden"
      aria-label="Ouvrir le menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
