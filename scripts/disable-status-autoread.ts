/**
 * Désactive la lecture automatique des statuts (et messages) WhatsApp sur
 * TOUS les comptes ayant une instance Evolution configurée.
 *
 * Usage (dans le conteneur) :
 *   docker compose exec klanvio-api npx tsx scripts/disable-status-autoread.ts
 */
import { listUserIds } from "../src/users.js";
import { applyEvolutionInstanceSettings, getEvolutionCredentials } from "../src/evolutionapi.js";
import { sql } from "../src/pg.js";

const userIds = await listUserIds();
let ok = 0;
let skipped = 0;
let failed = 0;

for (const userId of userIds) {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) {
    skipped++;
    continue;
  }
  try {
    await applyEvolutionInstanceSettings(userId);
    ok++;
    console.log(`✅ user ${userId} (${creds.instanceName}) : readStatus/readMessages = false`);
  } catch (err) {
    failed++;
    console.error(`❌ user ${userId} : ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\nTerminé — appliqué: ${ok}, sans instance: ${skipped}, échecs: ${failed}`);
await sql.end();
