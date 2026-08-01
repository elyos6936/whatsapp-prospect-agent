import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type TemporalPoint = {
  date: string;
  discussing: number;
  newlyReached: number;
  newlyAnswered: number;
  newlyInterested: number;
  inboundMessages: number;
  outboundMessages: number;
};

type CampaignTemporalChartsProps = {
  series: TemporalPoint[];
  mode: 'outbound' | 'inbound';
};

function fmtTick(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return `${d}/${m}`;
}

/** Nombre de ticks X lisibles (~6–8) selon la longueur de la série. */
function xTickInterval(pointCount: number): number {
  if (pointCount <= 8) return 0;
  return Math.max(0, Math.ceil(pointCount / 7) - 1);
}

export function CampaignTemporalCharts({ series, mode }: CampaignTemporalChartsProps) {
  if (!series.length) return null;

  const tickInterval = xTickInterval(series.length);
  const angled = series.length > 14;
  const data = series.map((row) => ({
    ...row,
    label: fmtTick(row.date),
  }));

  const xAxisProps = {
    dataKey: 'label' as const,
    tick: { fontSize: 10, fill: '#64748b' },
    axisLine: false,
    tickLine: false,
    interval: tickInterval,
    minTickGap: 28,
    ...(angled
      ? { angle: -35, textAnchor: 'end' as const, height: 48, dy: 8 }
      : { height: 24 }),
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-text-200">
          {mode === 'outbound' ? 'Évolution prospection' : 'Évolution des discussions'}
        </h3>
        <p className="mt-0.5 text-xs text-text-500">
          {mode === 'outbound'
            ? 'Nouveaux atteints et premières réponses par jour'
            : 'Personnes distinctes ayant écrit, par jour'}
        </p>
        <div className="mt-4 h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 8, left: -12, bottom: angled ? 12 : 4 }}
            >
              <defs>
                <linearGradient id="gReached" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2057ce" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2057ce" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gAnswered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as TemporalPoint | undefined;
                  return p?.date ?? '';
                }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid rgba(15,23,42,0.1)',
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {mode === 'outbound' ? (
                <>
                  <Area
                    type="monotone"
                    dataKey="newlyReached"
                    name="Atteints"
                    stroke="#2057ce"
                    fill="url(#gReached)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="newlyAnswered"
                    name="Réponses"
                    stroke="#0ea5e9"
                    fill="url(#gAnswered)"
                    strokeWidth={2}
                  />
                </>
              ) : (
                <Area
                  type="monotone"
                  dataKey="discussing"
                  name="Personnes"
                  stroke="#2057ce"
                  fill="url(#gReached)"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-text-200">Messages & intérêt</h3>
        <p className="mt-0.5 text-xs text-text-500">Volume journalier et nouveaux intéressés</p>
        <div className="mt-4 h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, left: -12, bottom: angled ? 12 : 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.08)" vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as TemporalPoint | undefined;
                  return p?.date ?? '';
                }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid rgba(15,23,42,0.1)',
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="inboundMessages"
                name="Entrants"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="outboundMessages"
                name="Sortants"
                stroke="#64748b"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="newlyInterested"
                name="Intéressés"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
