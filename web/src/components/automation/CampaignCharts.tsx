import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TARGET_META, TARGET_ORDER } from '@/lib/campaign-metrics';

type Counts = Record<string, number>;

type CampaignChartsProps = {
  counts: Counts;
  totalTargets: number;
  reached: number;
  answered: number;
  interested: number;
  /** Labels entonnoir adaptés à l'objectif (ex. RDV, Achats…) */
  funnelLabels?: [string, string, string, string];
};

export function CampaignCharts({
  counts,
  totalTargets,
  reached,
  answered,
  interested,
  funnelLabels = ['Cibles', 'Atteints', 'Réponses', 'Intéressés'],
}: CampaignChartsProps) {
  const funnelData = [
    { name: funnelLabels[0], value: totalTargets, fill: '#94a3b8' },
    { name: funnelLabels[1], value: reached, fill: '#2057ce' },
    { name: funnelLabels[2], value: answered, fill: '#0ea5e9' },
    { name: funnelLabels[3], value: interested, fill: '#10b981' },
  ];

  const pieData = TARGET_ORDER.map((k) => ({
    name: TARGET_META[k].label,
    value: counts[k] ?? 0,
    fill: TARGET_META[k].color,
  })).filter((d) => d.value > 0);

  if (totalTargets === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-text-200">Entonnoir</h3>
        <p className="mt-0.5 text-xs text-text-500">Du volume de cibles aux intéressés</p>
        <div className="mt-4 h-56 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(32,87,206,0.06)' }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid rgba(15,23,42,0.1)',
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={48}>
                {funnelData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-text-200">Répartition</h3>
        <p className="mt-0.5 text-xs text-text-500">{totalTargets} cible(s) au total</p>
        <div className="mt-2 flex h-56 min-w-0 items-center gap-2">
          <div className="h-full min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid rgba(15,23,42,0.1)',
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-[42%] shrink-0 space-y-2 text-xs text-text-400 sm:w-36">
            {pieData.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.fill }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="font-medium text-text-200">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
