import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActivityChart, type ActivityPoint } from "./ActivityChart";
import { api, ApiError } from "./api";
import { StatusBadge } from "./UsersPage";

type Detail = {
  user: {
    id: number;
    email: string;
    name: string;
    onboardingCompleted: boolean;
    business: { ownerName: string; offer: string; price: string };
    subscriptionStatus: string;
    outreachLevel: number;
    totalMessagesSent: number;
    trialConversationsUsed: number;
    dailyCaps: { inbound: number; outbound: number };
    accountStatus: "active" | "suspended";
    suspendedAt: string | null;
    suspendedReason: string | null;
    deletedAt: string | null;
    createdAt: string;
  };
  messages: {
    total: number;
    entrant: number;
    sortant: number;
    envoyesAujourdhui: number;
    recusAujourdhui: number;
    derniers7j: number;
  };
  campaigns: Array<{
    id: number;
    name: string;
    type: string;
    status: string;
    stats: Record<string, unknown>;
  }>;
  whatsapp: { connected: boolean; message: string };
  autoReply: boolean;
  activitySeries: ActivityPoint[];
};

type Tab = "compte" | "campagnes" | "actions";

const CAMPAGNE_STATUT: Record<string, string> = {
  active: "Active",
  draft: "Brouillon",
  paused: "En pause",
  completed: "Terminée",
  failed: "Échouée",
};

const CAMPAGNE_TYPE: Record<string, string> = {
  group_prospect: "Prospection groupe",
  contact_prospect: "Prospection contacts",
  keyword_sales: "Closing entrant",
};

