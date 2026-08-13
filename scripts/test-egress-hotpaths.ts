/**
 * Filets egress : fraîcheur webhook (pas de sync historique si le webhook vit).
 * Run: npx tsx scripts/test-egress-hotpaths.ts
 */
import { webhookIsFresh, WEBHOOK_FRESH_MS } from "../src/notifications.js";

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

console.log("\n=== Webhook frais → skip poller historique ===\n");
const now = Date.now();
assert(!webhookIsFresh(null, now), "jamais de webhook → filet poller");
assert(!webhookIsFresh("", now), "vide → filet poller");
assert(
  webhookIsFresh(new Date(now - 10_000).toISOString(), now),
  "webhook il y a 10s → skip historique"
);
assert(
  !webhookIsFresh(new Date(now - WEBHOOK_FRESH_MS - 5_000).toISOString(), now),
  "webhook trop vieux → poller reprend"
);
assert(WEBHOOK_FRESH_MS === 120_000, "fenêtre 2 min");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
