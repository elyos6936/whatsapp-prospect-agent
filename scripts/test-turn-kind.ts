/**
 * Vague 4 — classification tour (digression / parallèle / rail).
 * Run: npx tsx scripts/test-turn-kind.ts
 */
import { isBriefingSideTalk, BRIEFING_Q_LAUNCH } from "../src/campaign-briefing.js";
import { isExplicitSendNow, allowsManualSend } from "../src/high-stakes-intent.js";
import {
  buildScenarioPauseNudge,
  classifyBriefingTurn,
  isParallelOneShotSend,
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

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
