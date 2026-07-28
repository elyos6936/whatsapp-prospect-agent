-- Outreach level + trial subscription (lifetime sent + daily new-conversation caps)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS total_messages_sent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outreach_level INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_conversations_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_weekly_report_week TEXT,
  ADD COLUMN IF NOT EXISTS last_reported_outreach_level INTEGER;

-- Backfill lifetime sortants (counts_toward_quota)
UPDATE users u
SET total_messages_sent = COALESCE(s.n, 0),
    outreach_level = CASE
      WHEN COALESCE(s.n, 0) >= 4000 THEN 5
      WHEN COALESCE(s.n, 0) >= 3000 THEN 4
      WHEN COALESCE(s.n, 0) >= 2000 THEN 3
      WHEN COALESCE(s.n, 0) >= 1000 THEN 2
      ELSE 1
    END
FROM (
  SELECT user_id, COUNT(*)::int AS n
  FROM messages
  WHERE direction = 'sortant'
    AND COALESCE(counts_toward_quota, 1) = 1
  GROUP BY user_id
) s
WHERE u.id = s.user_id;

-- Comptes déjà onboardingés hors essai manuel : restent en trial jusqu'à activation manuelle
-- (pas de Stripe pour l'instant).
