-- Intégrations OAuth par utilisateur (Typeform, puis d'autres providers).
-- Tokens stockés chiffrés côté app (AES-GCM) — jamais en clair.

CREATE TABLE IF NOT EXISTS user_integrations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  provider_account_id TEXT,
  provider_email TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_integrations_provider_chk CHECK (provider <> ''),
  CONSTRAINT user_integrations_user_provider_uq UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_integrations_user
  ON user_integrations (user_id);

-- États OAuth éphémères (anti-CSRF) — TTL géré en app (~10 min).
CREATE TABLE IF NOT EXISTS oauth_pending_states (
  state TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_states_created
  ON oauth_pending_states (created_at);
