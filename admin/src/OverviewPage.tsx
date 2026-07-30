import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ActivityChart, type ActivityPoint } from "./ActivityChart";
import { api, ApiError } from "./api";

type Overview = {
  users: { total: number; active: number; trial: number; expired: number };
  messages: {
    envoyesAujourdhui: number;
    recusAujourdhui: number;
    envoyes7j: number;
    recus7j: number;
    envoyesLifetime: number;
  };
  campaigns: { active: number; draft: number; paused: number; completed: number };
  errors24h: number;
  recentUsers: Array<{ id: number; email: string; name: string; createdAt: string }>;
  topOutbound: Array<{
    id: number;
    email: string;
    envoyesLifetime: number;
    envoyesAujourdhui: number;
  }>;
  activitySeries: ActivityPoint[];
};

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>("/api/admin/overview")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"));
  }, []);

  return (
    <>
      <header className="topbar">
        <h1>Tableau de bord</h1>
      </header>
      <div className="content">
        {error ? <div className="error-inline">{error}</div> : null}
        {!data && !error ? <div className="loading">Chargement…</div> : null}
        {data ? (
          <>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="label">Comptes</div>
                <div className="value">{data.users.total}</div>
              </div>
              <div className="kpi">
                <div className="label">Actifs</div>
                <div className="value">{data.users.active}</div>
              </div>
              <div className="kpi">
                <div className="label">Envoyés aujourd’hui</div>
                <div className="value">{data.messages.envoyesAujourdhui}</div>
              </div>
              <div className="kpi">
                <div className="label">Reçus aujourd’hui</div>
                <div className="value">{data.messages.recusAujourdhui}</div>
              </div>
              <div className="kpi">
                <div className="label">Envoyés (total)</div>
                <div className="value">{data.messages.envoyesLifetime}</div>
              </div>
              <div className="kpi">
                <div className="label">Envoyés 7 jours</div>
                <div className="value">{data.messages.envoyes7j}</div>
              </div>
              <div className="kpi">
                <div className="label">Campagnes actives</div>
                <div className="value">{data.campaigns.active}</div>
              </div>
              <div className="kpi">
                <div className="label">Erreurs (24 h)</div>
                <div className="value">{data.errors24h}</div>
              </div>
            </div>

            <ActivityChart
              data={data.activitySeries ?? []}
              title="Activité messages"
              subtitle="30 derniers jours — envoyés vs reçus (plateforme)"
            />

            <div className="grid-2" style={{ marginBottom: 20 }}>
              <div className="panel">
                <div className="panel-head">
                  <h2>Plus gros volumes</h2>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Compte</th>
                        <th>Total envoyés</th>
                        <th>Aujourd’hui</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topOutbound.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <Link to={`/users/${u.id}`}>{u.email}</Link>
                          </td>
                          <td>{u.envoyesLifetime}</td>
                          <td>{u.envoyesAujourdhui}</td>
                        </tr>
                      ))}
                      {data.topOutbound.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ color: "var(--text-500)" }}>
                            Aucune donnée
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>Derniers inscrits</h2>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>N°</th>
                        <th>Email</th>
                        <th>Inscription</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentUsers.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <Link to={`/users/${u.id}`}>#{u.id}</Link>
                          </td>
                          <td>
                            <Link to={`/users/${u.id}`}>{u.email}</Link>
                          </td>
                          <td>{formatDate(u.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}
