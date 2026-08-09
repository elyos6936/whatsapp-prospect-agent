-- Multi-workspace: un user peut appartenir à plusieurs équipes + garder son perso.

-- Drop UNIQUE global sur workspace_members.user_id (garder PK workspace_id+user_id).
ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_user_id_key;

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

-- Workspace actif pour le switch perso / équipe.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_workspace_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_users_active_workspace
  ON users(active_workspace_id)
  WHERE active_workspace_id IS NOT NULL;
