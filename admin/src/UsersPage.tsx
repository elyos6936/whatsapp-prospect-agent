import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "./api";

type UserRow = {
  id: number;
  email: string;
  name: string;
  subscriptionStatus: string;
  outreachLevel: number;
  totalMessagesSent: number;
  messages24h: number;
  messagesOut24h: number;
  messagesIn24h: number;
  activeCampaigns: number;
  onboardingCompleted: boolean;
  createdAt: string;
};

export function UsersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (level) params.set("level", level);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    api<{ items: UserRow[]; total: number }>(`/api/admin/users?${params}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [q, status, level, offset]);

  return (
    <>
      <header className="topbar">
        <h1>Utilisateurs</h1>
        <span style={{ color: "var(--muted)" }}>{total} au total</span>
      </header>
      <div className="content">
        <div className="panel">
          <div className="panel-head">
            <h2>Liste</h2>
            <div className="filters">
              <input
                placeholder="Recherche email / nom"
                value={q}
                onChange={(e) => {
                  setOffset(0);
                  setQ(e.target.value);
                }}
              />
              <select
                value={status}
                onChange={(e) => {
                  setOffset(0);
                  setStatus(e.target.value);
                }}
              >
                <option value="">Tous statuts</option>
                <option value="active">active</option>
                <option value="trial">trial</option>
                <option value="expired">expired</option>
              </select>
              <select
                value={level}
                onChange={(e) => {
                  setOffset(0);
                  setLevel(e.target.value);
                }}
              >
                <option value="">Tous niveaux</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    Niv. {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error ? <div className="error-inline">{error}</div> : null}
          {loading ? <div className="loading">Chargement…</div> : null}
          {!loading && !error && items.length === 0 ? (
            <div className="empty">Aucun utilisateur</div>
          ) : null}
          {!loading && items.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Email</th>
                      <th>Statut</th>
                      <th>Niv.</th>
                      <th>Msgs life</th>
                      <th>24h out/in</th>
                      <th>Camp. actives</th>
                      <th>Onboard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link to={`/users/${u.id}`}>#{u.id}</Link>
                        </td>
                        <td>
                          <Link to={`/users/${u.id}`}>{u.email}</Link>
                          {u.name ? (
                            <div style={{ color: "var(--muted)", fontSize: 11 }}>{u.name}</div>
                          ) : null}
                        </td>
                        <td>
                          <StatusBadge status={u.subscriptionStatus} />
                        </td>
                        <td>{u.outreachLevel}</td>
                        <td>{u.totalMessagesSent}</td>
                        <td>
                          {u.messagesOut24h}/{u.messagesIn24h}
                        </td>
                        <td>{u.activeCampaigns}</td>
                        <td>{u.onboardingCompleted ? "oui" : "non"}</td>
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

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "active" ? "badge-active" : status === "expired" ? "badge-expired" : "badge-trial";
  return <span className={`badge ${cls}`}>{status}</span>;
}
