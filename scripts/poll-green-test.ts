/**
 * Écoute receiveNotification pendant ~35s et affiche tout type de webhook reçu.
 * Usage: npx tsx scripts/poll-green-test.ts
 */
import { getGreenApiCredentials } from "../src/greenapi.js";

const creds = getGreenApiCredentials();
if (!creds) {
  console.error("Green-API non configuré dans SQLite");
  process.exit(1);
}

function url(method: string, suffix = "") {
  return `${creds.baseUrl}/waInstance${creds.idInstance}/${method}/${creds.apiToken}${suffix}`;
}

async function receiveOnce(label: string) {
  const t0 = Date.now();
  const res = await fetch(url("receiveNotification"), { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  const ms = Date.now() - t0;
  console.log(`\n[${label}] HTTP ${res.status} (${ms}ms)`);
  if (!text || text === "null") {
    console.log("  → null (aucune notification en file)");
    return null;
  }
  try {
    const data = JSON.parse(text);
    console.log("  →", JSON.stringify(data, null, 2).slice(0, 2000));
    if (data.receiptId) {
      await fetch(url("deleteNotification", `/${data.receiptId}`), { method: "DELETE" });
      console.log(`  → deleteNotification ${data.receiptId} OK`);
    }
    return data;
  } catch {
    console.log("  → raw:", text.slice(0, 500));
    return null;
  }
}

console.log("Instance:", creds.idInstance, "| Base:", creds.baseUrl);
console.log("Envoyez un message WhatsApp MAINTENANT vers ce numéro…");
console.log("(écoute 3 requêtes receiveNotification, ~30s chacune max)\n");

for (let i = 1; i <= 3; i++) {
  await receiveOnce(`poll ${i}/3`);
}

console.log("\nTerminé.");
