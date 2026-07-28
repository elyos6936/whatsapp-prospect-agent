import "dotenv/config";
import { sql } from "../src/pg.js";
import { testEvolutionConnection } from "../src/evolutionapi.js";
import { evolutionInstanceName } from "../src/config.js";

const users = await sql<
  { id: number; email: string; onboarding_completed: boolean }[]
>`SELECT id, email, onboarding_completed FROM users ORDER BY id`;

console.log("\n=== ETAT WHATSAPP (Evolution) ===\n");
for (const u of users) {
  if (!u.onboarding_completed) {
    console.log(`#${u.id} ${u.email}: onboarding incomplet — ignoré`);
    continue;
  }
  try {
    const state = await testEvolutionConnection(u.id);
    console.log(
      `#${u.id} ${u.email} [${evolutionInstanceName(u.id)}]: ${state.state} connected=${state.connected}`,
    );
    if (state.message) console.log(`   → ${state.message.slice(0, 100)}`);
  } catch (e) {
    console.log(`#${u.id} ${u.email}: ERREUR ${e instanceof Error ? e.message : e}`);
  }
}

const failed = await sql<
  { id: number; user_id: number; name: string; report: string | null }[]
>`
  SELECT id, user_id, name, stats_json->>'report' AS report
  FROM automations WHERE status = 'failed'
`;
if (failed.length) {
  console.log("\n=== CAMPAGNES FAILED ===");
  for (const f of failed) console.log(`#${f.id} user=${f.user_id} ${f.name}: ${f.report ?? ""}`);
}

await sql.end({ timeout: 5 });
