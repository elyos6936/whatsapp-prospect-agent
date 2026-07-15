import { useEffect } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import type { AgentThreadSummary } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  active: 'Active',
  paused: 'Pause',
  completed: 'Terminée',
  failed: 'Échouée',
};

type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  threads: AgentThreadSummary[];
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
  onNewThread: () => void;
  creatingThread?: boolean;
  waConnected?: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

function ThreadList({
  collapsed,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  creatingThread,
  waConnected,
  onAfterNavigate,
}: {
  collapsed: boolean;
  threads: AgentThreadSummary[];
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
  onNewThread: () => void;
  creatingThread?: boolean;
  waConnected: boolean;
  onAfterNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 py-3">
        <button
          type="button"
          disabled={!waConnected || creatingThread}
          onClick={() => {
            onNewThread();
            onAfterNavigate?.();
          }}
          title={collapsed ? 'Nouvelle automatisation' : undefined}
          className={cn(
            'flex w-full items-center rounded-lg text-left text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5',
            !waConnected || creatingThread
              ? 'cursor-not-allowed opacity-40'
              : 'bg-brand text-white hover:bg-brand-dark',
          )}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{creatingThread ? 'Création…' : 'Nouvelle automatisation'}</span>}
        </button>
      </div>

      <nav
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 custom-scrollbar"
        aria-label="Automatisations"
      >
        {threads.map((thread) => {
          const active = activeThreadId === thread.id;
          const status = thread.automation_status;
          const badge = status ? STATUS_LABELS[status] || status : 'Vide';
          return (
            <button
              key={thread.id}
              type="button"
              disabled={!waConnected}
              onClick={() => {
                onSelectThread(thread.id);
                onAfterNavigate?.();
              }}
              title={collapsed ? thread.title : undefined}
              className={cn(
                'flex w-full flex-col rounded-lg text-left text-sm transition-colors',
                collapsed ? 'items-center px-2 py-2.5' : 'gap-0.5 px-3 py-2.5',
                !waConnected && 'cursor-not-allowed opacity-40',
                active
                  ? 'border border-brand-border bg-brand-muted font-medium text-brand'
                  : 'text-text-400 hover:bg-bg-200 hover:text-text-100',
              )}
            >
              {collapsed ? (
                <span className="text-xs font-semibold">#{thread.id}</span>
              ) : (
                <>
                  <span className="truncate font-medium">{thread.title}</span>
                  <span
                    className={cn(
                      'text-[11px]',
                      active ? 'text-brand/80' : 'text-text-500',
                    )}
                  >
                    {badge}
                  </span>
                </>
              )}
            </button>
          );
        })}
        {!threads.length && !collapsed && (
          <p className="px-3 py-2 text-xs text-text-500">Aucune automatisation.</p>
        )}
      </nav>
    </div>
  );
}

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  creatingThread,
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
            onClick={() => activeThreadId && onSelectThread(activeThreadId)}
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
        <ThreadList
          collapsed={collapsed}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          onNewThread={onNewThread}
          creatingThread={creatingThread}
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
        <ThreadList
          collapsed={false}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          onNewThread={onNewThread}
          creatingThread={creatingThread}
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
