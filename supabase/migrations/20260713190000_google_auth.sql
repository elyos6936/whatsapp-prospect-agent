-- Connexion Google (Google Identity Services)
-- Les comptes créés via Google n'ont pas de mot de passe local.

-- password_hash devient optionnel (comptes Google uniquement)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Identifiant stable Google (claim "sub" du token) + avatar optionnel
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
  ON users(google_sub) WHERE google_sub IS NOT NULL;
