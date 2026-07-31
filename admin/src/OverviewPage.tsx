import { useEffect, useMemo, useState } from "react";
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

type UserOption = { id: number; email: string };

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userQuery, setUserQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmGlobalClear, setConfirmGlobalClear] = useState(false);
  const [confirmUserClear, setConfirmUserClear] = useState(false);

  useEffect(() => {
    api<Overview>("/api/admin/overview")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"));
    api<{ items: UserOption[] }>("/api/admin/users?limit=200&offset=0")
      .then((res) => setUserOptions(res.items.map((u) => ({ id: u.id, email: u.email }))))
      .catch(() => {
        /* liste optionnelle */
      });
  }, []);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return userOptions;
    return userOptions.filter(
      (u) => u.email.toLowerCase().includes(q) || String(u.id).includes(q)
    );
  }, [userOptions, userQuery]);

  const selectedUser = userOptions.find((u) => String(u.id) === selectedUserId) ?? null;

  async function clearAllAgentHistory() {
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const res = await api<{ deletedMessages: number }>("/api/admin/agent-history", {
        method: "DELETE",
      });
      setFlash(
        `Historique agent vidé sur tous les comptes (${res.deletedMessages} message(s) supprimé(s)).`
      );
      setConfirmGlobalClear(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de la purge.");
    } finally {
      setBusy(false);
    }
  }

  async function clearSelectedUserHistory() {
    if (!selectedUser) return;
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const res = await api<{ deletedMessages: number }>(
        `/api/admin/users/${selectedUser.id}/agent-history`,
        { method: "DELETE" }
      );
      setFlash(
        `Historique agent vidé pour ${selectedUser.email} (${res.deletedMessages} message(s)).`
      );
      setConfirmUserClear(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de la purge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <h1>Tableau de bord</h1>
      </header>
      <div className="content">
        {error ? <div className="error-banner">{error}</div> : null}
        {flash ? (
          <div
            className="error-banner"
            style={{ background: "#ecfdf5", borderColor: "#a7f3d0", color: "#047857" }}
          >
            {flash}
          </div>
        ) : null}
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

            <div className="detail-card" style={{ marginBottom: 20 }}>
              <h3>Maintenance — historique agent par compte</h3>
              <p className="actions-help">
                Choisis un compte pour vider uniquement son chat Klanvio (tous ses fils). Ne touche
                pas aux messages WhatsApp ni aux campagnes. Pour les mémoires de campagne :
                Comptes → Gestion compte.
              </p>
              <div
                className="actions-row"
                style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}
              >
                <input
                  type="search"
                  placeholder="Filtrer email ou n°…"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  style={{ minWidth: 180, maxWidth: 240 }}
                />
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  style={{ minWidth: 260, maxWidth: 420 }}
                >
                  <option value="">Sélectionner un compte…</option>
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      #{u.id} — {u.email}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-warn"
                  type="button"
                  disabled={busy || !selectedUserId}
                  onClick={() => setConfirmUserClear(true)}
                >
                  Vider l&apos;historique de ce compte
                </button>
                {selectedUser ? (
                  <Link
                    to={`/users/${selectedUser.id}/account-management`}
                    className="btn btn-ghost"
                    style={{ textDecoration: "none" }}
                  >
                    Gestion compte
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="detail-card" style={{ marginBottom: 20, opacity: 0.95 }}>
              <h3>Maintenance globale (tous les comptes)</h3>
              <p className="actions-help">
                Dernier recours : vide le chat agent de <strong>tous</strong> les comptes d&apos;un
                coup.
              </p>
              <div className="actions-row">
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmGlobalClear(true)}
                >
                  Vider l&apos;historique de tous les comptes
                </button>
              </div>
            </div>

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
                        <th></th>
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
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 12, padding: "4px 8px" }}
                              disabled={busy}
                              onClick={() => {
                                setUserOptions((prev) =>
                                  prev.some((x) => x.id === u.id)
                                    ? prev
                                    : [...prev, { id: u.id, email: u.email }]
                                );
                                setSelectedUserId(String(u.id));
                                setUserQuery("");
                                setConfirmUserClear(true);
                              }}
                            >
                              Vider chat
                            </button>
                          </td>
                        </tr>
                      ))}
                      {data.topOutbound.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ color: "var(--text-500)" }}>
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
                        <th></th>
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
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 12, padding: "4px 8px" }}
                              disabled={busy}
                              onClick={() => {
                                setUserOptions((prev) =>
                                  prev.some((x) => x.id === u.id)
                                    ? prev
                                    : [...prev, { id: u.id, email: u.email }]
                                );
                                setSelectedUserId(String(u.id));
                                setUserQuery("");
                                setConfirmUserClear(true);
                              }}
                            >
                              Vider chat
                            </button>
                          </td>
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

      {confirmUserClear && selectedUser ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog">
            <h3>Vider l&apos;historique de ce compte ?</h3>
            <p>
              Chat agent de <strong>{selectedUser.email}</strong> (#{selectedUser.id}) — tous les
              fils. Irreversible. WhatsApp et campagnes restent.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => setConfirmUserClear(false)}
              >
                Annuler
              </button>
              <button
                className="btn btn-warn"
                type="button"
                disabled={busy}
                onClick={() => void clearSelectedUserHistory()}
              >
                {busy ? "Suppression…" : "Confirmer pour ce compte"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmGlobalClear ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog">
            <h3>Vider l&apos;historique de tous les comptes ?</h3>
            <p>
              Tous les messages du chat agent (tous les fils, tous les utilisateurs) seront
              supprimés. Action irreversible. Les campagnes et messages WhatsApp restent.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => setConfirmGlobalClear(false)}
              >
                Annuler
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy}
                onClick={() => void clearAllAgentHistory()}
              >
                {busy ? "Suppression…" : "Confirmer la purge globale"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
