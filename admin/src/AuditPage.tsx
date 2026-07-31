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
  "user.subscription.update": "Abonnement modifié",
  "user.outreach_update": "Niveau / compteur modifié",
  "user.outreach.update": "Niveau / compteur modifié",
  "user.pause_automations": "Campagnes en pause",
  "user.stop_outbound": "Envois coupés",
  "user.set_auto_reply": "Réponses auto modifiées",
  "user.suspend": "Compte suspendu",
  "user.unsuspend": "Compte réactivé",
  "user.soft_delete": "Compte soft-supprimé",
  "user.hard_delete": "Compte supprimé définitivement",
  "user.clear_agent_history": "Historique agent vidé (compte)",
  "platform.clear_agent_history": "Historique agent vidé (tous les comptes)",
};

export function AuditPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [targetUserId, setTargetUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    const tid = targetUserId.trim();
    if (tid && Number.isFinite(Number(tid))) {
      params.set("targetUserId", tid);
    }
    api<{ items: AuditRow[]; total: number }>(`/api/admin/audit?${params}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [offset, targetUserId]);

  return (
    <>
      <header className="topbar">
        <h1>Journal</h1>
        <span style={{ color: "var(--text-500)" }}>{total} événements</span>
      </header>
      <div className="content">
        <div className="panel">
          <div className="panel-head">
            <h2>Événements admin</h2>
            <div className="filters">
              <input
                placeholder="Filtrer n° compte (ex. 12)"
                value={targetUserId}
                onChange={(e) => {
                  setOffset(0);
                  setTargetUserId(e.target.value.replace(/[^\d]/g, ""));
                }}
                inputMode="numeric"
              />
            </div>
          </div>
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
