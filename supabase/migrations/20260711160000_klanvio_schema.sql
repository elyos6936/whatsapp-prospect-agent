-- Klanvio / WhatsApp Prospect Agent schema (Postgres)

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_conversation (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  contact_phone TEXT NOT NULL,
  sender_name TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('entrant', 'sortant')),
  body TEXT NOT NULL,
  green_api_id TEXT UNIQUE,
  counts_toward_quota INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'nouveau'
    CHECK (status IN ('nouveau', 'en_conversation', 'interesse', 'stop')),
  auto_reply INTEGER NOT NULL DEFAULT 0 CHECK (auto_reply IN (0, 1)),
  lead_score INTEGER NOT NULL DEFAULT 0,
  memory_summary TEXT,
  memory_updated_at TIMESTAMPTZ,
  handoff_status TEXT,
  whatsapp_lid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id BIGSERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  recipient_label TEXT,
  message TEXT NOT NULL,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS automations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('group_prospect', 'keyword_sales', 'custom_followup')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'failed')),
  config_json TEXT NOT NULL DEFAULT '{}',
  stats_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  budget_fcfa INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_targets (
  id BIGSERIAL PRIMARY KEY,
  automation_id BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  target_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'contacted', 'replied', 'interested', 'stopped', 'error')),
  last_action_at TIMESTAMPTZ,
  notes TEXT,
  ab_variant TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(automation_id, target_id)
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id BIGSERIAL PRIMARY KEY,
  automation_id BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_sequences (
  id BIGSERIAL PRIMARY KEY,
  contact_phone TEXT NOT NULL,
  automation_id BIGINT REFERENCES automations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  next_step_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS send_queue (
  id BIGSERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  recipient_label TEXT,
  message TEXT,
  media_url TEXT,
  media_type TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  automation_id BIGINT,
  sequence_id BIGINT,
  ab_variant TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS group_reply_rules (
  id BIGSERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  group_label TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  reply_guide TEXT,
  automation_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS handoff_events (
  id BIGSERIAL PRIMARY KEY,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  reason TEXT NOT NULL,
  summary TEXT,
  suggested_reply TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(contact_phone);
CREATE INDEX IF NOT EXISTS idx_agent_conversation_created ON agent_conversation(created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_messages(status, send_at);
CREATE INDEX IF NOT EXISTS idx_automations_status ON automations(status);
CREATE INDEX IF NOT EXISTS idx_automation_targets_auto ON automation_targets(automation_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_logs_auto ON automation_logs(automation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_sequences_phone ON contact_sequences(contact_phone, status);
CREATE INDEX IF NOT EXISTS idx_send_queue_pending ON send_queue(status, priority DESC, send_at);
CREATE INDEX IF NOT EXISTS idx_group_reply_rules_group ON group_reply_rules(group_id, status);
CREATE INDEX IF NOT EXISTS idx_handoff_pending ON handoff_events(status, created_at);
