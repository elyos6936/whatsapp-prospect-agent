import { ArrowLeft, ArrowDownLeft, ArrowUpRight, MessageSquare, Target, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AutomationStats } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'En pause',
  completed: 'Terminée',
  failed: 'Échouée',
};

function HeroCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-4',
        accent ? 'border-brand-border bg-brand-muted' : 'border-white/10 bg-bg-100',
      )}
    >
      <div className="flex items-center gap-2 text-text-500">
        <span className={cn('grid h-7 w-7 place-items-center rounded-lg', accent ? 'bg-brand/20 text-brand' : 'bg-bg-300 text-text-400')}>
          {icon}
        </span>
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn('mt-3 text-2xl font-semibold', accent ? 'text-brand' : 'text-text-100')}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-500">{hint}</p>}
    </div>
  );
}

function FunnelRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-300">{label}</span>
        <span className="text-text-400">
          {value}
          {total > 0 && <span className="ml-1 text-xs text-text-500">({pct}%)</span>}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg-300">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface AutomationStatsViewProps {
  data: AutomationStats;
  onBack: () => void;
}

export function AutomationStatsView({ data, onBack }: AutomationStatsViewProps) {
  const { automation, stats, today } = data;
  const rate = stats.responseRatePercent != null ? `${stats.responseRatePercent}%` : '—';
  const isGroup = automation.type === 'group_prospect';
  const funnelTotal = isGroup ? stats.targetsTotal || stats.contacted || 1 : stats.messagesHandled || 1;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour
      </button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-light text-text-100">{automation.name}</h2>
          <p className="text-sm text-text-500">
            #{automation.id}
            {automation.mode && <> · {automation.mode}</>}
            {automation.origin && <> · {automation.origin === 'manual' ? 'manuelle' : 'depuis le chat'}</>}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-1 text-xs',
            automation.status === 'active' && 'bg-emerald-500/20 text-emerald-400',
            automation.status === 'paused' && 'bg-amber-500/20 text-amber-400',
            automation.status === 'failed' && 'bg-red-500/20 text-red-400',
            automation.status === 'completed' && 'bg-bg-300 text-text-400',
          )}
        >
          {STATUS_LABELS[automation.status] || automation.status}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroCard
          icon={<MessageSquare className="h-4 w-4" />}
          label="Messages envoyés"
          value={stats.messagesSent}
        />
        <HeroCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Taux de réponse"
          value={rate}
          hint="Réponses / contactés"
          accent
        />
        <HeroCard icon={<Users className="h-4 w-4" />} label="Réponses reçues" value={stats.replied} />
        <HeroCard icon={<Target className="h-4 w-4" />} label="Conversions" value={stats.conversions} />
      </div>

      {today && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-bg-100 p-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <ArrowDownLeft className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-text-100">{today.incoming}</p>
              <p className="text-xs text-text-500">Reçus aujourd&apos;hui</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-bg-100 p-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/15 text-brand">
              <ArrowUpRight className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-text-100">{today.outgoing}</p>
              <p className="text-xs text-text-500">Envoyés aujourd&apos;hui</p>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-bg-100 p-5">
        <h3 className="mb-4 text-sm font-medium text-text-200">Entonnoir</h3>
        <div className="space-y-3">
          {isGroup ? (
            <>
              <FunnelRow label="Contactés" value={stats.contacted} total={funnelTotal} color="bg-brand" />
              <FunnelRow label="Réponses" value={stats.replied} total={funnelTotal} color="bg-sky-500" />
              <FunnelRow label="Intéressés" value={stats.interested} total={funnelTotal} color="bg-emerald-500" />
              <FunnelRow label="Conversions" value={stats.conversions} total={funnelTotal} color="bg-emerald-400" />
            </>
          ) : (
            <>
              <FunnelRow label="Messages traités" value={stats.messagesHandled} total={funnelTotal} color="bg-brand" />
              <FunnelRow label="Réponses" value={stats.replied} total={funnelTotal} color="bg-sky-500" />
              <FunnelRow label="Intéressés" value={stats.interested} total={funnelTotal} color="bg-emerald-500" />
              <FunnelRow label="Conversions" value={stats.conversions} total={funnelTotal} color="bg-emerald-400" />
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {isGroup && (
            <>
              <span className="rounded-lg bg-bg-200 px-3 py-2 text-text-400">
                Cible : <span className="text-text-200">{stats.targetsTotal}</span>
              </span>
              <span className="rounded-lg bg-bg-200 px-3 py-2 text-text-400">
                En attente : <span className="text-text-200">{stats.pending}</span>
              </span>
            </>
          )}
          <span className="rounded-lg bg-bg-200 px-3 py-2 text-text-400">
            Arrêtés : <span className="text-text-200">{stats.stopped}</span>
          </span>
          {stats.lastActionAt && (
            <span className="col-span-2 rounded-lg bg-bg-200 px-3 py-2 text-text-400 sm:col-span-2">
              Dernière action : {new Date(stats.lastActionAt).toLocaleString('fr-FR')}
            </span>
          )}
        </div>
      </section>

      {stats.report && (
        <section className="rounded-2xl border border-white/10 bg-bg-100 p-5">
          <h3 className="text-sm font-medium text-text-200">Dernier rapport</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-400">{stats.report}</p>
        </section>
      )}
    </div>
  );
}
