import { useEffect, useRef, useState } from 'react';
import {
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { CampaignStatusToggle } from '@/components/automation/CampaignStatusToggle';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
  onRenameThread: (id: number, title: string) => Promise<void> | void;
  onDeleteThread: (id: number) => Promise<void> | void;
  /** Après pause / activation d’une campagne (rafraîchir la liste). */
  onCampaignStatusChange?: () => void | Promise<void>;
  creatingThread?: boolean;
  waConnected?: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

function ThreadActionsMenu({
  thread,
  onRename,
  onDelete,
}: {
  thread: AgentThreadSummary;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-md p-1 text-text-500 opacity-70 transition hover:bg-black/5 hover:text-text-200 hover:opacity-100"
        aria-label={`Actions pour ${thread.title}`}
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-black/[0.08] bg-bg-0 py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-300 transition hover:bg-bg-200 hover:text-text-100"
          >
            <Pencil className="h-3.5 w-3.5" />
            Renommer
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

function ThreadList({
  collapsed,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  onCampaignStatusChange,
  creatingThread,
  waConnected,
  onAfterNavigate,
}: {
  collapsed: boolean;
  threads: AgentThreadSummary[];
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
  onNewThread: () => void;
  onRenameThread: (id: number, title: string) => Promise<void> | void;
  onDeleteThread: (id: number) => Promise<void> | void;
  onCampaignStatusChange?: () => void | Promise<void>;
  creatingThread?: boolean;
  waConnected: boolean;
  onAfterNavigate?: () => void;
}) {
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AgentThreadSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId != null) inputRef.current?.focus();
  }, [renamingId]);

  const startRename = (thread: AgentThreadSummary) => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
  };

  const commitRename = async (id: number) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    const current = threads.find((t) => t.id === id);
    if (current && current.title === title) return;
    setBusyId(id);
    try {
      await onRenameThread(id, title);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const thread = pendingDelete;
    if (!thread) return;
    setPendingDelete(null);
    setBusyId(thread.id);
    try {
      await onDeleteThread(thread.id);
      onAfterNavigate?.();
    } finally {
      setBusyId(null);
    }
  };

  const deleteMessage = pendingDelete
    ? pendingDelete.automation_id
      ? `Supprimer « ${pendingDelete.title || 'cette automatisation'} » et sa campagne associée ? Cette action est définitive.`
      : `Supprimer « ${pendingDelete.title || 'cette automatisation'} » ? Cette action est définitive.`
    : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConfirmDialog
        open={pendingDelete != null}
        title="Supprimer ?"
        message={deleteMessage}
        confirmLabel="Oui"
        cancelLabel="Non"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
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
          const desc = thread.description?.trim();
          const subtitle = desc
            ? `${badge} · ${desc.length > 40 ? `${desc.slice(0, 39)}…` : desc}`
            : badge;
          const isRenaming = renamingId === thread.id;
          const isBusy = busyId === thread.id;

          if (collapsed) {
            return (
              <button
                key={thread.id}
                type="button"
                disabled={!waConnected}
                onClick={() => {
                  onSelectThread(thread.id);
                  onAfterNavigate?.();
                }}
                title={thread.title}
                className={cn(
                  'flex w-full items-center justify-center rounded-lg px-2 py-2.5 text-sm transition-colors',
                  !waConnected && 'cursor-not-allowed opacity-40',
                  active
                    ? 'border border-brand-border bg-brand-muted font-medium text-brand'
                    : 'text-text-400 hover:bg-bg-200 hover:text-text-100',
                )}
              >
                <span className="text-xs font-semibold">#{thread.id}</span>
              </button>
            );
          }

          return (
            <div
              key={thread.id}
              className={cn(
                'group relative flex w-full items-start gap-1 rounded-lg text-sm transition-colors',
                !waConnected && 'opacity-40',
                active
                  ? 'border border-brand-border bg-brand-muted font-medium text-brand'
                  : 'text-text-400 hover:bg-bg-200 hover:text-text-100',
                isBusy && 'pointer-events-none opacity-60',
              )}
            >
              {isRenaming ? (
                <form
                  className="min-w-0 flex-1 px-2 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void commitRename(thread.id);
                  }}
                >
                  <input
                    ref={inputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(thread.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setRenamingId(null);
                      }
                    }}
                    className="w-full rounded-md border border-brand-border bg-bg-0 px-2 py-1 text-sm text-text-100 outline-none focus:ring-2 focus:ring-brand/20"
                    maxLength={80}
                    aria-label="Nouveau nom"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  disabled={!waConnected}
                  onClick={() => {
                    onSelectThread(thread.id);
                    onAfterNavigate?.();
                  }}
                  className={cn(
                    'min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left',
                    !waConnected && 'cursor-not-allowed',
                  )}
                >
                  <span className="block truncate font-medium">{thread.title}</span>
                  <span className={cn('text-[11px]', active ? 'text-brand/80' : 'text-text-500')}>
                    {subtitle}
                  </span>
                </button>
              )}

              {waConnected && !isRenaming && (
                <div className="flex shrink-0 items-center gap-0.5 pr-1 pt-2">
                  {thread.automation_id != null && status && (
                    <CampaignStatusToggle
                      automationId={thread.automation_id}
                      status={status}
                      size="sm"
                      onUpdated={onCampaignStatusChange}
                    />
                  )}
                  <ThreadActionsMenu
                    thread={thread}
                    onRename={() => startRename(thread)}
                    onDelete={() => setPendingDelete(thread)}
                  />
                </div>
              )}
            </div>
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
  onRenameThread,
  onDeleteThread,
  onCampaignStatusChange,
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
          onRenameThread={onRenameThread}
          onDeleteThread={onDeleteThread}
          onCampaignStatusChange={onCampaignStatusChange}
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
          onRenameThread={onRenameThread}
          onDeleteThread={onDeleteThread}
          onCampaignStatusChange={onCampaignStatusChange}
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
