-- Multi-tenant: users table + user_id on all tenant tables

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  onboarding_answers JSONB,
  business_owner_name TEXT,
  business_offer TEXT,
  business_price TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Operator account for existing data backfill (password set via app on first deploy)
INSERT INTO users (id, email, password_hash, name, onboarding_completed)
OVERRIDING SYSTEM VALUE
VALUES (1, 'operator@klanvio.local', '$2a$10$placeholder.operator.hash.change.me', 'Opérateur', true)
ON CONFLICT (id) DO NOTHING;

-- Advance the identity sequence past the manually-inserted operator id
SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1));

-- settings: migrate from global key PK to (user_id, key)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE settings SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE settings ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (user_id, key);
-- Remove platform keys from per-user settings (now in env)
DELETE FROM settings WHERE key IN ('openai_api_key', 'evolution_api_base_url', 'evolution_api_key', 'evolution_instance_name');

-- agent_conversation
ALTER TABLE agent_conversation ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE agent_conversation SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE agent_conversation ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_conversation_user ON agent_conversation(user_id, created_at);

-- messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE messages SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_green_api_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_user_green_api ON messages(user_id, green_api_id) WHERE green_api_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at);

-- contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE contacts SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE contacts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_phone ON contacts(user_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_user_status ON contacts(user_id, status);

-- scheduled_messages
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE scheduled_messages SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE scheduled_messages ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_user_pending ON scheduled_messages(user_id, status, send_at);

-- automations
ALTER TABLE automations ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE automations SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE automations ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automations_user_status ON automations(user_id, status);

-- automation_targets (isolated via automation FK, add user_id for simpler queries)
ALTER TABLE automation_targets ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE automation_targets t SET user_id = a.user_id FROM automations a WHERE a.id = t.automation_id AND t.user_id IS NULL;
UPDATE automation_targets SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE automation_targets ALTER COLUMN user_id SET NOT NULL;

-- automation_logs
ALTER TABLE automation_logs ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE automation_logs l SET user_id = a.user_id FROM automations a WHERE a.id = l.automation_id AND l.user_id IS NULL;
UPDATE automation_logs SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE automation_logs ALTER COLUMN user_id SET NOT NULL;

-- contact_sequences
ALTER TABLE contact_sequences ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE contact_sequences SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE contact_sequences ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_sequences_user ON contact_sequences(user_id, contact_phone, status);

-- send_queue
ALTER TABLE send_queue ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE send_queue SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE send_queue ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_send_queue_user_pending ON send_queue(user_id, status, priority DESC, send_at);

-- group_reply_rules
ALTER TABLE group_reply_rules ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE group_reply_rules SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE group_reply_rules ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_reply_rules_user ON group_reply_rules(user_id, group_id, status);

-- handoff_events
ALTER TABLE handoff_events ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);
UPDATE handoff_events SET user_id = 1 WHERE user_id IS NULL;
ALTER TABLE handoff_events ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_handoff_user_pending ON handoff_events(user_id, status, created_at);
