/**
 * Vague 4.2 — pause-first (rail seulement si looksLikeRailAdvance).
 * Run: npx tsx scripts/test-turn-kind.ts
 */
import { isBriefingSideTalk, BRIEFING_Q_LAUNCH } from "../src/campaign-briefing.js";
import { isExplicitSendNow, allowsManualSend } from "../src/high-stakes-intent.js";
import {
  buildScenarioPauseNudge,
  classifyBriefingTurn,
  isParallelGroupExtract,
  isParallelOneShotSend,
  looksLikeRailAdvance,
} from "../src/turn-kind.js";

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

console.log("\n=== Will #257 / Florent #252 : envoi one-shot = parallel_action ===\n");
{
  const will = `Envoie "Salut" à +22968227403`;
  assert(isParallelOneShotSend(will), "Will: parallèle détecté");
  assert(isExplicitSendNow(will), "Will: Vague 1 explicite (coopération)");
  assert(allowsManualSend([], will), "Will: send autorisé Vague 1");
  const k = classifyBriefingTurn({ userMessage: will, inCampaignFlow: true });
  assert(k.kind === "parallel_action", "Will: kind=parallel_action");
  assert(k.pauseScenario === true, "Will: scénario en pause");
  assert(!isBriefingSideTalk(will) || true, "side-talk n'empêche plus (guillemets OK via parallèle)");
}

{
  const florent = `Envoie "cc" a +22966082161`;
  assert(isParallelOneShotSend(florent), "Florent #252: parallèle");
  const k = classifyBriefingTurn({ userMessage: florent, inCampaignFlow: true });
  assert(k.kind === "parallel_action" && k.pauseScenario, "Florent: pause + parallèle");
}

console.log("\n=== Digressions élargies (sans casser le rail) ===\n");
{
  assert(isBriefingSideTalk("c'est combien ?"), "c'est combien ?");
  assert(isBriefingSideTalk("c'est combien"), "c'est combien sans ?");
  assert(isBriefingSideTalk("explique-moi avant de lancer"), "explique / avant de");
  assert(isBriefingSideTalk("j'ai une question sur le prix"), "j'ai une question");
  assert(isBriefingSideTalk("attends je comprends pas"), "attends / comprends pas");
  const d = classifyBriefingTurn({
    userMessage: "c'est combien la masterclass",
    inCampaignFlow: true,
  });
  assert(d.kind === "digression" && d.pauseScenario, "digression → pause");
  const nudge = buildScenarioPauseNudge({
    kind: "digression",
    slotQuestion: BRIEFING_Q_LAUNCH,
  });
  assert(/Scénario en pause/i.test(nudge), "nudge pause digression");
  assert(/INTERDIT de reposer/i.test(nudge), "interdit re-colle slot");
}

console.log("\n=== Rail nominal intact ===\n");
{
  for (const msg of [
    "maintenant",
    "demain matin",
    "oui",
    "je valide",
    "lundi 9h",
    "Les membres du groupe Automax",
  ]) {
    const k = classifyBriefingTurn({ userMessage: msg, inCampaignFlow: true });
    assert(k.kind === "advance_rail" && !k.pauseScenario, `rail: « ${msg} »`);
  }
  assert(!isBriefingSideTalk("maintenant"), "maintenant ≠ side-talk");
  assert(!isBriefingSideTalk("je valide"), "je valide ≠ side-talk");
  assert(
    !isBriefingSideTalk(
      "1. Salut tu as 2 min ?\n2. Hey petit message\n3. Coucou\n4. Hello\n5. Salut"
    ),
    "liste 1–5 ≠ digression"
  );
}

console.log("\n=== Guillemets seuls (accroche collée) ≠ parallèle ===\n");
{
  const openerOnly = `« Salut, j'espère que tu vas bien. Tu as une minute ? »`;
  assert(!isParallelOneShotSend(openerOnly), "accroche seule ≠ envoi");
  const k = classifyBriefingTurn({ userMessage: openerOnly, inCampaignFlow: true });
  assert(k.kind === "advance_rail", "accroche seule → rail (validation opener)");
}

console.log("\n=== Hors campagne : pas de pause forcée ===\n");
{
  const k = classifyBriefingTurn({
    userMessage: `Envoie "Salut" à +22968227403`,
    inCampaignFlow: false,
  });
  assert(k.kind === "advance_rail" && !k.pauseScenario, "hors flow → pas de classif campagne");
}

