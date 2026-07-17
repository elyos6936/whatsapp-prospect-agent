-- Le moteur réserve une cible pending → queued avant l'envoi (claim atomique).
ALTER TABLE automation_targets DROP CONSTRAINT IF EXISTS automation_targets_status_check;
ALTER TABLE automation_targets ADD CONSTRAINT automation_targets_status_check
  CHECK (status IN ('pending', 'queued', 'contacted', 'replied', 'interested', 'stopped', 'error'));
