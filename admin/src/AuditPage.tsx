import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "./api";

type AuditRow = {
  id: number;
  createdAt: string;
  actor: string;
  action: string;
  targetUserId: number | null;
  payload: Record<string, unknown>;
  ip: string | null;
};

const ACTION_FR: Record<string, string> = {
  "admin.login": "Connexion admin",
  "user.subscription_update": "Abonnement modifié",
  "user.outreach_update": "Niveau / compteur modifié",
  "user.pause_automations": "Campagnes en pause",
  "user.stop_outbound": "Envois coupés",
  "user.set_auto_reply": "Réponses auto modifiées",
};

export function AuditPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    api<{ items: AuditRow[]; total: number }>(
      `/api/admin/audit?limit=${limit}&offset=${offset}`
    )
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [offset]);

  return (
    <>
      <header className="topbar">
        <h1>Journal</h1>
        <span style={{ color: "var(--text-500)" }}>{total} événements</span>
      </header>
      <div className="content">
        <div className="panel">
          {error ? <div className="error-inline">{error}</div> : null}
          {loading ? <div className="loading">Chargement…</div> : null}
          {!loading && items.length === 0 ? <div className="empty">Aucun événement</div> : null}
          {!loading && items.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Quand</th>
                      <th>Auteur</th>
                      <th>Action</th>
                      <th>Compte cible</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.createdAt)}</td>
                        <td>{row.actor}</td>
                        <td>{ACTION_FR[row.action] ?? row.action}</td>
                        <td>
                          {row.targetUserId != null ? (
                            <Link to={`/users/${row.targetUserId}`}>#{row.targetUserId}</Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{row.ip || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={offset <= 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  Précédent
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + limit, total)} / {total}
                </span>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                >
                  Suivant
                </button>
              </div>
            </>
          ) : null}
        </div>
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