console.log("\n=== Vague 1 : flou toujours bloqué ===\n");
{
  const fuzzy = "tu peux lui écrire ?";
  assert(!isExplicitSendNow(fuzzy), "flou ≠ send now");
  assert(!allowsManualSend([], fuzzy), "flou → send interdit");
  // Digression (question) plutôt que parallèle
  const k = classifyBriefingTurn({ userMessage: fuzzy, inCampaignFlow: true });
  assert(k.kind === "digression", "question floue = digression, pas parallèle");
}

console.log("\n=== Florent #246–#250 : continue/oui/bonjour restent rail ===\n");
{
  for (const msg of ["continue", "oui", "Bonsoir", "prospescts"]) {
    const k = classifyBriefingTurn({ userMessage: msg, inCampaignFlow: true });
    assert(k.kind === "advance_rail", `« ${msg} » reste sur le rail (slot launch OK)`);
  }
}

console.log("\n=== Screenshot GIT3 : extrait contacts = parallel group_extract ===\n");
{
  const msg = "extrait moi les contacts de GIT3 ouvert";
  assert(isParallelGroupExtract(msg), "GIT3: isParallelGroupExtract");
  const k = classifyBriefingTurn({ userMessage: msg, inCampaignFlow: true });
  assert(k.kind === "parallel_action", "GIT3: kind=parallel_action");
  assert(k.parallelAction === "group_extract", "GIT3: parallelAction=group_extract");
  assert(k.pauseScenario === true, "GIT3: pauseScenario");
  const rail = classifyBriefingTurn({
    userMessage: "Les membres du groupe Automax",
    inCampaignFlow: true,
  });
  assert(rail.kind === "advance_rail", "« Les membres du groupe Automax » reste rail");
  assert(
    !isParallelGroupExtract("Les membres du groupe Automax"),
    "sans verbe extract ≠ parallèle"
  );
}

console.log("\n=== Vague 4.2 pause-first : digressions / apartés ===\n");
{
  for (const msg of [
    "merci",
    "plus tard",
    "montre les stats",
    "liste mes groupes",
    "c'est combien",
    "ROI de la campagne",
    "pause",
  ]) {
    const k = classifyBriefingTurn({ userMessage: msg, inCampaignFlow: true });
    assert(k.pauseScenario === true, `pause: « ${msg} »`);
    assert(k.kind !== "advance_rail", `≠ rail: « ${msg} »`);
    assert(!looksLikeRailAdvance(msg), `!looksLikeRailAdvance: « ${msg} »`);
  }
}

console.log("\n=== Vague 4.2 : offre libre / accroches restent rail ===\n");
{
  const offer = "je vends du coaching business pour freelances";
  assert(looksLikeRailAdvance(offer), "offre libre = rail advance");
  const k = classifyBriefingTurn({ userMessage: offer, inCampaignFlow: true });
  assert(k.kind === "advance_rail" && !k.pauseScenario, "offre libre → hard-return OK");

  const openers =
    "1. Salut tu as 2 min ?\n2. Hey petit message\n3. Coucou\n4. Hello\n5. Salut";
  assert(looksLikeRailAdvance(openers), "liste 1–5 = rail advance");
  assert(
    classifyBriefingTurn({ userMessage: openers, inCampaignFlow: true }).kind === "advance_rail",
    "liste 1–5 → advance_rail"
  );
}

console.log("\n=== Hotfix screenshot : Envoi (nom) + négation prospection ===\n");
{
  const menuSend = `Envoi d'un message direct "Cc" à +22968227403`;
  assert(isParallelOneShotSend(menuSend), "menu Envoi… = one-shot");
  const k1 = classifyBriefingTurn({ userMessage: menuSend, inCampaignFlow: true });
  assert(k1.kind === "parallel_action" && k1.pauseScenario, "menu Envoi → pause parallèle");

  const notProspect = "Ce n'est pas une prospection";
  assert(!looksLikeRailAdvance(notProspect), "négation ≠ rail");
  const k2 = classifyBriefingTurn({ userMessage: notProspect, inCampaignFlow: true });
  assert(k2.kind === "digression" && k2.pauseScenario, "négation → digression pause");
}

console.log("\n=== Hotfix 4.2.2 : menu sans guillemets + refus + slot ? ===\n");
{
  const menuBare = `Envoi d'un message direct Cc à +22968227403`;
  assert(isParallelOneShotSend(menuBare), "menu sans guillemets = one-shot");

  const refuse = "je ne veux pas lancer tout de suite";
  assert(!looksLikeRailAdvance(refuse), "refus lancement ≠ rail");
  assert(
    classifyBriefingTurn({ userMessage: refuse, inCampaignFlow: true }).pauseScenario,
    "refus → pause",
  );

  const priceQ = "5000 FCFA, c'est bon ?";
  assert(looksLikeRailAdvance(priceQ), "prix + ? = rail");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
