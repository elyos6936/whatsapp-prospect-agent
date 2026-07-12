import { ArrowLeft } from 'lucide-react';
import type { AutomationStats } from '@/lib/api';
import { cn } from '@/lib/utils';

function StatBox({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-bg-100 p-4">
      <span className="text-xs text-text-500">{label}</span>
      <p className="mt-1 text-xl font-semibold text-text-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-500">{hint}</p>}
    </div>
  );
}

interface AutomationStatsViewProps {
  data: AutomationStats;
  onBack: () => void;
}

export function AutomationStatsView({ data, onBack }: AutomationStatsViewProps) {
  const { automation, stats, today } = data;
  const rate =
    stats.responseRatePercent != null ? `${stats.responseRatePercent}%` : '—';

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

      <header>
        <h2 className="text-xl font-medium text-text-100">{automation.name}</h2>
        <p className="text-sm text-text-500">
          #{automation.id} · {automation.status}
          {today && (
            <>
              {' '}
              · Aujourd&apos;hui ({today.date}) : {today.incoming} entrant(s), {today.outgoing}{' '}
              sortant(s)
            </>
          )}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox label="Messages envoyés" value={stats.messagesSent} />
        <StatBox label="Taux de réponse" value={rate} hint="Réponses / contactés" />
        <StatBox label="Réponses" value={stats.replied} />
        <StatBox label="Intéressés" value={stats.interested} />
        {automation.type === 'group_prospect' ? (
          <>
            <StatBox label="Contactés" value={stats.contacted} />
            <StatBox label="En attente" value={stats.pending} />
            <StatBox label="Arrêtés" value={stats.stopped} />
          </>
        ) : (
          <StatBox label="Messages traités" value={stats.messagesHandled} />
        )}
        <StatBox label="Conversions" value={stats.conversions} />
      </div>

      {stats.report && (
        <section className="rounded-xl border border-white/10 bg-bg-100 p-4">
          <h3 className="text-sm font-medium text-text-200">Dernier rapport</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-400">{stats.report}</p>
        </section>
      )}

      {stats.lastActionAt && (
        <p className={cn('text-xs text-text-500')}>
          Dernière action : {new Date(stats.lastActionAt).toLocaleString('fr-FR')}
        </p>
      )}
    </div>
  );
}
