-- Campaign memories (was runtime-only) + subscription period columns

CREATE TABLE IF NOT EXISTS campaign_memories (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  intro_formula TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'pro',
  tone_note TEXT NOT NULL DEFAULT '',
  formality TEXT NOT NULL DEFAULT 'vous',
  stickers_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  emoji_level TEXT NOT NULL DEFAULT 'none',
  send_window_start INT NOT NULL DEFAULT 9,
  send_window_end INT NOT NULL DEFAULT 18,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_memories_user
  ON campaign_memories(user_id, id DESC);

ALTER TABLE agent_threads
  ADD COLUMN IF NOT EXISTS campaign_memory_id BIGINT REFERENCES campaign_memories(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS billing_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_token TEXT NOT NULL UNIQUE,
  provider_checkout_url TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  amount_eur INTEGER NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_event TEXT,
  provider_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_user_created
  ON billing_payments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_payments_status
  ON billing_payments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_phone_bindings (
  phone_key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_bindings_user
  ON whatsapp_phone_bindings (user_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;

-- Backfill trial_started_at from created_at when missing (DEFAULT already set on add)
UPDATE users
SET trial_started_at = COALESCE(trial_started_at, created_at, NOW())
WHERE trial_started_at IS NULL;
