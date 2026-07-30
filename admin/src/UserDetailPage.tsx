import { useCallback, useEffect, useState } from "react";
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

type Tab = "compte" | "campagnes";

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
        {!detail && !error ? <div className="loading">Chargement…</div> : null}
        {detail ? (
          <>
            <div className="tabs">
              {(
                [
                  ["compte", "Compte"],
                  ["campagnes", "Campagnes"],
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
          </>
        ) : null}
      </div>
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
      <div className="detail-card">
        <h3>Actions admin</h3>
        <p className="actions-help">
          Les actions sont maintenant separees en deux pages pour plus de clarte.
        </p>
        <div className="actions-row">
          <Link className="btn btn-primary" to={`/users/${u.id}/subscription`}>
            Ouvrir Abonnement
          </Link>
          <Link className="btn btn-ghost" to={`/users/${u.id}/account-management`}>
            Ouvrir Gestion compte
          </Link>
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
