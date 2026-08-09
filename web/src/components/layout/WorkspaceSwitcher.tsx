import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Users } from 'lucide-react';
import { switchWorkspace, type WorkspaceListItem } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

function workspaceLabel(ws: WorkspaceListItem): string {
  if (ws.isPersonal) return 'Perso';
  return ws.name?.trim() || `Équipe de ${ws.ownerName || '…'}`;
}

type WorkspaceSwitcherProps = {
  onSwitched?: () => void | Promise<void>;
  className?: string;
};

export function WorkspaceSwitcher({ onSwitched, className }: WorkspaceSwitcherProps) {
  const { user, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const workspaces = user?.workspaces ?? [];
  const activeId = user?.workspace?.id;
  const active =
    workspaces.find((w) => w.id === activeId) ??
    (user?.workspace
      ? ({
          id: user.workspace.id,
          name: user.workspace.name,
          role: user.workspace.role,
          billingPlan: user.workspace.billingPlan,
          ownerUserId: user.workspace.ownerUserId,
          ownerName: user.workspace.ownerName ?? '',
          isPersonal: user.workspace.isPersonal ?? false,
        } satisfies WorkspaceListItem)
      : null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!active || workspaces.length <= 1) {
    if (!active) return null;
    // Un seul espace : pastille informative sans menu.
    return (
      <div
        className={cn(
          'inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-lg border border-black/[0.08] bg-bg-100 px-2 py-1 text-[11px] text-text-400 sm:max-w-[12rem]',
          className,
        )}
        title={workspaceLabel(active)}
      >
        <Users className="h-3 w-3 shrink-0 text-text-500" />
        <span className="truncate font-medium text-text-300">{workspaceLabel(active)}</span>
      </div>
    );
  }

  const handleSelect = async (ws: WorkspaceListItem) => {
    if (ws.id === activeId || busyId != null) return;
    setBusyId(ws.id);
    try {
      await switchWorkspace(ws.id);
      await refreshUser();
      setOpen(false);
      await onSwitched?.();
    } catch (err) {
      console.error('[workspace-switch]', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[9.5rem] items-center gap-1 rounded-lg border border-black/[0.08] bg-bg-100 px-2 py-1 text-[11px] text-text-400 transition hover:border-brand/30 hover:text-text-200 sm:max-w-[12rem]"
        title="Changer d’espace"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Users className="h-3 w-3 shrink-0 text-text-500" />
        <span className="truncate font-medium text-text-300">{workspaceLabel(active)}</span>
        {busyId != null ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-black/[0.08] bg-bg-0 py-1 shadow-lg"
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-500">
            Espaces
          </p>
          {workspaces.map((ws) => {
            const selected = ws.id === activeId;
            const busy = busyId === ws.id;
            return (
              <button
                key={ws.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={busyId != null}
                onClick={() => void handleSelect(ws)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-bg-200',
                  selected ? 'text-text-100' : 'text-text-300',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate font-medium">{workspaceLabel(ws)}</span>
                  {!ws.isPersonal && (
                    <span className="block truncate text-[11px] text-text-500">
                      {roleShort(ws.role)}
                      {ws.ownerName ? ` · ${ws.ownerName}` : ''}
                    </span>
                  )}
                  {ws.isPersonal && (
                    <span className="block truncate text-[11px] text-text-500">Votre espace</span>
                  )}
                </span>
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-500" />
                ) : selected ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function roleShort(role: string): string {
  if (role === 'owner') return 'Propriétaire';
  if (role === 'admin') return 'Admin';
  return 'Membre';
}
