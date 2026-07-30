import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ActivityPoint = { date: string; envoyes: number; recus: number };

function shortDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

export function ActivityChart({
  data,
  title,
  subtitle,
}: {
  data: ActivityPoint[];
  title: string;
  subtitle?: string;
}) {
  const chartData = data.map((d) => ({
    ...d,
    label: shortDate(d.date),
  }));

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? (
            <div style={{ color: "var(--text-500)", fontSize: 12, marginTop: 2 }}>{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div style={{ width: "100%", height: 260, padding: "8px 12px 16px" }}>
        {chartData.length === 0 ? (
          <div className="empty">Aucune donnée</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-500)" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--text-500)" }} width={36} />
              <Tooltip
                contentStyle={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(_, payload) => {
                  const raw = payload?.[0]?.payload?.date;
                  return raw ? String(raw) : "";
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="envoyes"
                name="Envoyés"
                stroke="#2057ce"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="recus"
                name="Reçus"
                stroke="#059669"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
