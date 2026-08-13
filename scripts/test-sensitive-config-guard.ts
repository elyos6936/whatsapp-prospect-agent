/**
 * Vague 3 — garde config sensible / profil / mémoire (générique).
 * Run: npx tsx scripts/test-sensitive-config-guard.ts
 */
import {
  criticalConfigDiff,
  criticalConfigSnapshot,
  filterCriticalConfigArgs,
  filterInventedProfileFields,
  recentUserBlob,
  userAllowsMemorySwitch,
  userMentionedClosingLink,
  userMentionedPrice,
} from "../src/sensitive-config-guard.js";
import type { AgentMessage } from "../src/db.js";

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

function am(role: AgentMessage["role"], content: string): AgentMessage {
  return { id: 0, role, content, created_at: "" };
}

console.log("\n=== Tours user récents ===\n");
assert(
  recentUserBlob(
    [am("user", "salut"), am("assistant", "ok"), am("user", "le prix c'est 25000")],
    2
  ).includes("25000"),
  "blob = 2 derniers user"
);

console.log("\n=== update_automation_config : D ciblé ===\n");
{
  const silent = filterCriticalConfigArgs(
    { automation_id: 1, price: "99 000 FCFA", stickers_enabled: true },
    "change les stickers"
  );
  assert(silent.blocked.includes("price"), "prix sans évocation → retiré");
  assert(silent.args.stickers_enabled === true, "stickers conservés");
  assert(silent.args.price == null, "clé price absente");
}

{
  const ok = filterCriticalConfigArgs(
    { automation_id: 1, price: "25 000 FCFA" },
    "le prix c'est 25 000 FCFA"
  );
  assert(ok.blocked.length === 0, "prix évoqué → accepté");
  assert(ok.args.price === "25 000 FCFA", "price conservé");
}

{
  const link = filterCriticalConfigArgs(
    { automation_id: 1, closing_link: "https://pay.example.com/x" },
    "mets le lien https://pay.example.com/x"
  );
  assert(link.blocked.length === 0, "lien évoqué → accepté");
  const silentLink = filterCriticalConfigArgs(
    { automation_id: 1, closing_link: "https://evil.test" },
    "change le ton"
  );
  assert(silentLink.blocked.includes("closing_link"), "lien silencieux → retiré");
}

{
  const goal = filterCriticalConfigArgs(
    { automation_id: 1, closing_goal: "delivery" },
    "objectif livraison"
  );
  assert(goal.blocked.length === 0, "objectif évoqué → accepté");
}

{
  const phone = filterCriticalConfigArgs(
    { automation_id: 1, third_party_phone: "+22900000000" },
    "préviens le livreur au +22900000000"
  );
  assert(phone.blocked.length === 0, "tiers évoqué → accepté");
  const silentPhone = filterCriticalConfigArgs(
    { automation_id: 1, third_party_phone: "+22900000000" },
    "ok nickel"
  );
  assert(silentPhone.blocked.includes("third_party_phone"), "tiers silencieux → retiré");
}

assert(userMentionedPrice("c'est 40 000 fcfa"), "détecte prix");
assert(userMentionedClosingLink("voici le lien calendly"), "détecte lien");

console.log("\n=== Diff / note ===\n");
{
  const before = criticalConfigSnapshot({ price: "10", closingLink: "", closingGoal: "link" });
  const after = criticalConfigSnapshot({
    price: "25 000 FCFA",
    closingLink: "https://pay.example.com",
    closingGoal: "link",
  });
  const diffs = criticalConfigDiff(before, after);
  assert(diffs.some((d) => d.field === "price"), "diff prix");
  assert(diffs.some((d) => d.field === "closing_link"), "diff lien");
  assert(!diffs.some((d) => d.field === "closing_goal"), "objectif inchangé omis");
}

console.log("\n=== set_campaign_memory ===\n");
assert(
  userAllowsMemorySwitch("utilise la mémoire Support chaleureux", "Support chaleureux"),
  "mémoire + nom → OK"
);
assert(userAllowsMemorySwitch("passe sur Support chaleureux", "Support chaleureux"), "nom seul → OK");
assert(userAllowsMemorySwitch("change de mémoire", "Support chaleureux"), "mot mémoire → OK");
assert(
  !userAllowsMemorySwitch("ok continue", "Support chaleureux"),
  "switch silencieux → bloqué"
);

console.log("\n=== save_business_profile : invention ===\n");
{
  const invented = filterInventedProfileFields(
    { ownerName: "Jean", price: "99 000 FCFA" },
    "ok continue le briefing"
  );
  assert(invented.blocked.includes("owner_name"), "nom inventé bloqué");
  assert(invented.blocked.includes("price"), "prix inventé bloqué");
}

{
  const given = filterInventedProfileFields(
    { ownerName: "Alex", price: "25 000 FCFA", offer: "Masterclass" },
    "je m'appelle Alex, le prix c'est 25 000 FCFA, offre masterclass"
  );
  assert(given.blocked.length === 0, "valeurs présentes dans le fil → OK");
}

{
  const mixed = filterInventedProfileFields(
    { ownerName: "Alex", price: "99 000 FCFA" },
    "je m'appelle Alex"
  );
  assert(!mixed.blocked.includes("owner_name"), "nom donné → OK");
  assert(mixed.blocked.includes("price"), "prix inventé à côté → bloqué");
  assert(mixed.input.ownerName === "Alex", "nom conservé");
}

console.log("\n=== Non-régression fenêtre / je valide ===\n");
{
  const win = filterCriticalConfigArgs(
    { automation_id: 1, send_window_start: 8, send_window_end: 19 },
    "change 8h–19h"
  );
  assert(win.blocked.length === 0, "fenêtre seule → pas de garde critique");
  assert(win.args.send_window_start === 8, "send_window conservé");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
