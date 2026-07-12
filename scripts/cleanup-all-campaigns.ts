import { sql } from "../src/pg.js";

const sq = await sql`DELETE FROM send_queue WHERE status = 'pending'`;
console.log("send_queue pending supprimés:", sq.count);

const cs = await sql`DELETE FROM contact_sequences`;
console.log("contact_sequences supprimés:", cs.count);

const at = await sql`DELETE FROM automation_targets`;
console.log("automation_targets supprimés:", at.count);

const al = await sql`DELETE FROM automation_logs`;
console.log("automation_logs supprimés:", al.count);

const a = await sql`DELETE FROM automations`;
console.log("automations supprimées:", a.count);

const c = await sql`UPDATE contacts SET auto_reply = 0, updated_at = NOW() WHERE auto_reply = 1`;
console.log("contacts auto_reply remis à 0:", c.count);

await sql.end();
console.log("✅ Nettoyage complet — toutes les campagnes supprimées.");