export function UserDetailPage() {
  const { id } = useParams();
  const userId = Number(id);
  const [tab, setTab] = useState<Tab>("compte");
  const [detail, setDetail] = useState<Detail | null>(null);
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
    api<Detail>(`/api/admin/users/${userId}`)
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
      setError(err instanceof ApiError ? err.message : "Action échouée");
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
            <Link to="/users">Comptes</Link> / #{userId}
          </div>
          <h1>{detail?.user.email ?? `Compte #${userId}`}</h1>
        </div>
        {detail ? <StatusBadge status={detail.user.subscriptionStatus} /> : null}
        {detail?.user.deletedAt ? (
          <span className="badge badge-expired">Supprimé</span>
        ) : detail?.user.accountStatus === "suspended" ? (
          <span className="badge badge-expired">Suspendu</span>
        ) : null}
      </header>
      <div className="content">
        {error ? <div className="error-banner">{error}</div> : null}
        {flash ? (
          <div
            className="error-banner"
            style={{
              background: "#ecfdf5",
              borderColor: "#a7f3d0",
              color: "#047857",
            }}
          >
            {flash}
          </div>
        ) : null}
        {!detail && !error ? <div className="loading">Chargement…</div> : null}
        {detail ? (
          <>
            <div className="tabs">
              {(
                [
                  ["compte", "Compte"],
                  ["campagnes", "Campagnes"],
                  ["actions", "Actions"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={tab === key ? "active" : ""}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "compte" ? <CompteTab detail={detail} /> : null}
            {tab === "campagnes" ? <CampagnesTab detail={detail} /> : null}
            {tab === "actions" ? (
              <ActionsTab
                detail={detail}
                busy={busy}
                onConfirm={(c) => {
                  if (!c) {
                    setConfirm(null);
                    return;
                  }
                  setConfirm({
                    title: c.title,
                    body: c.body,
                    run: async () => {
                      await runAction(c.title, c.run);
                    },
                  });
                }}
                onSaveSubscription={async (body) => {
                  await runAction("Abonnement mis à jour", () =>
                    api(`/api/admin/users/${userId}/subscription`, {
                      method: "PATCH",
                      body: JSON.stringify(body),
                    })
                  );
                }}
                onSaveOutreach={async (body) => {
                  await runAction("Niveau mis à jour", () =>
                    api(`/api/admin/users/${userId}/outreach`, {
                      method: "PATCH",
                      body: JSON.stringify(body),
                    })
                  );
                }}
              />
            ) : null}
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
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy}
                onClick={() => void confirm.run()}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CompteTab({ detail }: { detail: Detail }) {
  const u = detail.user;
  return (
    <>
      <ActivityChart
        data={detail.activitySeries ?? []}
        title="Progression messages"
        subtitle={`30 derniers jours — niveau actuel ${u.outreachLevel}/5 · ${u.totalMessagesSent} envoyés lifetime`}
      />
      <div className="grid-2">
      <div className="detail-card">
        <h3>Profil</h3>
        <div className="kv">
          <div className="k">Email</div>
          <div className="v">{u.email}</div>
          <div className="k">Nom</div>
          <div className="v">{u.name || "—"}</div>
          <div className="k">Onboarding</div>
          <div className="v">{u.onboardingCompleted ? "Terminé" : "En cours"}</div>
          <div className="k">Inscription</div>
          <div className="v">{formatDate(u.createdAt)}</div>
          <div className="k">Compte</div>
          <div className="v">
            {u.deletedAt
              ? "Soft-supprimé"
              : u.accountStatus === "suspended"
                ? "Suspendu"
                : "Actif"}
          </div>
          {u.suspendedReason ? (
            <>
              <div className="k">Motif suspension</div>
              <div className="v">{u.suspendedReason}</div>
            </>
          ) : null}
        </div>
      </div>
      <div className="detail-card">
        <h3>Activité business</h3>
        <div className="kv">
          <div className="k">Propriétaire</div>
          <div className="v">{u.business.ownerName || "—"}</div>
          <div className="k">Offre</div>
          <div className="v">{u.business.offer || "—"}</div>
          <div className="k">Prix</div>
          <div className="v">{u.business.price || "—"}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>Abonnement & niveau</h3>
        <div className="kv">
          <div className="k">Statut</div>
          <div className="v">
            <StatusBadge status={u.subscriptionStatus} />
          </div>
          <div className="k">Niveau</div>
          <div className="v">{u.outreachLevel} / 5</div>
          <div className="k">Messages envoyés</div>
          <div className="v">{u.totalMessagesSent}</div>
          <div className="k">Essai utilisé</div>
          <div className="v">{u.trialConversationsUsed}</div>
          <div className="k">Plafond jour sortant</div>
          <div className="v">{u.dailyCaps.outbound}</div>
          <div className="k">Plafond jour entrant</div>
          <div className="v">{u.dailyCaps.inbound}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>WhatsApp</h3>
        <div className="kv">
          <div className="k">Connexion</div>
          <div className="v">
            <span className={`badge ${detail.whatsapp.connected ? "badge-ok" : "badge-off"}`}>
              {detail.whatsapp.connected ? "Connecté" : "Déconnecté"}
            </span>
          </div>
          <div className="k">Détail</div>
          <div className="v">{detail.whatsapp.message}</div>
          <div className="k">Réponses auto</div>
          <div className="v">{detail.autoReply ? "Activées" : "Désactivées"}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>Volumes (compteurs)</h3>
        <div className="kv">
          <div className="k">Envoyés (total)</div>
          <div className="v">{detail.messages.sortant}</div>
          <div className="k">Reçus (total)</div>
          <div className="v">{detail.messages.entrant}</div>
          <div className="k">Envoyés aujourd’hui</div>
          <div className="v">{detail.messages.envoyesAujourdhui}</div>
          <div className="k">Reçus aujourd’hui</div>
          <div className="v">{detail.messages.recusAujourdhui}</div>
          <div className="k">Activité 7 derniers jours</div>
          <div className="v">{detail.messages.derniers7j}</div>
        </div>
      </div>
    </div>
    </>
  );
}

function CampagnesTab({ detail }: { detail: Detail }) {
  if (!detail.campaigns.length) return <div className="empty">Aucune campagne</div>;
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>N°</th>
              <th>Nom</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Contactés</th>
              <th>Réponses</th>
              <th>Intéressés</th>
            </tr>
          </thead>
          <tbody>
            {detail.campaigns.map((c) => (
              <tr key={c.id}>
                <td>#{c.id}</td>
                <td>{c.name}</td>
                <td>{CAMPAGNE_TYPE[c.type] ?? c.type}</td>
                <td>{CAMPAGNE_STATUT[c.status] ?? c.status}</td>
                <td>{num(c.stats.contacted)}</td>
                <td>{num(c.stats.replied)}</td>
                <td>{num(c.stats.interested)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionsTab({
  detail,
  busy,
  onConfirm,
  onSaveSubscription,
  onSaveOutreach,
}: {
  detail: Detail;
  busy: boolean;
  onConfirm: (c: { title: string; body: string; run: () => Promise<unknown> } | null) => void;
  onSaveSubscription: (body: Record<string, unknown>) => Promise<void>;
  onSaveOutreach: (body: Record<string, unknown>) => Promise<void>;
}) {
  const userId = detail.user.id;
  const [status, setStatus] = useState(detail.user.subscriptionStatus);
  const [level, setLevel] = useState(String(detail.user.outreachLevel));
  const [totalSent, setTotalSent] = useState(String(detail.user.totalMessagesSent));

  useEffect(() => {
    setStatus(detail.user.subscriptionStatus);
    setLevel(String(detail.user.outreachLevel));
    setTotalSent(String(detail.user.totalMessagesSent));
  }, [detail]);

  function onSub(e: FormEvent) {
    e.preventDefault();
    void onSaveSubscription({
      status,
      outreachLevel: Number(level),
    });
  }

  function onOut(e: FormEvent) {
    e.preventDefault();
    void onSaveOutreach({
      outreachLevel: Number(level),
      totalMessagesSent: Number(totalSent),
    });
  }

  return (
    <div className="grid-2">
      <form className="detail-card" onSubmit={onSub}>
        <h3>Abonnement</h3>
        <div className="field">
          <label htmlFor="st">Statut</label>
          <select id="st" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Actif</option>
            <option value="trial">Essai</option>
            <option value="expired">Expiré</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="lv">Niveau</label>
          <select id="lv" value={level} onChange={(e) => setLevel(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                Niveau {n}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Enregistrer
        </button>
      </form>

      <form className="detail-card" onSubmit={onOut}>
        <h3>Compteur lifetime</h3>
        <div className="field">
          <label htmlFor="tot">Messages envoyés (total)</label>
          <input
            id="tot"
            type="number"
            min={0}
            value={totalSent}
            onChange={(e) => setTotalSent(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Mettre à jour
        </button>
      </form>

      <div className="detail-card">
        <h3>Actions de sécurité</h3>
        <p style={{ color: "var(--text-500)", fontSize: 13, marginTop: 0 }}>
          Ces actions bloquent l’activité sortante du compte. Confirmation obligatoire.
        </p>
        <div className="actions-row">
          <button
            className="btn btn-warn"
            type="button"
            disabled={busy || Boolean(detail.user.deletedAt)}
            onClick={() =>
              onConfirm({
                title: "Mettre les campagnes en pause",
                body: "Toutes les campagnes actives de ce compte seront mises en pause.",
                run: () =>
                  api(`/api/admin/users/${userId}/pause-automations`, { method: "POST" }),
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
              onConfirm({
                title: "Couper tous les envois",
                body: "Mise en pause des campagnes, annulation des envois en attente, et réponses auto désactivées.",
                run: () => api(`/api/admin/users/${userId}/stop-outbound`, { method: "POST" }),
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
              onConfirm({
                title: detail.autoReply ? "Couper les réponses auto" : "Activer les réponses auto",
                body: detail.autoReply
                  ? "Le compte ne répondra plus automatiquement."
                  : "Le compte pourra répondre automatiquement.",
                run: () =>
                  api(`/api/admin/users/${userId}/set-auto-reply`, {
                    method: "POST",
                    body: JSON.stringify({ enabled: !detail.autoReply }),
                  }),
              })
            }
          >
            {detail.autoReply ? "Désactiver réponses auto" : "Activer réponses auto"}
          </button>
        </div>
      </div>

      <div className="detail-card">
        <h3>Compte (suspendre / supprimer)</h3>
        <p style={{ color: "var(--text-500)", fontSize: 13, marginTop: 0 }}>
          Suspendre bloque la connexion client et coupe l’activité. Supprimer = soft-delete
          (email anonymisé), irréversible depuis ce panneau.
        </p>
        <div className="actions-row">
          {detail.user.deletedAt ? (
            <span style={{ color: "var(--text-500)", fontSize: 13 }}>
              Compte soft-supprimé le {formatDate(detail.user.deletedAt)}.
            </span>
          ) : detail.user.accountStatus === "suspended" ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={() =>
                onConfirm({
                  title: "Réactiver le compte",
                  body: "Le compte pourra à nouveau se connecter. Les campagnes restent en pause jusqu’à reprise manuelle.",
                  run: () => api(`/api/admin/users/${userId}/unsuspend`, { method: "POST" }),
                })
              }
            >
              Réactiver (unsuspend)
            </button>
          ) : (
            <button
              className="btn btn-warn"
              type="button"
              disabled={busy}
              onClick={() =>
                onConfirm({
                  title: "Suspendre le compte",
                  body: "Login client bloqué, campagnes en pause, file annulée, réponses auto coupées. Réversible.",
                  run: () =>
                    api(`/api/admin/users/${userId}/suspend`, {
                      method: "POST",
                      body: JSON.stringify({ reason: "Suspendu par admin" }),
                    }),
                })
              }
            >
              Suspendre
            </button>
          )}
          {!detail.user.deletedAt ? (
            <button
              className="btn btn-danger"
              type="button"
              disabled={busy}
              onClick={() =>
                onConfirm({
                  title: "Soft-supprimer le compte",
                  body: "Anonymise l’email, coupe toute activité, bloque la connexion. Pas de suppression physique des données.",
                  run: () => api(`/api/admin/users/${userId}/soft-delete`, { method: "POST" }),
                })
              }
            >
              Soft-supprimer
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function num(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v;
  return "—";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}
