/**
 * Liste les campagnes sans fil agent (automation_id sur agent_threads).
 * Usage: npx tsx scripts/audit-orphan-automations.ts [user_id]
 */
import "dotenv/config";
import { sql } from "../src/pg.js";

const userIdArg = process.argv[2]?.trim();
const userFilter = userIdArg && /^\d+$/.test(userIdArg) ? Number(userIdArg) : null;

type Row = {
  automation_id: number;
  user_id: number;
  name: string;
  status: string;
  agent_thread_id: number | null;
  created_at: string;
  user_email: string | null;
};

const rows = await sql<Row[]>`
  SELECT
    a.id AS automation_id,
    a.user_id,
    a.name,
    a.status,
    a.agent_thread_id,
    a.created_at::text AS created_at,
    u.email AS user_email
  FROM automations a
  LEFT JOIN users u ON u.id = a.user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_threads t
    WHERE t.user_id = a.user_id AND t.automation_id = a.id
  )
  ${userFilter != null ? sql`AND a.user_id = ${userFilter}` : sql``}
  ORDER BY a.user_id, a.id
`;

console.log(`Orphelines (sans agent_threads.automation_id): ${rows.length}\n`);
for (const r of rows) {
  const threadRef =
    r.agent_thread_id != null ? `agent_thread_id=${r.agent_thread_id} (fil absent ou délié)` : "agent_thread_id=NULL";
  console.log(
    `- auto #${r.automation_id} user #${r.user_id} (${r.user_email ?? "?"}) « ${r.name} » [${r.status}] ${threadRef} created=${r.created_at}`,
  );
}

const mismatched = await sql<
  Array<{
    automation_id: number;
    user_id: number;
    name: string;
    thread_id: number;
    thread_automation_id: number | null;
  }>
>`
  SELECT
    a.id AS automation_id,
    a.user_id,
    a.name,
    t.id AS thread_id,
    t.automation_id AS thread_automation_id
  FROM automations a
  JOIN agent_threads t ON t.user_id = a.user_id AND t.id = a.agent_thread_id
  WHERE t.automation_id IS DISTINCT FROM a.id
  ${userFilter != null ? sql`AND a.user_id = ${userFilter}` : sql``}
  ORDER BY a.user_id, a.id
`;

if (mismatched.length) {
  console.log(`\nLiens incohérents (agent_thread_id ≠ thread.automation_id): ${mismatched.length}\n`);
  for (const r of mismatched) {
    console.log(
      `- auto #${r.automation_id} « ${r.name} » → fil #${r.thread_id} (thread.automation_id=${r.thread_automation_id ?? "NULL"})`,
    );
  }
}

if (process.argv.includes("--delete")) {
  if (!rows.length) {
    console.log("\nRien à supprimer.");
    process.exit(0);
  }
  const { deleteAutomation } = await import("../src/db.js");
  console.log(`\nSuppression de ${rows.length} campagne(s) orpheline(s)…`);
  for (const r of rows) {
    const ok = await deleteAutomation(r.user_id, r.automation_id);
    console.log(ok ? `✓ #${r.automation_id} « ${r.name} » supprimée` : `✗ #${r.automation_id} introuvable`);
  }
}
