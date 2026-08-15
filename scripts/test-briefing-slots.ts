/**
 * Checklist briefing uniforme (mémoire + slots).
 * Run: npx tsx scripts/test-briefing-slots.ts
 */
import type { AgentMessage } from "../src/db.js";
import type { CampaignMemory } from "../src/campaign-memory.js";
import { parseMemoryHints } from "../src/campaign-memory.js";
import {
  assessCampaignBriefing,
  BRIEFING_Q_HANDOFF,
  BRIEFING_Q_LAUNCH,
  BRIEFING_Q_OPENER,
  BRIEFING_Q_SCOPE,
  BRIEFING_Q_SUPPORT_VALIDATE,
  BRIEFING_Q_THIRD_PARTY,
  isBriefingSideTalk,
  nextCanonicalBriefingQuestion,
  wantsInboundCatchAll,
} from "../src/campaign-briefing.js";

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

function mem(instructions: string, ownerName = "Will Wanvoesso"): CampaignMemory {
  return {
    id: 1,
    userId: 1,
    name: "Test",
    instructions,
    ownerName,
    introFormula: "",
    tone: "pro",
    toneNote: "",
    formality: "vous",
    stickersEnabled: false,
    emojiLevel: "none",
    sendWindowStart: 9,
    sendWindowEnd: 18,
    isDefault: false,
    createdAt: "",
    updatedAt: "",
  };
}

const BASKETS =
  "- Je me présente comme Will Wanvoesso.\n" +
  "- Ton professionnel, clair et rassurant.\n" +
  "- Je vouvoie les interlocuteurs.\n" +
  "- Pas d'emojis dans les messages.\n" +
  "- Pas de stickers dans les conversations.\n" +
  "- J'envoie uniquement entre 9h et 18h.\n" +
  "- Produit / service : des baskets noirs et rouges marque Nike\n" +
  "- Prix / tarifs : 40000f la paire\n" +
  "- Objectif des conversations : vendre le produit";

const CONSEIL =
  "- Je me présente comme Will Wanvoesso.\n" +
  "- Ton pro. Je vouvoie. Pas d'emojis. Pas de stickers.\n" +
  "- J'envoie uniquement entre 9h et 18h.\n" +
  "- Produit / service : conseil + mise en place clé en main (automatisation no-code) pour freelances.\n" +
  "- objectif = échanger simplement, lancement immédiat, plage 9h-18h.\n" +
  "- lien à partager si intérêt = https://willwvs.pro";

console.log("\n=== parseMemoryHints baskets ===\n");
{
  const h = parseMemoryHints(BASKETS);
  assert(h.coversIdentity, "identité");
  assert(h.coversOffer, "offre");
  assert(h.coversPrice, "prix");
  assert(h.coversGoal, "objectif");
  assert(h.coversWindow, "fenêtre");
  assert(!h.coversLink, "pas de lien baskets");
}

console.log("\n=== Support + mémoire baskets = portée d'abord ===\n");
{
  const memory = mem(BASKETS);
  const hist = [msg("user", "Je veux lancer une campagne")];
  const a = assessCampaignBriefing(hist, "Je veux lancer une campagne", "support", memory);
  assert(a.readyForDraft === false, "pas prêt sans portée");
  assert(
    a.missing.some((m) => /d[eé]clencheur|tous les messages/i.test(m)),
    `missing portée (got ${a.missing.join(" | ")})`
  );
  assert(
    nextCanonicalBriefingQuestion(a, hist, "Je veux lancer une campagne") === BRIEFING_Q_SCOPE,
    "1re question = portée / déclencheurs"
  );
}

console.log("\n=== Support déclencheur → tiers (pas lien/pointure) ===\n");
{
  const memory = mem(BASKETS);
  const hist = [
    msg("user", "Je veux lancer une campagne"),
    msg("assistant", BRIEFING_Q_SCOPE),
    msg("user", "ceux qui disent \"je suis interessé\""),
  ];
  const a = assessCampaignBriefing(hist, 'ceux qui disent "je suis interessé"', "support", memory);
  assert(a.readyForDraft, `ready (missing ${a.missing.join(";")})`);
  assert(!a.missing.some((m) => /URL|lien/i.test(m)), "pas de lien exigé");
  const q = nextCanonicalBriefingQuestion(a, hist, 'ceux qui disent "je suis interessé"');
  assert(q === BRIEFING_Q_THIRD_PARTY, `ensuite notif tiers (got ${q?.slice(0, 60)})`);
}

