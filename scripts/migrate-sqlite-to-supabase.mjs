#!/usr/bin/env node
/**
 * Migre data/agent.db → Supabase Postgres
 *
 * Usage:
 *   npm run db:migrate
 *   DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-supabase.mjs
 */
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const dbPath = path.join(rootDir, "data", "agent.db");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(`
❌ DATABASE_URL manquant.

1. Supabase → Project Settings → Database → Connection string (URI)
2. Mode « Transaction pooler », port 6543
3. Ajoutez dans .env :
   DATABASE_URL=postgresql://postgres.omquaouhfifynvrpqilv:[MOT_DE_PASSE]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres

Puis relancez : npm run db:migrate
`);
  process.exit(1);
}
const sqlite = new DatabaseSync(dbPath);
const pg = postgres(databaseUrl, { max: 1 });

function sqlText(value) {
  if (value == null) return "NULL";
  const str = String(value);
  let tag = "k";
  while (str.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${str}$${tag}$`;
}

function sqlTs(value) {
  if (value == null) return "NULL";
  return `${sqlText(value)}::timestamptz`;
}

function sqlInt(value) {
  if (value == null) return "NULL";
  return String(Number(value));
}

async function runSql(sql) {
  await pg.unsafe(sql);
}

async function runStatements(statements) {
  const chunkSize = 100;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize).join("\n");
    await runSql(chunk);
  }
}

function loadTable(name, selectSql) {
  try {
    return sqlite.prepare(selectSql).all();
  } catch (e) {
    console.log(`⏭️  ${name}: ignoré (${e.message})`);
    return null;
  }
}

console.log("🔄 Migration SQLite → Supabase");
console.log(`   Source: ${dbPath}`);
console.log("   Cible: Supabase (DATABASE_URL)");

const truncateSql = `
DELETE FROM automation_logs;
DELETE FROM automation_targets;
DELETE FROM contact_sequences;
DELETE FROM send_queue;
DELETE FROM group_reply_rules;
DELETE FROM handoff_events;
DELETE FROM scheduled_messages;
DELETE FROM messages;
DELETE FROM agent_conversation;
DELETE FROM contacts;
DELETE FROM automations;
DELETE FROM settings;
`;
await runSql(truncateSql);

const settings = loadTable("settings", "SELECT key, value, updated_at FROM settings");
if (settings?.length) {
  console.log(`📦 settings: ${settings.length} ligne(s)`);
  await runStatements(
    settings.map(
      (r) =>
        `INSERT INTO settings (key, value, updated_at) VALUES (${sqlText(r.key)}, ${sqlText(r.value)}, ${sqlTs(r.updated_at)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;`
    )
  );
}

const agentConversation = loadTable(
  "agent_conversation",
  "SELECT id, role, content, created_at FROM agent_conversation ORDER BY id"
);
if (agentConversation?.length) {
  console.log(`📦 agent_conversation: ${agentConversation.length} ligne(s)`);
  await runStatements(
    agentConversation.map(
      (r) =>
        `INSERT INTO agent_conversation (id, role, content, created_at) VALUES (${sqlInt(r.id)}, ${sqlText(r.role)}, ${sqlText(r.content)}, ${sqlTs(r.created_at)});`
    )
  );
  await runSql(
    "SELECT setval(pg_get_serial_sequence('agent_conversation', 'id'), COALESCE((SELECT MAX(id) FROM agent_conversation), 1));"
  );
}

const messages = loadTable(
  "messages",
  `SELECT id, contact_phone, sender_name, direction, body, green_api_id,
    COALESCE(counts_toward_quota, 1) AS counts_toward_quota, created_at FROM messages ORDER BY id`
);
if (messages?.length) {
  console.log(`📦 messages: ${messages.length} ligne(s)`);
  await runStatements(
    messages.map(
      (r) =>
        `INSERT INTO messages (id, contact_phone, sender_name, direction, body, green_api_id, counts_toward_quota, created_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.contact_phone)}, ${sqlText(r.sender_name)}, ${sqlText(r.direction)}, ${sqlText(r.body)}, ${sqlText(r.green_api_id)}, ${sqlInt(r.counts_toward_quota)}, ${sqlTs(r.created_at)})
         ON CONFLICT (green_api_id) DO NOTHING;`
    )
  );
  await runSql(
    "SELECT setval(pg_get_serial_sequence('messages', 'id'), COALESCE((SELECT MAX(id) FROM messages), 1));"
  );
}

const contacts = loadTable(
  "contacts",
  `SELECT id, phone, name, notes, status, auto_reply, COALESCE(lead_score,0) AS lead_score,
    memory_summary, memory_updated_at, handoff_status, whatsapp_lid, created_at,
    COALESCE(updated_at, created_at) AS updated_at FROM contacts ORDER BY id`
);
if (contacts?.length) {
  console.log(`📦 contacts: ${contacts.length} ligne(s)`);
  await runStatements(
    contacts.map(
      (r) =>
        `INSERT INTO contacts (id, phone, name, notes, status, auto_reply, lead_score, memory_summary,
          memory_updated_at, handoff_status, whatsapp_lid, created_at, updated_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.phone)}, ${sqlText(r.name)}, ${sqlText(r.notes)}, ${sqlText(r.status)}, ${sqlInt(r.auto_reply)}, ${sqlInt(r.lead_score)},
          ${sqlText(r.memory_summary)}, ${sqlTs(r.memory_updated_at)}, ${sqlText(r.handoff_status)}, ${sqlText(r.whatsapp_lid)},
          ${sqlTs(r.created_at)}, ${sqlTs(r.updated_at)})
         ON CONFLICT (phone) DO UPDATE SET
          name = EXCLUDED.name, notes = EXCLUDED.notes, status = EXCLUDED.status,
          auto_reply = EXCLUDED.auto_reply, updated_at = EXCLUDED.updated_at;`
    )
  );
  await runSql(
    "SELECT setval(pg_get_serial_sequence('contacts', 'id'), COALESCE((SELECT MAX(id) FROM contacts), 1));"
  );
}

const automations = loadTable(
  "automations",
  "SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at FROM automations ORDER BY id"
);
if (automations?.length) {
  console.log(`📦 automations: ${automations.length} ligne(s)`);
  await runStatements(
    automations.map(
      (r) =>
        `INSERT INTO automations (id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.name)}, ${sqlText(r.type)}, ${sqlText(r.status)}, ${sqlText(r.config_json)}, ${sqlText(r.stats_json)}, ${sqlText(r.summary)}, ${sqlInt(r.budget_fcfa)}, ${sqlTs(r.created_at)}, ${sqlTs(r.updated_at)});`
    )
  );
  await runSql(
    "SELECT setval(pg_get_serial_sequence('automations', 'id'), COALESCE((SELECT MAX(id) FROM automations), 1));"
  );
}

const scheduled = loadTable("scheduled_messages", "SELECT * FROM scheduled_messages ORDER BY id");
if (scheduled?.length) {
  console.log(`📦 scheduled_messages: ${scheduled.length} ligne(s)`);
  await runStatements(
    scheduled.map(
      (r) =>
        `INSERT INTO scheduled_messages (id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.recipient)}, ${sqlText(r.recipient_label)}, ${sqlText(r.message)}, ${sqlTs(r.send_at)}, ${sqlText(r.status)}, ${sqlText(r.error)}, ${sqlTs(r.created_at)}, ${sqlTs(r.sent_at)});`
    )
  );
}

const targets = loadTable("automation_targets", "SELECT * FROM automation_targets ORDER BY id");
if (targets?.length) {
  console.log(`📦 automation_targets: ${targets.length} ligne(s)`);
  await runStatements(
    targets.map(
      (r) =>
        `INSERT INTO automation_targets (id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at)
         VALUES (${sqlInt(r.id)}, ${sqlInt(r.automation_id)}, ${sqlText(r.target_id)}, ${sqlText(r.target_label)}, ${sqlText(r.status)}, ${sqlTs(r.last_action_at)}, ${sqlText(r.notes)}, ${sqlText(r.ab_variant)}, ${sqlTs(r.created_at)});`
    )
  );
}

const logs = loadTable("automation_logs", "SELECT * FROM automation_logs ORDER BY id");
if (logs?.length) {
  console.log(`📦 automation_logs: ${logs.length} ligne(s)`);
  await runStatements(
    logs.map(
      (r) =>
        `INSERT INTO automation_logs (id, automation_id, level, message, created_at)
         VALUES (${sqlInt(r.id)}, ${sqlInt(r.automation_id)}, ${sqlText(r.level)}, ${sqlText(r.message)}, ${sqlTs(r.created_at)});`
    )
  );
}

const queue = loadTable("send_queue", "SELECT * FROM send_queue ORDER BY id");
if (queue?.length) {
  console.log(`📦 send_queue: ${queue.length} ligne(s)`);
  await runStatements(
    queue.map(
      (r) =>
        `INSERT INTO send_queue (id, recipient, recipient_label, message, media_url, media_type, priority, send_at, status, automation_id, sequence_id, ab_variant, error, created_at, sent_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.recipient)}, ${sqlText(r.recipient_label)}, ${sqlText(r.message)}, ${sqlText(r.media_url)}, ${sqlText(r.media_type)}, ${sqlInt(r.priority)}, ${sqlTs(r.send_at)}, ${sqlText(r.status)}, ${sqlInt(r.automation_id)}, ${sqlInt(r.sequence_id)}, ${sqlText(r.ab_variant)}, ${sqlText(r.error)}, ${sqlTs(r.created_at)}, ${sqlTs(r.sent_at)});`
    )
  );
}

const handoffs = loadTable("handoff_events", "SELECT * FROM handoff_events ORDER BY id");
if (handoffs?.length) {
  console.log(`📦 handoff_events: ${handoffs.length} ligne(s)`);
  await runStatements(
    handoffs.map(
      (r) =>
        `INSERT INTO handoff_events (id, contact_phone, contact_name, reason, summary, suggested_reply, status, created_at, resolved_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.contact_phone)}, ${sqlText(r.contact_name)}, ${sqlText(r.reason)}, ${sqlText(r.summary)}, ${sqlText(r.suggested_reply)}, ${sqlText(r.status)}, ${sqlTs(r.created_at)}, ${sqlTs(r.resolved_at)});`
    )
  );
}

const groupRules = loadTable("group_reply_rules", "SELECT * FROM group_reply_rules ORDER BY id");
if (groupRules?.length) {
  console.log(`📦 group_reply_rules: ${groupRules.length} ligne(s)`);
  await runStatements(
    groupRules.map(
      (r) =>
        `INSERT INTO group_reply_rules (id, group_id, group_label, keywords_json, reply_guide, automation_id, status, created_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.group_id)}, ${sqlText(r.group_label)}, ${sqlText(r.keywords_json)}, ${sqlText(r.reply_guide)}, ${sqlInt(r.automation_id)}, ${sqlText(r.status)}, ${sqlTs(r.created_at)});`
    )
  );
}

const sequences = loadTable("contact_sequences", "SELECT * FROM contact_sequences ORDER BY id");
if (sequences?.length) {
  console.log(`📦 contact_sequences: ${sequences.length} ligne(s)`);
  await runStatements(
    sequences.map(
      (r) =>
        `INSERT INTO contact_sequences (id, contact_phone, automation_id, name, steps_json, current_step, status, next_step_at, created_at)
         VALUES (${sqlInt(r.id)}, ${sqlText(r.contact_phone)}, ${sqlInt(r.automation_id)}, ${sqlText(r.name)}, ${sqlText(r.steps_json)}, ${sqlInt(r.current_step)}, ${sqlText(r.status)}, ${sqlTs(r.next_step_at)}, ${sqlTs(r.created_at)});`
    )
  );
}

const countSql = `
SELECT
  (SELECT COUNT(*)::int FROM settings) AS settings,
  (SELECT COUNT(*)::int FROM contacts) AS contacts,
  (SELECT COUNT(*)::int FROM messages) AS messages,
  (SELECT COUNT(*)::int FROM agent_conversation) AS agent_conversation,
  (SELECT COUNT(*)::int FROM automations) AS automations;
`;

const counts = await pg.unsafe(countSql);
console.log("✅ Migration terminée:", counts[0]);
await pg.end();
