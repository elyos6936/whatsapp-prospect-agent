-- Google Contacts (People API) : gate onboarding + cache d'idempotence.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_contacts_prompt_done BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS google_contacts_ensured (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_key TEXT NOT NULL,
  resource_name TEXT,
  ensured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, phone_key)
);

CREATE INDEX IF NOT EXISTS idx_google_contacts_ensured_user
  ON google_contacts_ensured (user_id);

-- Purpose OAuth (sheets vs contacts) pour auth incrémentale.
ALTER TABLE oauth_pending_states
  ADD COLUMN IF NOT EXISTS purpose TEXT;
