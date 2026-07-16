/**
 * Nettoyage : conversations agent + messages WhatsApp + numéros prospectés.
 * Conserve : users, settings, JWT / clés API.
 *
 * Usage : npx tsx scripts/cleanup-conversations-and-prospects.ts
 */
import "dotenv/config";
import { sql } from "../src/pg.js";

async function main() {
  console.log("🧹 Nettoyage conversations + prospects…");

  const pending = await sql`DELETE FROM send_queue`;
  console.log("  send_queue:", pending.count);

  const seq = await sql`DELETE FROM contact_sequences`;
  console.log("  contact_sequences:", seq.count);

  const targets = await sql`DELETE FROM automation_targets`;
  console.log("  automation_targets:", targets.count);

  const logs = await sql`DELETE FROM automation_logs`;
  console.log("  automation_logs:", logs.count);

  const handoffs = await sql`DELETE FROM handoff_events`.catch(() => ({ count: 0 }));
  console.log("  handoff_events:", handoffs.count);

  const scheduled = await sql`DELETE FROM scheduled_messages`.catch(() => ({ count: 0 }));
  console.log("  scheduled_messages:", scheduled.count);

  const msgs = await sql`DELETE FROM messages`;
  console.log("  messages (conversations WhatsApp):", msgs.count);

  const agent = await sql`DELETE FROM agent_conversation`;
  console.log("  agent_conversation:", agent.count);

  // Délier campagnes ↔ fils avant reset
  await sql`UPDATE automations SET agent_thread_id = NULL WHERE agent_thread_id IS NOT NULL`.catch(() => {});
  await sql`UPDATE agent_threads SET automation_id = NULL WHERE automation_id IS NOT NULL`.catch(() => {});

  const contacts = await sql`DELETE FROM contacts`;
  console.log("  contacts (numéros prospectés):", contacts.count);

  // Remettre les fils agent à vide (titres par défaut)
  const threads = await sql`
    UPDATE agent_threads
    SET title = 'Automatisation', updated_at = NOW()
  `.catch(() => ({ count: 0 }));
  console.log("  agent_threads réinitialisés:", threads.count);

  // Stats campagnes remises à zéro (on garde les brouillons / configs)
  const autos = await sql`
    UPDATE automations
    SET stats = '{}'::jsonb, updated_at = NOW()
  `.catch(async () => {
    // fallback si stats n'est pas jsonb
    return sql`UPDATE automations SET updated_at = NOW()`;
  });
  console.log("  automations stats reset:", autos.count);

  console.log("✅ Terminé — conversations et numéros prospectés effacés.");
  console.log("   (Comptes utilisateurs et réglages conservés.)");
}

main()
  .catch((err) => {
    console.error("❌", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
