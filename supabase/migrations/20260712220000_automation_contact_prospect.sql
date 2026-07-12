-- Ajouter le type 'contact_prospect' (prospection d'un ou plusieurs contacts, hors groupe)
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_type_check;
ALTER TABLE automations ADD CONSTRAINT automations_type_check
  CHECK (type IN ('group_prospect', 'contact_prospect', 'keyword_sales', 'custom_followup'));
