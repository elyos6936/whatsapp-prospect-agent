-- Canal de conversation pour l'agent : 'main' = chat principal, 'automation' = constructeur d'automatisations (page Automatisation → Manuel).
ALTER TABLE agent_conversation ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'main';

CREATE INDEX IF NOT EXISTS idx_agent_conversation_channel
  ON agent_conversation(user_id, channel, id);
