import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "./api";
import { StatusBadge } from "./UsersPage";

type UserSnapshot = {
  id: number;
  email: string;
  accountStatus: "active" | "suspended";
  deletedAt: string | null;
};

type DetailLite = {
  user: UserSnapshot;
  autoReply: boolean;
};

export function UserAccountManagementPage() {
  const { id } = useParams();
  const userId = Number(id);
  const [detail, setDetail] = useState<DetailLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    run: () => Promise<void>;
  } | null>(null);

  const reload = useCallback(() => {
    if (!Number.isFinite(userId)) return;
    api<DetailLite>(`/api/admin/users/${userId}`)
      .then((d) => {
        setDetail(d);
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
      setError(err instanceof ApiError ? err.message : "Action echouee");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  if (!Number.isFinite(userId)) {
    return <div className="content error-inline">Identifiant invalide</div>;
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div style={{ color: "var(--text-500)", fontSize: 12, marginBottom: 2 }}>
            <Link to="/users">Comptes</Link> / <Link to={`/users/${userId}`}>#{userId}</Link> / Gestion compte
          </div>
          <h1>{detail?.user.email ?? `Compte #${userId}`}</h1>
        </div>
        {detail ? <StatusBadge status={detail.user.accountStatus === "suspended" ? "expired" : "active"} /> : null}
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
              <Link to={`/users/${userId}/subscription`} className="btn btn-ghost">
                Aller a abonnement
              </Link>
            </div>
            <div className="grid-2">
              <div className="detail-card">
                <h3>Controle des envois</h3>
                <p className="actions-help">
                  Coupez ou reprenez l'activite automatique sans modifier l'abonnement.
                </p>
                <div className="actions-row">
                  <button
                    className="btn btn-warn"
                    type="button"
                    disabled={busy || Boolean(detail.user.deletedAt)}
                    onClick={() =>
                      setConfirm({
                        title: "Mettre les campagnes en pause",
                        body: "Toutes les campagnes actives de ce compte seront mises en pause.",
                        run: async () =>
                          runAction("Campagnes mises en pause", () =>
                            api(`/api/admin/users/${userId}/pause-automations`, { method: "POST" })
                          ),
                      })
                    }
                  >
                    Pause des campagnes
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busy || Boolean(detail.user.deletedAt)}
                    onClick={() =>
                      setConfirm({
                        title: "Couper tous les envois",
                        body: "Mise en pause des campagnes, annulation des envois en attente, et reponses auto desactivees.",
                        run: async () =>
                          runAction("Tous les envois coupes", () =>
                            api(`/api/admin/users/${userId}/stop-outbound`, { method: "POST" })
                          ),
                      })
                    }
                  >
                    Couper tous les envois
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy || Boolean(detail.user.deletedAt)}
                    onClick={() =>
                      setConfirm({
                        title: detail.autoReply ? "Couper les reponses auto" : "Activer les reponses auto",
                        body: detail.autoReply
                          ? "Le compte ne repondra plus automatiquement."
                          : "Le compte pourra repondre automatiquement.",
                        run: async () =>
                          runAction("Reponses auto mises a jour", () =>
                            api(`/api/admin/users/${userId}/set-auto-reply`, {
                              method: "POST",
                              body: JSON.stringify({ enabled: !detail.autoReply }),
                            })
                          ),
                      })
                    }
                  >
                    {detail.autoReply ? "Desactiver reponses auto" : "Activer reponses auto"}
                  </button>
                </div>
              </div>

              <div className="detail-card">
                <h3>Etat du compte</h3>
                <p className="actions-help">
                  Suspendre est reversible. Soft-delete garde une archive inutilisable.
                </p>
                <div className="actions-row">
                  {detail.user.deletedAt ? (
                    <span style={{ color: "var(--text-500)", fontSize: 13 }}>Compte soft-supprime.</span>
                  ) : detail.user.accountStatus === "suspended" ? (
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: "Reactiver le compte",
                          body: "Le compte pourra a nouveau se connecter. Les campagnes restent en pause jusqu'a reprise manuelle.",
                          run: async () =>
                            runAction("Compte reactive", () =>
                              api(`/api/admin/users/${userId}/unsuspend`, { method: "POST" })
                            ),
                        })
                      }
                    >
                      Reactiver
                    </button>
                  ) : (
                    <button
                      className="btn btn-warn"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: "Suspendre le compte",
                          body: "Login client bloque, campagnes en pause, file annulee, reponses auto coupees.",
                          run: async () =>
                            runAction("Compte suspendu", () =>
                              api(`/api/admin/users/${userId}/suspend`, {
                                method: "POST",
                                body: JSON.stringify({ reason: "Suspendu par admin" }),
                              })
                            ),
                        })
                      }
                    >
                      Suspendre
                    </button>
                  )}
                  {!detail.user.deletedAt ? (
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: "Soft-supprimer le compte",
                          body: "Anonymise l'email, coupe toute activite, bloque la connexion. Pas de suppression physique.",
                          run: async () =>
                            runAction("Compte soft-supprime", () =>
                              api(`/api/admin/users/${userId}/soft-delete`, { method: "POST" })
                            ),
                        })
                      }
                    >
                      Soft-supprimer
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="detail-card" style={{ borderColor: "#fecaca", background: "#fffafa" }}>
                <h3>Suppression definitive</h3>
                <p className="actions-help">
                  Efface reellement le compte et ses donnees liees. Action irreversible.
                </p>
                <div className="actions-row">
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: "Supprimer definitivement le compte",
                        body: "Suppression physique irreversible du compte et des donnees liees.",
                        run: async () =>
                          runAction("Compte supprime definitivement", () =>
                            api(`/api/admin/users/${userId}`, { method: "DELETE" })
                          ),
                      })
                    }
                  >
                    Supprimer definitivement
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
      {confirm ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog">
            <h3>{confirm.title}</h3>
            <p>{confirm.body}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirm(null)}>
                Annuler
              </button>
              <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void confirm.run()}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