console.log("\n=== Assistant « lien de paiement » n'impose pas d'URL ===\n");
{
  const memory = mem(BASKETS);
  const hist = [
    msg("user", "Je veux lancer une campagne"),
    msg("assistant", "Tu veux un lien de paiement ou le prix tout de suite ?"),
    msg("user", "Le client va payer à la livraison"),
    msg("assistant", "Tu as un lien à envoyer ?"),
    msg("user", "Qu'il donne son adresse de livraison"),
    msg("user", 'juste ceux qui disent "je suis interessé"'),
  ];
  const a = assessCampaignBriefing(hist, 'juste ceux qui disent "je suis interessé"', "support", memory);
  assert(a.readyForDraft, `ready malgré questions lien assistant (missing ${a.missing.join(";")})`);
  assert(!wantsInboundCatchAll(hist, "ok"), "catch-all assistant ignoré");
}

console.log("\n=== catch-all user puis correction déclencheur ===\n");
{
  const hist = [
    msg("user", "tous mes messages"),
    msg("assistant", "Portée : tous les messages privés du compte"),
    msg("user", "Pour la portée, que ce soit juste ceux qui disent 'je suis interessé'"),
  ];
  assert(
    !wantsInboundCatchAll(hist, "Pour la portée, que ce soit juste ceux qui disent 'je suis interessé'"),
    "la dernière parole user gagne"
  );
}

console.log("\n=== Prospection + mémoire riche → lancement, pas identité ===\n");
{
  const memory = mem(CONSEIL);
  const hist = [msg("user", "Je veux lancer une campagne")];
  const a = assessCampaignBriefing(hist, "Je veux lancer une campagne", "prospection", memory);
  assert(
    !a.missing.some((m) => /présentation/i.test(m)),
    "identité mémoire → pas reposer"
  );
  assert(
    a.missing.some((m) => /lancement/i.test(m)) || a.missing.some((m) => /cible/i.test(m)),
    `lancement ou cible (got ${a.missing.join(" | ")})`
  );
  const q = nextCanonicalBriefingQuestion(a, hist, "Je veux lancer une campagne");
  assert(
    q === BRIEFING_Q_LAUNCH || /contacter/i.test(q ?? ""),
    `lancement ou qui contacter (got ${q?.slice(0, 70)})`
  );
}

console.log("\n=== Après « maintenant » → accroche, pas identité ===\n");
{
  const memory = mem(CONSEIL);
  const hist = [
    msg("user", "Je veux lancer une campagne"),
    msg("assistant", BRIEFING_Q_LAUNCH),
    msg("user", "Les membres du groupe Le Labo du No code"),
    msg("assistant", BRIEFING_Q_LAUNCH),
    msg("user", "Maintenant"),
  ];
  const a = assessCampaignBriefing(hist, "Maintenant", "prospection", memory);
  assert(a.readyForDraft, `ready (missing ${a.missing.join(";")})`);
  assert(
    nextCanonicalBriefingQuestion(a, hist, "Maintenant") === BRIEFING_Q_OPENER,
    "ensuite angle d'accroche"
  );
}

console.log("\n=== Tiers + handoff → je valide ===\n");
{
  const memory = mem(BASKETS);
  const hist = [
    msg("user", 'ceux qui disent "je suis interessé"'),
    msg("assistant", BRIEFING_Q_THIRD_PARTY),
    msg("user", "non"),
    msg("assistant", BRIEFING_Q_HANDOFF),
    msg("user", "non"),
  ];
  const a = assessCampaignBriefing(hist, "non", "support", memory);
  assert(a.readyForDraft, "ready");
  assert(a.thirdPartyQuestionAsked, "tiers posé");
  assert(a.handoffKeywordsQuestionAsked, "handoff posé");
  assert(
    nextCanonicalBriefingQuestion(a, hist, "non") === BRIEFING_Q_SUPPORT_VALIDATE,
    "ensuite je valide → sim"
  );
}

console.log("\n=== aparté ===\n");
{
  assert(isBriefingSideTalk("c'est quoi un déclencheur ?"), "question meta");
  assert(!isBriefingSideTalk("maintenant"), "horaire");
  assert(!isBriefingSideTalk("je valide"), "validation");
  assert(!isBriefingSideTalk("+22966082161"), "téléphone");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
