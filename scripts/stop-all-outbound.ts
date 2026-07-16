/**
 * Stop d'urgence global : pause toutes les campagnes actives,
 * vide la file d'envoi, coupe l'auto-reply (tous les utilisateurs).
 *
 * Usage : npx tsx scripts/stop-all-outbound.ts
 */
import "dotenv/config";
import { sql } from "../src/pg.js";
import {
  cancelPendingSendQueue,
  pauseAllActiveAutomations,
  setAutoReplyEnabled,
} from "../src/db.js";

async function main() {
  const users = await sql<{ id: number; email: string }[]>`
    SELECT id, email FROM users ORDER BY id
  `;
  console.log(`Utilisateurs: ${users.length}`);

  let paused = 0;
  let cancelled = 0;

  for (const u of users) {
    const p = await pauseAllActiveAutomations(u.id);
    const c = await cancelPendingSendQueue(u.id);
    await setAutoReplyEnabled(u.id, false);
    paused += p;
    cancelled += c;
    if (p || c) {
      console.log(`  user #${u.id} ${u.email}: paused=${p} queue_cancelled=${c}`);
    }
  }

  const seq = await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
    WHERE status = 'active'
  `;
  const contacts = await sql`
    UPDATE contacts SET auto_reply = 0, updated_at = NOW() WHERE auto_reply = 1
  `;
  const queueLeft = await sql`
    UPDATE send_queue SET status = 'cancelled', error = 'Stop global'
    WHERE status IN ('pending', 'processing')
  `;
  const activeLeft = await sql`
    UPDATE automations SET status = 'paused', updated_at = NOW()
    WHERE status = 'active'
  `;

  console.log(
    JSON.stringify(
      {
        users: users.length,
        pausedViaApi: paused,
        queueCancelledViaApi: cancelled,
        sequencesCancelled: seq.count,
        contactsAutoReplyOff: contacts.count,
        queueForceCancelled: queueLeft.count,
        automationsForcePaused: activeLeft.count,
      },
      null,
      2
    )
  );
  console.log("✅ Aucun envoi campagne / auto-reply ne doit plus partir.");
}

main()
  .catch((err) => {
    console.error("❌", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
