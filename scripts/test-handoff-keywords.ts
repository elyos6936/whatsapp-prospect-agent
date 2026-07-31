/**
 * Tests mots-clés handoff + détection question briefing.
 * Run: npx tsx scripts/test-handoff-keywords.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  assessCampaignBriefing,
  hasHandoffKeywordsQuestionAsked,
} from "../src/campaign-briefing.js";
import { findMatchingHandoffKeyword } from "../src/handoff.js";

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

function msg(role: AgentMessage["role"], content: string): AgentMessage {
  return { id: 0, role, content, created_at: new Date().toISOString() };
}

console.log("\n=== A. Matching mots-clés ===\n");
assert(
  findMatchingHandoffKeyword("Je veux un remboursement s'il vous plaît", [
    "remboursement",
    "plainte",
  ]) === "remboursement",
  "match remboursement",
);
assert(
  findMatchingHandoffKeyword("Bonjour, parler à un humain svp", [
    "parler à un humain",
  ]) === "parler à un humain",
  "match phrase multi-mots",
);
assert(
  findMatchingHandoffKeyword("Combien ça coûte ?", ["remboursement", "plainte"]) === null,
  "pas de faux positif",
);
assert(findMatchingHandoffKeyword("plainte", []) === null, "liste vide → null");
assert(findMatchingHandoffKeyword("plainte", undefined) === null, "undefined → null");
assert(
  findMatchingHandoffKeyword("Remboursement urgent", ["Remboursement"]) === "Remboursement",
  "casse / accents",
);

console.log("\n=== B. Briefing question handoff ===\n");
const ask =
  "Y a-t-il des mots ou phrases pour lesquels je dois arrêter de répondre et te passer la main (ex. remboursement) ?";
assert(hasHandoffKeywordsQuestionAsked([msg("assistant", ask)]), "détecte question handoff");
assert(
  !hasHandoffKeywordsQuestionAsked([
    msg("assistant", "Tu veux des stickers dans les conversations ?"),
  ]),
  "ne confond pas avec stickers",
);

const hist: AgentMessage[] = [
  msg("user", "Je veux gérer mon support client WhatsApp"),
  msg("assistant", "Quel produit ?"),
  msg("user", "Crème visage 5000 FCFA, déclencheur « je suis intéressé », objectif vente"),
  msg("assistant", "Ok. Lien paiement https://pay.example.com"),
  msg("user", "Présente-toi comme Marie, pas de stickers"),
  msg(
    "assistant",
    "Tu veux que j'ajoute des stickers dans les conversations avec les prospects ?",
  ),
  msg("user", "non"),
  msg(
    "assistant",
    "Quand un prospect convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?",
  ),
  msg("user", "non"),
];

const a1 = assessCampaignBriefing(hist, "ok", "support");
assert(a1.thirdPartyQuestionAsked, "tiers demandé");
assert(!a1.handoffKeywordsQuestionAsked, "handoff pas encore demandé");
assert(
  a1.stickersQuestionAsked && a1.thirdPartyQuestionAsked,
  "stickers + tiers avant handoff",
);

const a2 = assessCampaignBriefing(
  [...hist, msg("assistant", ask)],
  "remboursement, plainte",
  "support",
);
assert(a2.handoffKeywordsQuestionAsked, "handoff demandé après question");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
