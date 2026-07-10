import { db, getAppSettings, getWhatsAppMessagesSince, isAutoReplyEnabled, listIncomingMessages } from "../src/db.js";

const s = getAppSettings();
console.log("=== Settings ===");
console.log({
  idInstance: s.green_api_id_instance,
  baseUrl: s.green_api_base_url,
  tokenPrefix: s.green_api_token?.slice(0, 12) + "…",
  autoReplyGlobal: isAutoReplyEnabled(),
});

console.log("\n=== Recent WhatsApp messages ===");
console.log(getWhatsAppMessagesSince(0, 15));

console.log("\n=== Incoming only ===");
console.log(listIncomingMessages({ limit: 15 }));

const maxId = db.prepare("SELECT MAX(id) as m, COUNT(*) as n FROM messages").get() as { m: number; n: number };
console.log("\n=== Stats ===", maxId);
const latest = db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 3").all();
console.log("Latest 3:", latest);
