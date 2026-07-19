-- Google Sheets sélectionnés via Picker (liés au provider "google" de user_integrations).
-- Pas de lecture de cellules / Drive push ici — stockage de sélection uniquement.

CREATE TABLE IF NOT EXISTS user_connected_sheets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_connected_sheets_spreadsheet_chk CHECK (spreadsheet_id <> ''),
  CONSTRAINT user_connected_sheets_user_sheet_uq UNIQUE (user_id, spreadsheet_id)
);

CREATE INDEX IF NOT EXISTS idx_user_connected_sheets_user
  ON user_connected_sheets (user_id);
