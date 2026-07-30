import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "./api";

type Overview = {
  users: {
    total: number;
    active: number;
    trial: number;
    expired: number;
    lifetimeOutbound: number;
  };
  messages24h: { entrant: number; sortant: number; sortantQuota: number };
  messages7d: { entrant: number; sortant: number; sortantQuota: number };
  campaigns: { active: number; draft: number; paused: number; completed: number };
  queue: { pending: number; processing: number; failed: number; sent24h: number };
  errors24h: number;
  sequencesActive: number;
  recentUsers: Array<{ id: number; email: string; name: string; createdAt: string }>;
  topOutbound: Array<{ id: number; email: string; lifetimeSent: number; out24h: number }>;
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
        <h1>Vue d’ensemble</h1>
      </header>
      <div className="content">
        {error ? <div className="error-inline">{error}</div> : null}
        {!data && !error ? <div className="loading">Chargement…</div> : null}
        {data ? (
          <>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="label">Utilisateurs</div>
                <div className="value">{data.users.total}</div>
              </div>
              <div className="kpi">
                <div className="label">Actifs</div>
                <div className="value">{data.users.active}</div>
              </div>
              <div className="kpi">
                <div className="label">Msgs 24h out</div>
                <div className="value">{data.messages24h.sortant}</div>
              </div>
              <div className="kpi">
                <div className="label">Msgs 24h in</div>
                <div className="value">{data.messages24h.entrant}</div>
              </div>
              <div className="kpi">
                <div className="label">Out quota 24h</div>
                <div className="value">{data.messages24h.sortantQuota}</div>
              </div>
              <div className="kpi">
                <div className="label">File sent 24h</div>
                <div className="value">{data.queue.sent24h}</div>
              </div>
              <div className="kpi">
                <div className="label">Campagnes actives</div>
                <div className="value">{data.campaigns.active}</div>
              </div>
              <div className="kpi">
                <div className="label">File pending</div>
                <div className="value">{data.queue.pending}</div>
              </div>
              <div className="kpi">
                <div className="label">File failed</div>
                <div className="value">{data.queue.failed}</div>
              </div>
              <div className="kpi">
                <div className="label">Erreurs logs 24h</div>
                <div className="value">{data.errors24h}</div>
              </div>
              <div className="kpi">
                <div className="label">Séquences actives</div>
                <div className="value">{data.sequencesActive}</div>
              </div>
              <div className="kpi">
                <div className="label">Lifetime out (Σ)</div>
                <div className="value">{data.users.lifetimeOutbound}</div>
              </div>
              <div className="kpi">
                <div className="label">Msgs 7j out</div>
                <div className="value">{data.messages7d.sortant}</div>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: 20 }}>
              <div className="panel">
                <div className="panel-head">
                  <h2>Top volume lifetime</h2>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Lifetime</th>
                        <th>Out 24h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topOutbound.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <Link to={`/users/${u.id}`}>{u.email}</Link>
                          </td>
                          <td>{u.lifetimeSent}</td>
                          <td>{u.out24h}</td>
                        </tr>
                      ))}
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
                        <th>ID</th>
                        <th>Email</th>
                        <th>Créé</th>
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
