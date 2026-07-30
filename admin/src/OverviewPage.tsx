import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "./api";

type Overview = {
  users: { total: number; active: number; trial: number; expired: number };
  messages24h: { entrant: number; sortant: number };
  messages7d: { entrant: number; sortant: number };
  campaigns: { active: number; draft: number; paused: number };
  queue: { pending: number; processing: number };
  recentUsers: Array<{ id: number; email: string; name: string; createdAt: string }>;
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
                <div className="label">Campagnes actives</div>
                <div className="value">{data.campaigns.active}</div>
              </div>
              <div className="kpi">
                <div className="label">File pending</div>
                <div className="value">{data.queue.pending}</div>
              </div>
              <div className="kpi">
                <div className="label">File processing</div>
                <div className="value">{data.queue.processing}</div>
              </div>
              <div className="kpi">
                <div className="label">Msgs 7j out</div>
                <div className="value">{data.messages7d.sortant}</div>
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
                      <th>Nom</th>
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
                        <td>{u.name || "—"}</td>
                        <td>{formatDate(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
