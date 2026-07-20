-- Retour OAuth vers le bon front (klanvio.vercel.app vs www.klanvio.com).

ALTER TABLE oauth_pending_states
  ADD COLUMN IF NOT EXISTS return_base_url TEXT;
