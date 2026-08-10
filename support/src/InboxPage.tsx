import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type SupportMessage,
  type SupportTicket,
} from "./api";
import { useAuth } from "./auth";

function mediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") ? url : `/${url}`;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function InboxPage() {
  const { email, logout } = useAuth();
  const [tab, setTab] = useState<"active" | "done">("active");
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTickets = useCallback(async (preferId?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ tickets: SupportTicket[] }>(
        `/api/support/tickets?status=${tab === "done" ? "done" : "active"}`
      );
      setTickets(data.tickets);
      setSelectedId((cur) => {
        const want = preferId ?? cur;
        if (want && data.tickets.some((t) => t.id === want)) return want;
        return data.tickets[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (selectedId == null) {
      setTicket(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ ticket: SupportTicket; messages: SupportMessage[] }>(
          `/api/support/tickets/${selectedId}`
        );
        if (!cancelled) {
          setTicket(data.ticket);
          setMessages(data.messages);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Erreur détail");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function sendReply() {
    if (!selectedId || !draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ticket: SupportTicket; message: SupportMessage }>(
        `/api/support/tickets/${selectedId}/reply`,
        {
          method: "POST",
          body: JSON.stringify({ message: draft.trim() }),
        }
      );
      setTicket(res.ticket);
      setMessages((prev) => [...prev, res.message]);
      setDraft("");
      await loadTickets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi WhatsApp impossible");
    } finally {
      setBusy(false);
    }
  }

  async function markDone() {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const res = await api<{ ticket: SupportTicket }>(`/api/support/tickets/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });
      setTicket(res.ticket);
      setSelectedId(null);
      await loadTickets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const res = await api<{ ticket: SupportTicket }>(`/api/support/tickets/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "open" }),
      });
      setTicket(res.ticket);
      setTab("active");
      await loadTickets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div>
            <strong>Support inbox</strong>
            <div className="meta" style={{ fontSize: 11, color: "var(--text-500)" }}>
              {email}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Quitter
          </button>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === "active" ? "active" : ""}`}
            onClick={() => setTab("active")}
          >
            Open
          </button>
          <button
            type="button"
            className={`tab ${tab === "done" ? "active" : ""}`}
            onClick={() => setTab("done")}
          >
            Done
          </button>
        </div>
        <div className="ticket-list">
          {loading && <p className="meta">Chargement…</p>}
          {!loading && tickets.length === 0 && <p className="meta">Aucune demande</p>}
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ticket-item ${selectedId === t.id ? "active" : ""}`}
              onClick={() => setSelectedId(t.id)}
            >
              <p className="title">
                #{t.id} {t.subject}
                <span className={`badge ${t.status}`}>{t.status}</span>
              </p>
              <p className="meta">
                {t.user_name || t.user_email || `user #${t.user_id}`} · {fmt(t.last_message_at)}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {error && <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
        {!ticket ? (
          <div className="main-empty">Sélectionnez une demande pour répondre sur WhatsApp.</div>
        ) : (
          <>
            <div className="main-head">
              <div>
                <h2>
                  #{ticket.id} — {ticket.subject}
                </h2>
                <p>
                  {ticket.user_name || "—"} · {ticket.user_email || "—"}
                  {ticket.client_phone ? ` · WA ${ticket.client_phone}` : ""}
                  {ticket.handoff_reason ? ` · ${ticket.handoff_reason}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {ticket.status !== "done" ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void markDone()} disabled={busy}>
                    Marquer traité
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reopen()} disabled={busy}>
                    Rouvrir
                  </button>
                )}
              </div>
            </div>

            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  <div className="who">
                    {m.role === "user"
                      ? "Client"
                      : m.role === "ops"
                        ? "Vous (WhatsApp)"
                        : m.role === "assistant"
                          ? "Grace"
                          : "Système"}{" "}
                    · {fmt(m.created_at)}
                  </div>
                  <div>{m.content}</div>
                  {m.image_urls?.map((url) => (
                    <a key={url} href={mediaUrl(url)} target="_blank" rel="noreferrer">
                      <img src={mediaUrl(url)} alt="" />
                    </a>
                  ))}
                </div>
              ))}
            </div>

            {ticket.status !== "done" && (
              <div className="composer">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Répondre au client sur WhatsApp…"
                  rows={2}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !draft.trim()}
                  onClick={() => void sendReply()}
                >
                  {busy ? "Envoi…" : "Envoyer sur WA"}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
