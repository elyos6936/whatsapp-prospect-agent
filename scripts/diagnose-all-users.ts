/**
 * Diagnostic global par utilisateur — campagnes + envois.
 * Usage : npx tsx scripts/diagnose-all-users.ts
 */
import "dotenv/config";
import { sql } from "../src/pg.js";

async function main() {
  console.log("\n=== DIAGNOSTIC GLOBAL UTILISATEURS ===\n");

  const users = await sql<
    { id: number; email: string; onboarding_completed: boolean }[]
  >`SELECT id, email, onboarding_completed FROM users ORDER BY id`;

  console.log(`Utilisateurs: ${users.length}\n`);

  for (const u of users) {
    const { evolutionInstanceName } = await import("../src/config.js");
    const instance = evolutionInstanceName(u.id);

    const autos = await sql<{ status: string; n: number }[]>`
      SELECT status, count(*)::int AS n FROM automations WHERE user_id = ${u.id} GROUP BY status
    `;
    const autoStr = autos.map((a) => `${a.status}=${a.n}`).join(", ") || "aucune";

    const queue = await sql<{ status: string; n: number }[]>`
      SELECT status, count(*)::int AS n FROM send_queue WHERE user_id = ${u.id} GROUP BY status
    `;
    const queueStr = queue.map((q) => `${q.status}=${q.n}`).join(", ") || "vide";

    const outToday = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM messages
      WHERE user_id = ${u.id} AND direction = 'sortant'
        AND created_at >= CURRENT_DATE
    `;

    const contacts = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM contacts WHERE user_id = ${u.id}
    `;

    const lastErr = await sql<{ message: string }[]>`
      SELECT message FROM automation_logs
      WHERE user_id = ${u.id} AND level IN ('error','warning')
      ORDER BY id DESC LIMIT 1
    `;

    const onboarding = u.onboarding_completed ? "OK" : "NON TERMINÉ";

    console.log(`#${u.id} ${u.email}`);
    console.log(`  onboarding: ${onboarding} | instance Evolution: ${instance}`);
    console.log(`  campagnes: ${autoStr}`);
    console.log(`  file envoi: ${queueStr} | sortants aujourd'hui: ${outToday[0]?.n ?? 0}`);
    console.log(`  contacts: ${contacts[0]?.n ?? 0}`);
    if (lastErr[0]) console.log(`  dernier log: ${lastErr[0].message.slice(0, 120)}`);
    console.log("");
  }

  const failedQueue = await sql<
    { user_id: number; email: string; error: string; n: number }[]
  >`
    SELECT sq.user_id, u.email, sq.error, count(*)::int AS n
    FROM send_queue sq JOIN users u ON u.id = sq.user_id
    WHERE sq.status = 'failed'
    GROUP BY sq.user_id, u.email, sq.error
    ORDER BY n DESC LIMIT 10
  `;
  if (failedQueue.length) {
    console.log("Erreurs envoi les plus fréquentes:");
    for (const f of failedQueue) {
      console.log(`  user=${f.user_id} (${f.n}x): ${f.error.slice(0, 100)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
