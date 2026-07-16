import "dotenv/config";
import { sql } from "../src/pg.js";

async function main() {
  const a = await sql`
    SELECT id, name, status, user_id
    FROM automations
    ORDER BY id
  `;
  console.log("AUTOMATIONS", a);

  const q = await sql`
    SELECT count(*)::int AS n FROM send_queue WHERE status IN ('pending', 'processing')
  `;
  console.log("QUEUE_PENDING", q[0]?.n);

  const health = await fetch("https://klanvio-api.srv1820011.hstgr.cloud/api/health")
    .then((r) => r.json())
    .catch((e) => ({ err: String(e) }));
  console.log("PROD_HEALTH", health);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
