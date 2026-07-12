import {
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Smartphone,
  Zap,
} from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { MAIN_NAV, type MainView } from '@/lib/navigation';
import type { HealthStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV_ICONS = {
  chat: MessageSquare,
  console: Smartphone,
  automation: Zap,
  settings: Settings,
} as const;

type AppSidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mainView: MainView;
  onNavigate: (view: MainView) => void;
  health: HealthStatus | null;
};

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs',
        ok ? 'text-emerald-400' : 'text-amber-400',
      )}
      title={label}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          ok ? 'bg-emerald-500' : 'bg-amber-500',
        )}
      />
      {!label ? null : <span className="truncate">{label}</span>}
    </div>
  );
}

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mainView,
  onNavigate,
  health,
}: AppSidebarProps) {
  const openaiOk = health?.openai?.configured ?? false;
  const waOk = health?.whatsapp?.connected ?? false;

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
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex w-full items-center rounded-lg text-left text-sm transition-colors',
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5',
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

      <div className="mt-auto border-t border-white/[0.06] px-2 py-3">
        {!collapsed ? (
          <div className="space-y-1 rounded-xl border border-white/[0.06] bg-bg-100 p-2.5">
            <p className="px-1 text-[10px] font-medium uppercase tracking-wider text-text-500">
              État
            </p>
            <StatusDot ok={openaiOk} label={openaiOk ? 'OpenAI OK' : 'OpenAI manquant'} />
            <StatusDot
              ok={waOk}
              label={waOk ? 'WhatsApp connecté' : health?.whatsapp?.state || 'WhatsApp hors ligne'}
            />
            {health?.outbound && (
              <p className="px-1 pt-1 text-[11px] text-text-500">
                Quota : {health.outbound.today}/{health.outbound.limit}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                openaiOk ? 'bg-emerald-500' : 'bg-amber-500',
              )}
              title={openaiOk ? 'OpenAI OK' : 'OpenAI manquant'}
            />
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                waOk ? 'bg-emerald-500' : 'bg-amber-500',
              )}
              title={waOk ? 'WhatsApp connecté' : 'WhatsApp hors ligne'}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
