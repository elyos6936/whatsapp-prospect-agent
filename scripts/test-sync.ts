import { syncIncomingFromHistory } from "../src/notifications.js";
import { getWhatsAppMessagesSince } from "../src/db.js";

const before = getWhatsAppMessagesSince(0, 500).filter((m) => m.direction === "entrant").length;
const added = await syncIncomingFromHistory();
const after = getWhatsAppMessagesSince(0, 500).filter((m) => m.direction === "entrant").length;
const latest = getWhatsAppMessagesSince(0, 500).slice(-5);

console.log({ added, entrantBefore: before, entrantAfter: after });
console.log("Latest 5:", latest.map((m) => ({ id: m.id, dir: m.direction, body: m.body.slice(0, 50) })));
