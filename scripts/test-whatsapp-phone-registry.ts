/**
 * Tests purs registre WhatsApp (sans DB).
 * Run: npx tsx scripts/test-whatsapp-phone-registry.ts
 */
import {
  normalizeBindingPhone,
  WHATSAPP_PHONE_CONFLICT_MESSAGE,
} from "../src/whatsapp-phone-registry.js";
import { whatsappPhonesMatch } from "../src/evolutionapi.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log("\n=== WhatsApp phone registry helpers ===\n");
assert(normalizeBindingPhone("+229 01 23 45 67 89") === "2290123456789", "normalize spaces");
assert(normalizeBindingPhone("2290123456789@s.whatsapp.net") === "2290123456789", "normalize jid");
assert(whatsappPhonesMatch("2290123456789", "0123456789"), "suffix match");
assert(!whatsappPhonesMatch("229011111111", "229022222222"), "different numbers");
assert(WHATSAPP_PHONE_CONFLICT_MESSAGE.includes("même après déconnexion"), "conflict copy");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
