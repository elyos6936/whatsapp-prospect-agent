-- Ajouter le statut 'draft' aux automatisations (brouillon avant activation)
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_status_check;
ALTER TABLE automations ADD CONSTRAINT automations_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'completed', 'failed'));
