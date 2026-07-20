-- Découplage Google Sheets / Google Contacts (providers séparés).
-- La migration runtime (migrateLegacyGoogleIntegrations) copie les tokens
-- de provider='google' vers google_sheets / google_contacts.
-- Ce fichier documente le modèle cible ; aucune ALTER obligatoire
-- (UNIQUE user_id+provider déjà en place).

-- Providers attendus après migration app :
--   google_sheets   — scopes Drive/Sheets
--   google_contacts — scope People contacts
-- L'ancien provider 'google' est supprimé par l'app au premier accès.

COMMENT ON TABLE user_integrations IS
  'OAuth tokens chiffrés. Google : google_sheets et google_contacts séparés (comptes distincts possibles).';
