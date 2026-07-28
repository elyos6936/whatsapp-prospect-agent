/**
 * Applique le statut processing + claimed_at sur send_queue.
 * npx tsx scripts/apply-send-queue-claim-migration.ts
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
  console.log("Applying send_queue processing claim…");
  await sql`ALTER TABLE send_queue DROP CONSTRAINT IF EXISTS send_queue_status_check`;
  await sql`
    ALTER TABLE send_queue
      ADD CONSTRAINT send_queue_status_check
      CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'))
  `;
  await sql`ALTER TABLE send_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`;
  console.log("✅ send_queue claim schema OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sql.end());
