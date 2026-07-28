/**
 * Passe tous les comptes en abonnement actif niveau 1 (plus d'essai).
 * npx tsx scripts/activate-all-users-starter.ts
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
  const before = await sql`
    SELECT id, email, subscription_status, outreach_level, trial_conversations_used
    FROM users
    ORDER BY id
  `;
  console.log("BEFORE:", before);

  const after = await sql`
    UPDATE users
    SET
      subscription_status = 'active',
      outreach_level = 1,
      trial_conversations_used = 0
    RETURNING
      id, email, subscription_status, outreach_level,
      total_messages_sent, trial_conversations_used
  `;
  console.log("AFTER:", after);
  console.log(`✅ ${after.length} compte(s) → active / niveau 1`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sql.end());
