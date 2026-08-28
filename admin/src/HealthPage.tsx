import { useEffect, useState } from "react";
import { api } from "./api";

type WorkerHeartbeat = {
  lastTickAt: string | null;
  lastError: string | null;
  processedCount: number;
};

type ChatJob = {
  id: number;
  user_id: number;
  thread_id: number;
  request_id: string;
  status: string;
  path: string | null;
  error: string | null;
  started_at: string;
  duration_ms: number | null;
};

type HealthWorkers = {
  ok: boolean;
  workers: Record<string, WorkerHeartbeat>;
  whatsappPoll: { lastPollAt?: string | null; lastSyncAt?: string | null };
  sendQueue: {
    pending: number;
    processing: number;
    failedLastHour: number;
    stuckPending: number;
    stuckProcessing: number;
  };
  recentChatJobs: {
    failed: ChatJob[];
    lost: ChatJob[];
  };
};

export function HealthPage() {
  const [data, setData] = useState<HealthWorkers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<HealthWorkers>("/api/admin/health/workers");
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="loading">Chargement santé…</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return null;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Santé plateforme</h1>
        <p className="muted">Workers, file d&apos;envoi, jobs chat récents</p>
      </header>

      <section className="card">
        <h2>WhatsApp poller</h2>
        <p>Dernier poll : {data.whatsappPoll.lastPollAt ?? "—"}</p>
        <p>Dernier sync : {data.whatsappPoll.lastSyncAt ?? "—"}</p>
      </section>

      <section className="card">
        <h2>File d&apos;envoi</h2>
        <ul>
          <li>Pending : {data.sendQueue.pending}</li>
          <li>Processing : {data.sendQueue.processing}</li>
          <li>Failed (1h) : {data.sendQueue.failedLastHour}</li>
          <li>Stuck pending (&gt;1h) : {data.sendQueue.stuckPending}</li>
          <li>Stuck processing (&gt;30m) : {data.sendQueue.stuckProcessing}</li>
        </ul>
      </section>

      <section className="card">
        <h2>Workers</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Dernier tick</th>
              <th>Erreur</th>
              <th>Traités</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.workers).map(([name, w]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{w.lastTickAt ?? "—"}</td>
                <td>{w.lastError ?? "—"}</td>
                <td>{w.processedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(data.workers).length === 0 && (
          <p className="muted">Aucun heartbeat encore (attendre un cycle worker).</p>
        )}
      </section>

      <section className="card">
        <h2>Jobs chat failed / lost (20 derniers)</h2>
        <h3>Failed</h3>
        {data.recentChatJobs.failed.length === 0 ? (
          <p className="muted">Aucun</p>
        ) : (
          <ul>
            {data.recentChatJobs.failed.map((j) => (
              <li key={j.id}>
                #{j.id} user={j.user_id} thread={j.thread_id} path={j.path ?? "—"} —{" "}
                {j.error ?? "erreur"}
              </li>
            ))}
          </ul>
        )}
        <h3>Lost</h3>
        {data.recentChatJobs.lost.length === 0 ? (
          <p className="muted">Aucun</p>
        ) : (
          <ul>
            {data.recentChatJobs.lost.map((j) => (
              <li key={j.id}>
                #{j.id} user={j.user_id} thread={j.thread_id} req={j.request_id}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
