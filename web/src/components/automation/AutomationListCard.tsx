import { BarChart3, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutomationSummary } from '@/lib/api';

const TYPE_LABELS: Record<string, string> = {
  group_prospect: 'Prospection groupe',
  keyword_sales: 'Closing e-commerce',
  custom_followup: 'Suivi personnalisé',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'En pause',
  completed: 'Terminée',
  failed: 'Échouée',
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

interface AutomationListCardProps {
  auto: AutomationSummary;
  onOpen?: () => void;
  onStats?: () => void;
  onToggleStatus?: () => void;
  compact?: boolean;
}

export function AutomationListCard({
  auto,
  onOpen,
  onStats,
  onToggleStatus,
  compact,
}: AutomationListCardProps) {
  const contacted = (auto.stats?.contacted as number) ?? 0;
  const pending = (auto.stats?.pending as number) ?? 0;
  const replied = (auto.stats?.replied as number) ?? 0;
  const handled = (auto.stats?.messagesHandled as number) ?? 0;
  const progress =
    auto.type === 'group_prospect'
      ? `${contacted} contacté(s) · ${pending} restant(s) · ${replied} réponse(s)`
      : `${handled} message(s) traité(s)`;

  return (
    <article
      className={cn(
        'rounded-2xl border border-white/10 bg-bg-100 transition hover:border-brand-border',
        onOpen && 'cursor-pointer',
        compact ? 'p-4' : 'p-5',
      )}
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => e.key === 'Enter' && onOpen() : undefined}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-text-100">{auto.name}</h3>
          <span className="text-xs text-brand">{TYPE_LABELS[auto.type] || auto.type}</span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs',
            auto.status === 'active' && 'bg-emerald-500/20 text-emerald-400',
            auto.status === 'paused' && 'bg-amber-500/20 text-amber-400',
            auto.status === 'failed' && 'bg-red-500/20 text-red-400',
            auto.status === 'completed' && 'bg-bg-300 text-text-400',
          )}
        >
          {STATUS_LABELS[auto.status] || auto.status}
        </span>
      </div>

      {!compact && (
        <>
          <p className="mt-2 line-clamp-2 text-sm text-text-400">{auto.summary || '—'}</p>
          <p className="mt-1 text-xs text-text-500">{progress}</p>
          {auto.created_at && (
            <p className="mt-1 text-[11px] text-text-500">Créée le {fmtTime(auto.created_at)}</p>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {onStats && (
          <button
            type="button"
            onClick={onStats}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-bg-200"
          >
            <BarChart3 className="h-3 w-3" />
            Statistiques
          </button>
        )}
        {onToggleStatus && auto.status === 'active' && (
          <button
            type="button"
            onClick={onToggleStatus}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-bg-200"
          >
            <Pause className="h-3 w-3" />
            Désactiver
          </button>
        )}
        {onToggleStatus && auto.status === 'paused' && (
          <button
            type="button"
            onClick={onToggleStatus}
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1 text-xs text-white"
          >
            <Play className="h-3 w-3" />
            Activer
          </button>
        )}
      </div>
    </article>
  );
}
