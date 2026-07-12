import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { AutomationStats } from '@/lib/api';

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-bg-200 px-3 py-2 text-center">
      <p className="text-base font-semibold text-text-100">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-text-500">{label}</p>
    </div>
  );
}

export function AutomationStatsBar({ data }: { data: AutomationStats }) {
  const { stats, today } = data;
  const rate = stats.responseRatePercent != null ? `${stats.responseRatePercent}%` : '—';

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Metric value={stats.messagesSent} label="Envoyés" />
        <Metric value={stats.replied} label="Réponses" />
        <Metric value={rate} label="Taux" />
        <Metric value={stats.conversions} label="Conv." />
      </div>
      {today && (
        <div className="flex items-center justify-center gap-4 text-xs text-text-400">
          <span className="inline-flex items-center gap-1">
            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />
            {today.incoming} reçus
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowUpRight className="h-3.5 w-3.5 text-brand" />
            {today.outgoing} envoyés
          </span>
          <span className="text-text-500">aujourd&apos;hui</span>
        </div>
      )}
    </div>
  );
}
