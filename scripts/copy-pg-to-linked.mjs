/**
 * Copy public table data: OLD_DATABASE_URL → DATABASE_URL (new project).
 * Usage: node scripts/copy-pg-to-linked.mjs
 * Optional: COPY_TABLES=messages,send_queue
 */
import "dotenv/config";
import postgres from "postgres";

const oldUrl = (process.env.OLD_DATABASE_URL || "").trim();
const newUrl = (process.env.DATABASE_URL || "").trim();
if (!oldUrl || !newUrl) {
  console.error("OLD_DATABASE_URL et DATABASE_URL requis");
  process.exit(1);
}
if (oldUrl === newUrl) {
  console.error("OLD_DATABASE_URL et DATABASE_URL sont identiques — abort.");
  process.exit(1);
}

const ALL_TABLES = [
  "users",
  "settings",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "automations",
  "automation_targets",
  "automation_logs",
  "campaign_memories",
  "agent_threads",
  "agent_conversation",
  "contacts",
  "messages",
  "contact_automation_state",
  "contact_sequences",
  "send_queue",
  "scheduled_messages",
  "group_reply_rules",
  "handoff_events",
  "user_integrations",
  "user_connected_sheets",
  "google_contacts_ensured",
  "oauth_pending_states",
  "admin_audit_log",
  "billing_payments",
  "whatsapp_phone_bindings",
];
const TABLES = process.env.COPY_TABLES
  ? process.env.COPY_TABLES.split(",").map((t) => t.trim()).filter(Boolean)
  : ALL_TABLES;

function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v instanceof Date) return `'${v.toISOString().replace(/'/g, "''")}'`;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
    return `'\\x${v.toString("hex")}'`;
  }
  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

const oldSql = postgres(oldUrl, { max: 1, prepare: false, ssl: "require" });
const newSql = postgres(newUrl, { max: 1, prepare: false, ssl: "require" });

try {
  console.log("Lecture colonnes cible…");
  const colRows = await newSql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `;
  const targetColsByTable = new Map();
  for (const r of colRows) {
    const t = r.table_name;
    if (!targetColsByTable.has(t)) targetColsByTable.set(t, new Set());
    targetColsByTable.get(t).add(r.column_name);
  }
  console.log(`  ${targetColsByTable.size} tables cibles`);
  if (targetColsByTable.size < 5) {
    throw new Error(`Trop peu de tables cibles (${targetColsByTable.size})`);
  }

  console.log("Lecture ancienne DB…");
  const existing = [];
  for (const table of TABLES) {
    try {
      const rows = await oldSql.unsafe(`SELECT * FROM ${table}`);
      if (!rows.length) {
        console.log(`  ${table}: 0`);
        continue;
      }
      const allowed = targetColsByTable.get(table);
      if (!allowed || !allowed.size) {
        console.warn(`  ${table}: skip (absente côté cible)`);
        continue;
      }
      const filtered = rows.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          if (allowed.has(k)) out[k] = v;
        }
        return out;
      });
      existing.push({ table, rows: filtered });
      console.log(`  ${table}: ${rows.length} (cols ${Object.keys(filtered[0] || {}).length})`);
    } catch (e) {
      console.warn(`  ${table}: skip (${e instanceof Error ? e.message : e})`);
    }
  }

  for (const { table, rows } of existing) {
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const values = chunk
        .map((row) => `(${cols.map((c) => sqlLiteral(row[c])).join(", ")})`)
        .join(",\n");
      const insert = `INSERT INTO ${table} (${colList}) OVERRIDING SYSTEM VALUE VALUES\n${values}\nON CONFLICT DO NOTHING;`;
      process.stdout.write(`  → ${table} ${i + 1}-${i + chunk.length}… `);
      await newSql.unsafe(insert);
      console.log("ok");
    }
  }

  for (const t of TABLES) {
    await newSql.unsafe(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${t}' AND column_name = 'id'
  ) THEN
    PERFORM setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1), true);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;`);
  }

  console.log("Comptes old vs new…");
  for (const t of TABLES) {
    try {
      const [{ c: o }] = await oldSql.unsafe(`SELECT COUNT(*)::int AS c FROM ${t}`);
      const [{ c: n }] = await newSql.unsafe(`SELECT COUNT(*)::int AS c FROM ${t}`);
      const mark = o === n ? "OK" : "DIFF";
      console.log(`  ${t}: old=${o} new=${n} [${mark}]`);
    } catch {
      /* skip missing */
    }
  }

  console.log("✅ Copie terminée.");
} catch (err) {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await Promise.all([oldSql.end({ timeout: 5 }), newSql.end({ timeout: 5 })]);
}
