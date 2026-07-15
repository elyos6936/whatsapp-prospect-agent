-- Fils d'automatisation : 1 thread agent = 1 campagne max

CREATE TABLE IF NOT EXISTS agent_threads (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Automatisation',
  automation_id BIGINT REFERENCES automations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_threads_user ON agent_threads(user_id, updated_at DESC);

ALTER TABLE agent_conversation ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES agent_threads(id) ON DELETE CASCADE;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS agent_thread_id BIGINT REFERENCES agent_threads(id) ON DELETE SET NULL;

-- Fil par défaut pour chaque utilisateur ayant déjà des messages agent
INSERT INTO agent_threads (user_id, title, updated_at)
SELECT DISTINCT ac.user_id, 'Automatisation', NOW()
FROM agent_conversation ac
WHERE ac.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM agent_threads t WHERE t.user_id = ac.user_id);

-- Fil par défaut pour utilisateurs avec automatisations mais sans fil
INSERT INTO agent_threads (user_id, title, updated_at)
SELECT DISTINCT a.user_id, 'Automatisation', NOW()
FROM automations a
WHERE NOT EXISTS (SELECT 1 FROM agent_threads t WHERE t.user_id = a.user_id);

-- Attacher les messages existants au fil par défaut de l'utilisateur
UPDATE agent_conversation ac
SET thread_id = t.id
FROM agent_threads t
WHERE ac.user_id = t.user_id
  AND ac.thread_id IS NULL
  AND t.id = (
    SELECT MIN(t2.id) FROM agent_threads t2 WHERE t2.user_id = ac.user_id
  );

-- Lier la campagne la plus pertinente au fil par défaut (draft > active > paused > autres)
WITH ranked AS (
  SELECT
    a.user_id,
    a.id AS automation_id,
    a.name,
    ROW_NUMBER() OVER (
      PARTITION BY a.user_id
      ORDER BY
        CASE a.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
        a.updated_at DESC
    ) AS rn
  FROM automations a
)
UPDATE agent_threads t
SET automation_id = r.automation_id,
    title = COALESCE(NULLIF(r.name, ''), t.title),
    updated_at = NOW()
FROM ranked r
WHERE t.user_id = r.user_id
  AND r.rn = 1
  AND t.automation_id IS NULL
  AND t.id = (SELECT MIN(t2.id) FROM agent_threads t2 WHERE t2.user_id = t.user_id);

-- Renseigner agent_thread_id sur les automatisations
UPDATE automations a
SET agent_thread_id = t.id
FROM agent_threads t
WHERE t.user_id = a.user_id
  AND t.automation_id = a.id
  AND a.agent_thread_id IS NULL;

-- Campagnes orphelines → rattacher au fil par défaut si pas encore liées
UPDATE automations a
SET agent_thread_id = (
  SELECT MIN(t.id) FROM agent_threads t WHERE t.user_id = a.user_id
)
WHERE a.agent_thread_id IS NULL
  AND EXISTS (SELECT 1 FROM agent_threads t WHERE t.user_id = a.user_id);

CREATE INDEX IF NOT EXISTS idx_agent_conversation_thread ON agent_conversation(user_id, thread_id, id);
