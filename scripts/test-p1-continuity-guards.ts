/**
 * P1 multi-turn : phone rail, soft-ack satisfy, fuzzy digression, high-stakes oui.
 * Run: npx tsx scripts/test-p1-continuity-guards.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  isFuzzySendAsk,
  isShortHighStakesConfirm,
  resolveAllowedHighStakesTools,
} from "../src/high-stakes-intent.js";
import { userMessageSatisfiesSlot } from "../src/thread-briefing-state.js";
import {
  classifyBriefingTurn,
  recentAssistantAskedForPhoneOrTarget,
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

function msg(role: AgentMessage["role"], content: string): AgentMessage {
  return { id: 0, role, content, created_at: "" };
}

console.log("\n=== GAP-013 : phone-only rail seulement si demandé ===\n");
{
  const phone = "+229 01 62 00 00 00";
  const alone = classifyBriefingTurn({
    userMessage: phone,
    history: [msg("assistant", "C'est noté. On lance maintenant ou demain ?")],
    inCampaignFlow: true,
  });
  assert(alone.kind === "digression", "phone hors demande → digression");
  assert(alone.pauseScenario, "phone hors demande → pause");

  const asked = [
    msg("assistant", "Quel **numéro** veux-tu contacter pour le tiers ?"),
  ];
  assert(recentAssistantAskedForPhoneOrTarget(asked), "askedForPhone détecté");
  const withAsk = classifyBriefingTurn({
    userMessage: phone,
    history: asked,
    inCampaignFlow: true,
  });
  assert(withAsk.kind === "advance_rail", "phone après demande → rail");
}

console.log("\n=== GAP-014 : soft ack ≠ satisfy générique ===\n");
{
  assert(
    !userMessageSatisfiesSlot("Quelle est ton offre / produit ?", "d'accord"),
    "d'accord ≠ offre",
  );
  assert(
    !userMessageSatisfiesSlot("Qui veux-tu contacter ?", "parfait"),
    "parfait ≠ cible",
  );
  assert(
    userMessageSatisfiesSlot(
      "Quelle est ton offre / produit ?",
      "je vends du coaching freelances",
    ),
    "offre substantielle OK",
  );
  assert(
    userMessageSatisfiesSlot(
      "Tu veux que j'ajoute des stickers… ? (oui/non)",
      "oui",
    ),
    "oui stickers toujours OK",
  );
}

console.log("\n=== GAP-022 : fuzzy send → digression ===\n");
{
  const fuzzy = "tu peux lui écrire ?";
  assert(isFuzzySendAsk(fuzzy), "fuzzy détecté");
  const k = classifyBriefingTurn({
    userMessage: fuzzy,
    history: [msg("assistant", "Cible : freelances Cotonou. On lance quand ?")],
    inCampaignFlow: true,
  });
  assert(k.kind === "digression" && k.pauseScenario, "fuzzy → digression pause");
}

console.log("\n=== GAP-023 : oui après confirm high-stakes ===\n");
{
  assert(isShortHighStakesConfirm("oui"), "oui = short confirm");
  const pauseHist = [
    msg("assistant", "Tu confirmes : je mets la campagne Masterclass en pause ?"),
  ];
  const allowed = resolveAllowedHighStakesTools({
    userMessage: "oui",
    recentHistory: pauseHist,
  });
  assert(allowed.has("set_automation_status"), "oui après pause → status OK");

  const stickersHist = [
    msg("assistant", "Tu veux des stickers dans les conversations ? (oui/non)"),
  ];
  const blocked = resolveAllowedHighStakesTools({
    userMessage: "oui",
    recentHistory: stickersHist,
  });
  assert(!blocked.has("set_automation_status"), "oui stickers ≠ status");
  assert(!blocked.has("delete_automation"), "oui stickers ≠ delete");

  const delHist = [
    msg("assistant", "Tu confirmes la suppression de la campagne « Test » ?"),
  ];
  const delOk = resolveAllowedHighStakesTools({
    userMessage: "oui",
    recentHistory: delHist,
  });
  assert(delOk.has("delete_automation"), "oui après delete ask → delete OK");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
