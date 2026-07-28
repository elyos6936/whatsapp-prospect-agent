/**
 * Applique la migration outreach level sur la DB (DATABASE_URL).
 * npx tsx scripts/apply-outreach-migration.ts
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

async function main() {
  console.log("Applying outreach columns…");
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS total_messages_sent INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS outreach_level INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial',
      ADD COLUMN IF NOT EXISTS trial_conversations_used INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_weekly_report_week TEXT,
      ADD COLUMN IF NOT EXISTS last_reported_outreach_level INTEGER
  `;

  console.log("Backfilling total_messages_sent / outreach_level…");
  const updated = await sql`
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
    WHERE u.id = s.user_id
    RETURNING u.id
  `;

  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name IN (
        'total_messages_sent','outreach_level','subscription_status',
        'trial_conversations_used','last_weekly_report_week','last_reported_outreach_level'
      )
    ORDER BY column_name
  `;

  const [stats] = await sql`
    SELECT
      COUNT(*)::int AS users,
      COUNT(*) FILTER (WHERE total_messages_sent > 0)::int AS with_sent,
      COALESCE(MAX(outreach_level), 0)::int AS max_level,
      COUNT(*) FILTER (WHERE subscription_status = 'trial')::int AS trial_users,
      COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS active_users
    FROM users
  `;

  console.log("columns:", cols.map((c) => c.column_name).join(", "));
  console.log("backfilled_users:", updated.length);
  console.log("stats:", stats);
  console.log("OK");
  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sql.end({ timeout: 1 });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
