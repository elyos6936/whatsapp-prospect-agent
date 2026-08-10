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
  trialStartedAt?: string | null;
  subscriptionPeriodEnd?: string | null;
  deletedAt: string | null;
};

type DetailLite = {
  user: UserSnapshot;
};

type PaymentRow = {
  id: number;
  planId: string;
  billingPeriod: string;
  amountEur: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

export function UserSubscriptionActionsPage() {
  const { id } = useParams();
  const userId = Number(id);
  const [detail, setDetail] = useState<DetailLite | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [status, setStatus] = useState("trial");
  const [level, setLevel] = useState("1");
  const [totalSent, setTotalSent] = useState("0");
  const [periodEnd, setPeriodEnd] = useState("");
  const [extendDays, setExtendDays] = useState("30");

  const reload = useCallback(() => {
    if (!Number.isFinite(userId)) return;
    api<DetailLite>(`/api/admin/users/${userId}`)
      .then((d) => {
        setDetail(d);
        setStatus(d.user.subscriptionStatus);
        setLevel(String(d.user.outreachLevel));
        setTotalSent(String(d.user.totalMessagesSent));
        setPeriodEnd(
          d.user.subscriptionPeriodEnd
            ? new Date(d.user.subscriptionPeriodEnd).toISOString().slice(0, 10)
            : ""
        );
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"));
    api<{ payments: PaymentRow[] }>(`/api/admin/users/${userId}/billing-payments`)
      .then((r) => setPayments(r.payments || []))
      .catch(() => setPayments([]));
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
          ...(periodEnd
            ? { subscriptionPeriodEnd: new Date(periodEnd).toISOString() }
            : {}),
        }),
      })
    );
  }

  function onExtend(e: FormEvent) {
    e.preventDefault();
    void runAction(`Prolonge de ${extendDays} jours`, () =>
      api(`/api/admin/users/${userId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "active",
          extendDays: Number(extendDays),
        }),
      })
    );
  }

  function onResetTrial() {
    void runAction("Essai reinitialise", () =>
      api(`/api/admin/users/${userId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({ resetTrial: true }),
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
            <div className="tabs">
              <Link to={`/users/${userId}`} className="tab-link">
                Compte
              </Link>
              <Link to={`/users/${userId}?tab=campagnes`} className="tab-link">
                Campagnes
              </Link>
              <Link to={`/users/${userId}/subscription`} className="tab-link active">
                Abonnement
              </Link>
              <Link to={`/users/${userId}/account-management`} className="tab-link">
                Gestion compte
              </Link>
            </div>
            <div className="grid-2">
              <form className="detail-card" onSubmit={onSub}>
                <h3>Statut abonnement</h3>
                <p className="actions-help">
                  Gerez l&apos;acces commercial : actif, essai, expire + date de fin.
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
                  <label htmlFor="pe">Fin de periode (YYYY-MM-DD)</label>
                  <input
                    id="pe"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
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
                <p className="actions-help">
                  Essai utilise : {detail.user.trialConversationsUsed}/50
                  {detail.user.trialStartedAt
                    ? ` · demarre ${new Date(detail.user.trialStartedAt).toLocaleDateString("fr-FR")}`
                    : ""}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" type="submit" disabled={busy || !!detail.user.deletedAt}>
                    Enregistrer
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !!detail.user.deletedAt}
                    onClick={onResetTrial}
                  >
                    Reset essai
                  </button>
                </div>
              </form>

              <form className="detail-card" onSubmit={onExtend}>
                <h3>Prolonger</h3>
                <p className="actions-help">Ajoute des jours a la periode (passe en actif).</p>
                <div className="field">
                  <label htmlFor="ex">Jours a ajouter</label>
                  <input
                    id="ex"
                    type="number"
                    min={1}
                    value={extendDays}
                    onChange={(e) => setExtendDays(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" disabled={busy} onClick={() => setExtendDays("30")}>
                    +30j
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setExtendDays("365")}>
                    +365j
                  </button>
                </div>
                <button className="btn btn-primary" type="submit" disabled={busy || !!detail.user.deletedAt} style={{ marginTop: 12 }}>
                  Prolonger
                </button>
              </form>

              <form className="detail-card" onSubmit={onOutreach}>
                <h3>Compteurs et niveau</h3>
                <p className="actions-help">Ajustez manuellement les compteurs operations.</p>
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

              <div className="detail-card">
                <h3>Paiements</h3>
                <p className="actions-help">Historique Money Fusion (lecture seule).</p>
                {payments.length === 0 ? (
                  <p className="actions-help">Aucun paiement enregistre.</p>
                ) : (
                  <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Montant</th>
                        <th>Periode</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td>{new Date(p.createdAt).toLocaleString("fr-FR")}</td>
                          <td>{p.amountEur}€</td>
                          <td>
                            {p.planId}/{p.billingPeriod}
                          </td>
                          <td>{p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
