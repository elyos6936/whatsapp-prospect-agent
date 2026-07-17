-- Mémoire conversation isolée par (contact × automatisation)
CREATE TABLE IF NOT EXISTS contact_automation_state (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  automation_id BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  memory_summary TEXT,
  memory_updated_at TIMESTAMPTZ,
  lead_score INTEGER NOT NULL DEFAULT 0,
  handoff_status TEXT,
  conversation_epoch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone, automation_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_automation_state_auto
  ON contact_automation_state (user_id, automation_id);
CREATE INDEX IF NOT EXISTS idx_contact_automation_state_phone
  ON contact_automation_state (user_id, phone);

-- Taguer les messages WhatsApp avec l'automatisation d'origine
ALTER TABLE messages ADD COLUMN IF NOT EXISTS automation_id BIGINT REFERENCES automations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_automation
  ON messages (user_id, automation_id, contact_phone);
