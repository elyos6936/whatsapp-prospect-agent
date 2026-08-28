-- État briefing persisté par fil + flag simulation
ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS briefing_state JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS simulation_shown_at TIMESTAMPTZ;
