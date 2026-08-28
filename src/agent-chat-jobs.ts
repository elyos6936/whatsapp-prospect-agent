/**
 * Persistance jobs chat async — observabilité + lock durable (remplace Set RAM seul).
 */
import { sql } from "./pg.js";

export type AgentChatJobStatus = "pending" | "completed" | "failed" | "lost";

export type AgentChatJob = {
  id: number;
  user_id: number;
  thread_id: number;
  request_id: string;
  status: AgentChatJobStatus;
  path: string | null;
  slot: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensureAgentChatJobsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agent_chat_jobs (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          thread_id BIGINT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'completed', 'failed', 'lost')),
          path TEXT,
          slot TEXT,
          error TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMPTZ,
          duration_ms INT
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_chat_jobs_user_thread
          ON agent_chat_jobs(user_id, thread_id, started_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_agent_chat_jobs_status_started
          ON agent_chat_jobs(status, started_at DESC)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_chat_jobs_pending_thread
          ON agent_chat_jobs(user_id, thread_id)
          WHERE status = 'pending'
      `;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function mapJob(row: Record<string, unknown>): AgentChatJob {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    thread_id: Number(row.thread_id),
    request_id: String(row.request_id),
    status: String(row.status) as AgentChatJobStatus,
    path: row.path != null ? String(row.path) : null,
    slot: row.slot != null ? String(row.slot) : null,
    error: row.error != null ? String(row.error) : null,
    started_at: String(row.started_at),
    finished_at: row.finished_at != null ? String(row.finished_at) : null,
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
  };
}

export async function createAgentChatJob(opts: {
  userId: number;
  threadId: number;
  requestId: string;
}): Promise<AgentChatJob> {
  await ensureAgentChatJobsSchema();
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_chat_jobs (user_id, thread_id, request_id, status)
    VALUES (${opts.userId}, ${opts.threadId}, ${opts.requestId}, 'pending')
    RETURNING *
  `;
  return mapJob(rows[0]!);
}

export async function hasPendingAgentChatJob(userId: number, threadId: number): Promise<boolean> {
  await ensureAgentChatJobsSchema().catch(() => {});
  const rows = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM agent_chat_jobs
    WHERE user_id = ${userId} AND thread_id = ${threadId} AND status = 'pending'
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function finishAgentChatJob(
  jobId: number,
  opts: {
    status: Exclude<AgentChatJobStatus, "pending">;
    path?: string | null;
    slot?: string | null;
    error?: string | null;
    durationMs?: number;
  },
): Promise<void> {
  await ensureAgentChatJobsSchema().catch(() => {});
  await sql`
    UPDATE agent_chat_jobs
    SET
      status = ${opts.status},
      path = ${opts.path ?? null},
      slot = ${opts.slot ?? null},
      error = ${opts.error ?? null},
      finished_at = NOW(),
      duration_ms = ${opts.durationMs ?? null}
    WHERE id = ${jobId}
  `;
}

export async function markLostAgentChatJobs(olderThanMinutes = 10): Promise<number> {
  await ensureAgentChatJobsSchema().catch(() => {});
  const rows = await sql<Array<{ id: number }>>`
    UPDATE agent_chat_jobs
    SET status = 'lost', finished_at = NOW(), error = 'timeout_no_completion'
    WHERE status = 'pending'
      AND started_at < NOW() - (${olderThanMinutes} * INTERVAL '1 minute')
    RETURNING id
  `;
  return rows.length;
}

export async function listRecentAgentChatJobs(opts: {
  limit?: number;
  status?: AgentChatJobStatus;
  userId?: number;
}): Promise<AgentChatJob[]> {
  await ensureAgentChatJobsSchema().catch(() => {});
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.status && opts.userId != null) {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM agent_chat_jobs
      WHERE status = ${opts.status} AND user_id = ${opts.userId}
      ORDER BY started_at DESC LIMIT ${limit}
    `;
    return rows.map(mapJob);
  }
  if (opts.status) {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM agent_chat_jobs
      WHERE status = ${opts.status}
      ORDER BY started_at DESC LIMIT ${limit}
    `;
    return rows.map(mapJob);
  }
  if (opts.userId != null) {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM agent_chat_jobs
      WHERE user_id = ${opts.userId}
      ORDER BY started_at DESC LIMIT ${limit}
    `;
    return rows.map(mapJob);
  }
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM agent_chat_jobs ORDER BY started_at DESC LIMIT ${limit}
  `;
  return rows.map(mapJob);
}

export async function getSendQueueHealthStats(): Promise<{
  pending: number;
  processing: number;
  failedLastHour: number;
  stuckPending: number;
  stuckProcessing: number;
}> {
  const rows = await sql<
    Array<{
      pending: number;
      processing: number;
      failed_last_hour: number;
      stuck_pending: number;
      stuck_processing: number;
    }>
  >`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '1 hour')::int AS failed_last_hour,
      count(*) FILTER (WHERE status = 'pending' AND send_at < NOW() - INTERVAL '1 hour')::int AS stuck_pending,
      count(*) FILTER (WHERE status = 'processing' AND claimed_at < NOW() - INTERVAL '30 minutes')::int AS stuck_processing
    FROM send_queue
  `;
  const r = rows[0];
  return {
    pending: Number(r?.pending ?? 0),
    processing: Number(r?.processing ?? 0),
    failedLastHour: Number(r?.failed_last_hour ?? 0),
    stuckPending: Number(r?.stuck_pending ?? 0),
    stuckProcessing: Number(r?.stuck_processing ?? 0),
  };
}
