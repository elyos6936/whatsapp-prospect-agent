-- Nouvelle campagne = nouvelle conversation : coupe historique LLM / mémoire
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS conversation_epoch_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conversation_campaign_id BIGINT;
