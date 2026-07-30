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
        <h1>Journal d’audit</h1>
        <span style={{ color: "var(--muted)" }}>{total} événements</span>
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
                      <th>Acteur</th>
                      <th>Action</th>
                      <th>User</th>
                      <th>IP</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.createdAt)}</td>
                        <td>{row.actor}</td>
                        <td>
                          <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{row.action}</code>
                        </td>
                        <td>
                          {row.targetUserId != null ? (
                            <Link to={`/users/${row.targetUserId}`}>#{row.targetUserId}</Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{row.ip || "—"}</td>
                        <td
                          style={{
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                          }}
                          title={JSON.stringify(row.payload)}
                        >
                          {JSON.stringify(row.payload)}
                        </td>
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
