/**
 * Diagnostic envois sortants — pourquoi les prospects ne reçoivent pas.
 * Usage : npx tsx scripts/diagnose-outbound.ts
 */
import "dotenv/config";
import { sql } from "../src/pg.js";

async function main() {
  console.log("\n=== DIAGNOSTIC ENVOIS SORTANTS ===\n");

  const active = await sql<
    { id: number; user_id: number; name: string; status: string; type: string }[]
  >`
    SELECT id, user_id, name, status, type FROM automations ORDER BY id DESC LIMIT 20
  `;
  console.log("Campagnes (20 dernières):");
  for (const a of active) {
    console.log(`  #${a.id} user=${a.user_id} [${a.status}] ${a.type} — ${a.name}`);
  }

  const queue = await sql<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n FROM send_queue GROUP BY status ORDER BY status
  `;
  console.log("\nFile send_queue:");
  for (const q of queue) console.log(`  ${q.status}: ${q.n}`);

  const recentQueue = await sql<
    {
      id: number;
      user_id: number;
      recipient: string;
      status: string;
      error: string | null;
      send_at: string;
      sent_at: string | null;
      automation_id: number | null;
    }[]
  >`
    SELECT id, user_id, recipient, status, error, send_at::text, sent_at::text, automation_id
    FROM send_queue ORDER BY id DESC LIMIT 20
  `;
  console.log("\n20 derniers envois file:");
  for (const r of recentQueue) {
    console.log(
      `  #${r.id} user=${r.user_id} [${r.status}] → ${r.recipient}` +
        (r.error ? ` ERR: ${r.error.slice(0, 80)}` : "") +
        (r.sent_at ? ` sent=${r.sent_at}` : ` due=${r.send_at}`),
    );
  }

  const targets = await sql<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n FROM automation_targets GROUP BY status ORDER BY status
  `;
  console.log("\nTargets par statut:");
  for (const t of targets) console.log(`  ${t.status}: ${t.n}`);

  const recentTargets = await sql<
    {
      id: number;
      user_id: number;
      automation_id: number;
      target_id: string;
      status: string;
      last_action_at: string | null;
    }[]
  >`
    SELECT id, user_id, automation_id, target_id, status, last_action_at::text
    FROM automation_targets ORDER BY id DESC LIMIT 15
  `;
  console.log("\n15 derniers targets:");
  for (const t of recentTargets) {
    const lid = t.target_id.includes("@lid") ? " ⚠️ @lid" : "";
    console.log(
      `  #${t.id} auto=${t.automation_id} [${t.status}] ${t.target_id}${lid}`,
    );
  }

  const msgs = await sql<{ direction: string; n: number }[]>`
    SELECT direction, count(*)::int AS n FROM messages GROUP BY direction
  `;
  console.log("\nMessages WhatsApp:");
  for (const m of msgs) console.log(`  ${m.direction}: ${m.n}`);

  const recentOut = await sql<
    { contact_phone: string; body: string; created_at: string; automation_id: number | null }[]
  >`
    SELECT contact_phone, left(body, 60) AS body, created_at::text, automation_id
    FROM messages WHERE direction = 'sortant' ORDER BY id DESC LIMIT 10
  `;
  console.log("\n10 derniers messages sortants DB:");
  for (const m of recentOut) {
    console.log(`  ${m.contact_phone} @ ${m.created_at}: ${m.body}…`);
  }

  const contacts = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM contacts`;
  console.log(`\nContacts total: ${contacts[0]?.n ?? 0}`);

  // Users with active automations
  const usersActive = await sql<{ user_id: number; email: string; n: number }[]>`
    SELECT u.id AS user_id, u.email, count(a.id)::int AS n
    FROM automations a
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'active'
    GROUP BY u.id, u.email
  `;
  console.log("\nUtilisateurs avec campagnes actives:");
  if (usersActive.length === 0) console.log("  (aucun — les envois sont en pause)");
  for (const u of usersActive) console.log(`  user #${u.user_id} ${u.email}: ${u.n} campagne(s)`);

  const logs = await sql<
    { id: number; user_id: number; automation_id: number; level: string; message: string; created_at: string }[]
  >`
    SELECT id, user_id, automation_id, level, message, created_at::text
    FROM automation_logs ORDER BY id DESC LIMIT 15
  `;
  console.log("\n15 derniers logs campagne:");
  for (const l of logs) {
    console.log(`  [${l.level}] user=${l.user_id} auto=${l.automation_id}: ${l.message.slice(0, 100)}`);
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
