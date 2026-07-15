/**
 * Diagnostic auto-reply Klanvio.
 * Usage: npx tsx scripts/verify-auto-reply.ts [userId]
 * Requiert DATABASE_URL dans .env (ou l'environnement).
 */
import "dotenv/config";
import { sql } from "../src/pg.js";
import { isAutoReplyEnabled, listActiveAutomations, listAutomationTargets } from "../src/db.js";
import { passesReplyGate } from "../src/campaign-gating.js";
import { chatIdsMatch } from "../src/evolutionapi.js";

const userIdArg = Number(process.argv[2]);

async function listUserIds(): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM users ORDER BY id`;
  return rows.map((r) => Number(r.id));
}

async function diagnoseUser(userId: number): Promise<void> {
  console.log(`\n━━━ Utilisateur #${userId} ━━━`);

  const globalOn = await isAutoReplyEnabled(userId);
  console.log(`  Auto-reply global : ${globalOn ? "✅ ON" : "❌ OFF"}`);

  const campaigns = await listActiveAutomations(userId);
  console.log(`  Campagnes actives : ${campaigns.length}`);
  for (const c of campaigns) {
    const targets = await listAutomationTargets(userId, c.id, { limit: 5000 });
    const activeTargets = targets.filter((t) => !["stopped", "error"].includes(t.status));
    console.log(
      `    • #${c.id} « ${c.name} » (${c.type}) — ${activeTargets.length} cible(s), enableAutoReply=${c.config.enableAutoReply !== false ? "ON" : "OFF"}`
    );
  }

  const pending = await sql<
    { id: number; contact_phone: string; body: string; sender_name: string | null; created_at: string }[]
  >`
    SELECT m.id, m.contact_phone, LEFT(m.body, 80) as body, m.sender_name, m.created_at::text
    FROM messages m
    WHERE m.user_id = ${userId}
      AND m.direction = 'entrant'
      AND m.created_at >= NOW() - INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM messages o
        WHERE o.user_id = m.user_id
          AND o.direction = 'sortant'
          AND o.id > m.id
          AND o.contact_phone = m.contact_phone
      )
    ORDER BY m.id DESC
    LIMIT 10
  `;

  if (pending.length === 0) {
    console.log("  Messages entrants sans réponse (48h) : aucun");
  } else {
    console.log(`  Messages entrants sans réponse (48h) : ${pending.length}`);
    for (const m of pending) {
      const gate = await passesReplyGate(userId, m.contact_phone, m.body);
      const flag = gate.allow ? "✅ éligible" : `❌ bloqué (${gate.reason})`;
      console.log(`    - [${m.created_at}] ${m.sender_name ?? m.contact_phone} : ${flag}`);
      console.log(`      « ${m.body} »`);
    }
  }

  const lidContacts = await sql<{ phone: string; whatsapp_lid: string | null }[]>`
    SELECT phone, whatsapp_lid FROM contacts
    WHERE user_id = ${userId} AND whatsapp_lid IS NOT NULL
    LIMIT 5
  `;
  console.log(`  Mappings LID↔téléphone : ${lidContacts.length} (échantillon)`);
  for (const c of lidContacts) {
    console.log(`    ${c.phone} ↔ ${c.whatsapp_lid}`);
  }
}

async function runStaticChecks(): Promise<void> {
  console.log("━━━ Tests logiques (statiques) ━━━");
  const pairs: Array<[string, string, boolean]> = [
    ["22997123456@c.us", "22997123456@c.us", true],
    ["22997123456@c.us", "22997123456", true],
    ["123456789@lid", "987654321@lid", false],
  ];
  for (const [a, b, expected] of pairs) {
    const got = chatIdsMatch(a, b);
    const ok = got === expected;
    console.log(`  chatIdsMatch(${a}, ${b}) = ${got} ${ok ? "✅" : "❌ attendu " + expected}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("❌ DATABASE_URL manquant — copiez .env.example vers .env ou exportez la variable.");
    process.exit(1);
  }

  await runStaticChecks();

  const userIds = Number.isFinite(userIdArg) && userIdArg > 0 ? [userIdArg] : await listUserIds();
  if (userIds.length === 0) {
    console.log("\nAucun utilisateur en base.");
    return;
  }

  for (const id of userIds) {
    await diagnoseUser(id);
  }

  console.log("\n━━━ Protocole test manuel ━━━");
  console.log("1. Paramètres → Réponses automatiques = ON");
  console.log("2. Campagne prospect = active (pas en pause)");
  console.log("3. Depuis un numéro cible, répondre au message de campagne");
  console.log("4. Attendre 4–20 s → une réponse IA doit partir sans demander à l'agent");
  console.log("5. Si rien : POST /api/settings/reprocess-auto-replies (connecté)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
