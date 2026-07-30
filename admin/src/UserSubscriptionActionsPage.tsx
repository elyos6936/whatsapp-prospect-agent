import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "./api";
import { StatusBadge } from "./UsersPage";

type UserSnapshot = {
  id: number;
  email: string;
  subscriptionStatus: string;
  outreachLevel: number;
  totalMessagesSent: number;
  trialConversationsUsed: number;
  deletedAt: string | null;
};

type DetailLite = {
  user: UserSnapshot;
};

export function UserSubscriptionActionsPage() {
  const { id } = useParams();
  const userId = Number(id);
  const [detail, setDetail] = useState<DetailLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [status, setStatus] = useState("trial");
  const [level, setLevel] = useState("1");
  const [totalSent, setTotalSent] = useState("0");

  const reload = useCallback(() => {
    if (!Number.isFinite(userId)) return;
    api<DetailLite>(`/api/admin/users/${userId}`)
      .then((d) => {
        setDetail(d);
        setStatus(d.user.subscriptionStatus);
        setLevel(String(d.user.outreachLevel));
        setTotalSent(String(d.user.totalMessagesSent));
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"));
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function runAction(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      setFlash(label);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action échouée");
    } finally {
      setBusy(false);
    }
  }

  function onSub(e: FormEvent) {
    e.preventDefault();
    void runAction("Abonnement mis a jour", () =>
      api(`/api/admin/users/${userId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          outreachLevel: Number(level),
        }),
      })
    );
  }

  function onOutreach(e: FormEvent) {
    e.preventDefault();
    void runAction("Compteurs mis a jour", () =>
      api(`/api/admin/users/${userId}/outreach`, {
        method: "PATCH",
        body: JSON.stringify({
          outreachLevel: Number(level),
          totalMessagesSent: Number(totalSent),
        }),
      })
    );
  }

  if (!Number.isFinite(userId)) {
    return <div className="content error-inline">Identifiant invalide</div>;
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div style={{ color: "var(--text-500)", fontSize: 12, marginBottom: 2 }}>
            <Link to="/users">Comptes</Link> / <Link to={`/users/${userId}`}>#{userId}</Link> / Abonnement
          </div>
          <h1>{detail?.user.email ?? `Compte #${userId}`}</h1>
        </div>
        {detail ? <StatusBadge status={detail.user.subscriptionStatus} /> : null}
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
        {!detail && !error ? <div className="loading">Chargement...</div> : null}
        {detail ? (
          <>
            <div className="actions-page-nav">
              <Link to={`/users/${userId}`} className="btn btn-ghost">
                Retour fiche compte
              </Link>
              <Link to={`/users/${userId}/account-management`} className="btn btn-ghost">
                Aller a gestion compte
              </Link>
            </div>
            <div className="grid-2">
              <form className="detail-card" onSubmit={onSub}>
                <h3>Statut abonnement</h3>
                <p className="actions-help">
                  Gerez l'acces commercial du compte: actif, essai, expire.
                </p>
                <div className="field">
                  <label htmlFor="st">Statut</label>
                  <select id="st" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="active">Actif</option>
                    <option value="trial">Essai</option>
                    <option value="expired">Expire</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="lv">Niveau outreach</label>
                  <select id="lv" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        Niveau {n}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy || !!detail.user.deletedAt}>
                  Enregistrer
                </button>
              </form>

              <form className="detail-card" onSubmit={onOutreach}>
                <h3>Compteurs et niveau</h3>
                <p className="actions-help">
                  Ajustez manuellement les compteurs operations du compte.
                </p>
                <div className="field">
                  <label htmlFor="tot">Messages envoyes (lifetime)</label>
                  <input
                    id="tot"
                    type="number"
                    min={0}
                    value={totalSent}
                    onChange={(e) => setTotalSent(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="lvl2">Niveau outreach</label>
                  <select id="lvl2" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        Niveau {n}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy || !!detail.user.deletedAt}>
                  Mettre a jour
                </button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
