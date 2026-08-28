-- Suivi durable des jobs chat async (fire-and-forget)
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
);

CREATE INDEX IF NOT EXISTS idx_agent_chat_jobs_user_thread
  ON agent_chat_jobs(user_id, thread_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_chat_jobs_status_started
  ON agent_chat_jobs(status, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_chat_jobs_pending_thread
  ON agent_chat_jobs(user_id, thread_id)
  WHERE status = 'pending';
