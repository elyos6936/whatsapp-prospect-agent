import { getAppSettings, getWhatsAppMessagesSince, isAutoReplyEnabled, listIncomingMessages } from "../src/db.js";
import { sql } from "../src/pg.js";

const s = await getAppSettings();
console.log("=== Settings ===");
console.log({
  evolutionBaseUrl: s.evolution_api_base_url,
  instanceName: s.evolution_instance_name,
  apiKeyPrefix: s.evolution_api_key?.slice(0, 8) + "…",
  autoReplyGlobal: await isAutoReplyEnabled(),
});

console.log("\n=== Recent WhatsApp messages ===");
console.log(await getWhatsAppMessagesSince(0, 15));

console.log("\n=== Incoming only ===");
console.log(await listIncomingMessages({ limit: 15 }));

const [maxId] = await sql<Array<{ m: number; n: number }>>`
  SELECT MAX(id)::int as m, COUNT(*)::int as n FROM messages
`;
console.log("\n=== Stats ===", maxId);
const latest = await sql`SELECT * FROM messages ORDER BY id DESC LIMIT 3`;
console.log("Latest 3:", latest);

await sql.end();
