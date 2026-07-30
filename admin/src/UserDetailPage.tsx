import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
    createdAt: string;
  };
  messages: {
    total: number;
    entrant: number;
    sortant: number;
    last_24h: number;
    last_7d: number;
  };
  campaigns: Array<{
    id: number;
    name: string;
    type: string;
    status: string;
    stats: Record<string, unknown>;
  }>;
  queue: { pending: number; processing: number; failed: number };
  recentLogs: Array<{
    id: number;
    automationId: number;
    level: string;
    message: string;
    createdAt: string;
  }>;
  whatsapp: { connected: boolean; message: string };
  autoReply: boolean;
};

type Tab = "compte" | "campagnes" | "messages" | "file" | "actions";

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
    return <div className="content error-inline">ID invalide</div>;
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 2 }}>
            <Link to="/users">Utilisateurs</Link> / #{userId}
          </div>
          <h1>{detail?.user.email ?? `User #${userId}`}</h1>
        </div>
        {detail ? <StatusBadge status={detail.user.subscriptionStatus} /> : null}
      </header>
      <div className="content">
        {error ? <div className="error-banner">{error}</div> : null}
        {flash ? (
          <div
            className="error-banner"
            style={{
              background: "rgba(34,197,94,0.12)",
              borderColor: "rgba(34,197,94,0.35)",
              color: "#86efac",
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
                  ["messages", "Messages"],
                  ["file", "File"],
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
            {tab === "messages" ? <MessagesTab userId={userId} /> : null}
            {tab === "file" ? <FileTab detail={detail} /> : null}
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
                  await runAction("Outreach mis à jour", () =>
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
        <div className="modal-backdrop">
          <div className="modal">
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
    <div className="grid-2">
      <div className="detail-card">
        <h3>Profil</h3>
        <div className="kv">
          <div className="k">Email</div>
          <div className="v">{u.email}</div>
          <div className="k">Nom</div>
          <div className="v">{u.name || "—"}</div>
          <div className="k">Onboarding</div>
          <div className="v">{u.onboardingCompleted ? "oui" : "non"}</div>
          <div className="k">Créé</div>
          <div className="v">{formatDate(u.createdAt)}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>Business</h3>
        <div className="kv">
          <div className="k">Proprio</div>
          <div className="v">{u.business.ownerName || "—"}</div>
          <div className="k">Offre</div>
          <div className="v">{u.business.offer || "—"}</div>
          <div className="k">Prix</div>
          <div className="v">{u.business.price || "—"}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>Niveau & quotas</h3>
        <div className="kv">
          <div className="k">Statut</div>
          <div className="v">
            <StatusBadge status={u.subscriptionStatus} />
          </div>
          <div className="k">Niveau</div>
          <div className="v">{u.outreachLevel} / 5</div>
          <div className="k">Msgs life</div>
          <div className="v">{u.totalMessagesSent}</div>
          <div className="k">Essai utilisé</div>
          <div className="v">{u.trialConversationsUsed}</div>
          <div className="k">Cap jour out</div>
          <div className="v">{u.dailyCaps.outbound}</div>
          <div className="k">Cap jour in</div>
          <div className="v">{u.dailyCaps.inbound}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>WhatsApp & auto-reply</h3>
        <div className="kv">
          <div className="k">WA</div>
          <div className="v">
            <span className={`badge ${detail.whatsapp.connected ? "badge-ok" : "badge-off"}`}>
              {detail.whatsapp.connected ? "connecté" : "déconnecté"}
            </span>
          </div>
          <div className="k">Détail</div>
          <div className="v">{detail.whatsapp.message}</div>
          <div className="k">Auto-reply</div>
          <div className="v">{detail.autoReply ? "ON" : "OFF"}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>Messages</h3>
        <div className="kv">
          <div className="k">Total</div>
          <div className="v">{detail.messages.total}</div>
          <div className="k">Sortants</div>
          <div className="v">{detail.messages.sortant}</div>
          <div className="k">Entrants</div>
          <div className="v">{detail.messages.entrant}</div>
          <div className="k">24h</div>
          <div className="v">{detail.messages.last_24h}</div>
          <div className="k">7j</div>
          <div className="v">{detail.messages.last_7d}</div>
        </div>
      </div>
    </div>
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
              <th>ID</th>
              <th>Nom</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Contacted</th>
              <th>Replied</th>
              <th>Conv.</th>
            </tr>
          </thead>
          <tbody>
            {detail.campaigns.map((c) => (
              <tr key={c.id}>
                <td>#{c.id}</td>
                <td>{c.name}</td>
                <td>{c.type}</td>
                <td>
                  <span className="badge badge-muted">{c.status}</span>
                </td>
                <td>{num(c.stats.contacted)}</td>
                <td>{num(c.stats.replied)}</td>
                <td>{num(c.stats.conversions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MessagesTab({ userId }: { userId: number }) {
  const [items, setItems] = useState<
    Array<{
      id: number;
      contactPhone: string;
      direction: string;
      body: string;
      senderName: string | null;
      createdAt: string;
    }>
  >([]);
  const [direction, setDirection] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "40" });
    if (direction) params.set("direction", direction);
    api<{ items: typeof items }>(`/api/admin/users/${userId}/messages?${params}`)
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur"));
  }, [userId, direction]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Historique WhatsApp</h2>
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">Tous</option>
          <option value="sortant">Sortants</option>
          <option value="entrant">Entrants</option>
        </select>
      </div>
      {error ? <div className="error-inline">{error}</div> : null}
      <div className="msg-list" style={{ padding: 12 }}>
        {items.length === 0 ? <div className="empty">Aucun message</div> : null}
        {items.map((m) => (
          <div className="msg-item" key={m.id}>
            <div className="meta">
              <span className="badge badge-muted">{m.direction}</span>
              <span>{m.contactPhone}</span>
              <span>{m.senderName || ""}</span>
              <span>{formatDate(m.createdAt)}</span>
            </div>
            <div className="body">{m.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileTab({ detail }: { detail: Detail }) {
  return (
    <div className="grid-2">
      <div className="detail-card">
        <h3>Send queue</h3>
        <div className="kv">
          <div className="k">Pending</div>
          <div className="v">{detail.queue.pending}</div>
          <div className="k">Processing</div>
          <div className="v">{detail.queue.processing}</div>
          <div className="k">Failed</div>
          <div className="v">{detail.queue.failed}</div>
        </div>
      </div>
      <div className="detail-card">
        <h3>Derniers logs auto</h3>
        <div className="msg-list">
          {detail.recentLogs.length === 0 ? <div className="empty">Aucun log</div> : null}
          {detail.recentLogs.slice(0, 12).map((l) => (
            <div className="msg-item" key={l.id}>
              <div className="meta">
                <span>{l.level}</span>
                <span>camp. #{l.automationId}</span>
                <span>{formatDate(l.createdAt)}</span>
              </div>
              <div className="body">{l.message}</div>
            </div>
          ))}
        </div>
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
  onConfirm: (
    c: { title: string; body: string; run: () => Promise<unknown> } | null
  ) => void;
  onSaveSubscription: (body: Record<string, unknown>) => Promise<void>;
  onSaveOutreach: (body: Record<string, unknown>) => Promise<void>;
}) {
  const u = detail.user;
  const [status, setStatus] = useState(u.subscriptionStatus);
  const [level, setLevel] = useState(String(u.outreachLevel));
  const [totalSent, setTotalSent] = useState(String(u.totalMessagesSent));
  const [resetTrial, setResetTrial] = useState(false);

  useEffect(() => {
    setStatus(u.subscriptionStatus);
    setLevel(String(u.outreachLevel));
    setTotalSent(String(u.totalMessagesSent));
  }, [u]);

  async function saveSub(e: FormEvent) {
    e.preventDefault();
    await onSaveSubscription({
      status,
      outreachLevel: Number(level),
      resetTrial: resetTrial || undefined,
    });
  }

  async function saveOutreach(e: FormEvent) {
    e.preventDefault();
    await onSaveOutreach({
      outreachLevel: Number(level),
      totalMessagesSent: Number(totalSent),
    });
  }

  const userId = u.id;

  return (
    <div className="grid-2">
      <form className="detail-card" onSubmit={saveSub}>
        <h3>Abonnement</h3>
        <div className="field">
          <label>Statut</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="trial">trial</option>
            <option value="expired">expired</option>
          </select>
        </div>
        <div className="field">
          <label>Niveau</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={resetTrial}
            onChange={(e) => setResetTrial(e.target.checked)}
          />
          Remettre trial_conversations_used à 0
        </label>
        <div className="actions-row">
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "auto" }}>
            Enregistrer abonnement
          </button>
        </div>
      </form>

      <form className="detail-card" onSubmit={saveOutreach}>
        <h3>Compteurs outreach</h3>
        <div className="field">
          <label>total_messages_sent</label>
          <input value={totalSent} onChange={(e) => setTotalSent(e.target.value)} />
        </div>
        <div className="field">
          <label>outreach_level</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="actions-row">
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "auto" }}>
            Enregistrer compteurs
          </button>
        </div>
      </form>

      <div className="detail-card">
        <h3>Actions dangereuses</h3>
        <div className="actions-row">
          <button
            className="btn btn-warn"
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                title: "Pause campagnes",
                body: "Mettre en pause toutes les campagnes actives de cet utilisateur ?",
                run: async () => {
                  await api(`/api/admin/users/${userId}/pause-automations`, { method: "POST" });
                },
              })
            }
          >
            Pause campagnes
          </button>
          <button
            className="btn btn-warn"
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                title: "Annuler la file",
                body: "Annuler tous les envois pending/processing ?",
                run: async () => {
                  await api(`/api/admin/users/${userId}/cancel-queue`, { method: "POST" });
                },
              })
            }
          >
            Annuler file
          </button>
          <button
            className="btn btn-danger"
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                title: "Stop outbound",
                body: "Pause campagnes + cancel file + auto-reply OFF. Continuer ?",
                run: async () => {
                  await api(`/api/admin/users/${userId}/stop-outbound`, { method: "POST" });
                },
              })
            }
          >
            Stop outbound
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm({
                title: detail.autoReply ? "Couper auto-reply" : "Activer auto-reply",
                body: `Passer auto-reply global à ${detail.autoReply ? "OFF" : "ON"} ?`,
                run: async () => {
                  await api(`/api/admin/users/${userId}/set-auto-reply`, {
                    method: "POST",
                    body: JSON.stringify({ enabled: !detail.autoReply }),
                  });
                },
              })
            }
          >
            Auto-reply {detail.autoReply ? "OFF" : "ON"}
          </button>
        </div>
      </div>
    </div>
  );
}

function num(v: unknown): string {
  return v == null ? "—" : String(v);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}
