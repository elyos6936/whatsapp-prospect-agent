/**
 * Tests module Groupes (sans LLM / sans sim).
 * Run: npx tsx scripts/test-groups-flow.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  assessCampaignBriefing,
  buildBriefingNudge,
} from "../src/campaign-briefing.js";
import {
  extractGroupNamesFromHistory,
  extractGroupPostMessage,
  extractGroupSequenceSteps,
  buildGroupsBriefingNudge,
  isGroupMetaInstruction,
  shouldDeterministicGroupsDraft,
  userWantsGroupsCampaign,
  wantsGroupMemberProspecting,
} from "../src/groups-flow.js";

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

console.log("\n=== Extract message / groupes ===\n");
{
  const hist = [
    msg("user", "Message : Bonjour à tous, promo demain 🎉"),
    msg("user", "Dans le groupe Team MASK"),
  ];
  assert(
    /promo demain/i.test(extractGroupPostMessage(hist) || ""),
    "extrait le post"
  );
  assert(
    extractGroupNamesFromHistory(hist).some((g) => /Team MASK/i.test(g)),
    "extrait nom de groupe"
  );
  assert(
    extractGroupPostMessage([msg("user", "Je veux lancer une campagne")]) == null,
    "« lancer une campagne » n'est pas un post"
  );
  assert(
    extractGroupPostMessage([
      msg("user", "Je veux prospecter mon groupe le labo du no code"),
    ]) == null,
    "« prospecter mon groupe » n'est pas un post"
  );
  assert(isGroupMetaInstruction("Je veux lancer une campagne"), "meta campagne");
  assert(
    wantsGroupMemberProspecting("Je veux prospecter mon groupe le labo du no code"),
    "détecte prospection membres"
  );
  assert(
    !shouldDeterministicGroupsDraft("Je valide", [
      msg("user", "Je veux lancer une campagne"),
      msg("user", "Je veux prospecter mon groupe le labo du no code"),
      msg("assistant", "Tu veux des posts J+1 ?"),
      msg("user", "Non"),
    ]),
    "je valide sans texto → pas de brouillon"
  );
}

console.log("\n=== Sequence steps ===\n");
{
  const hist = [
    msg("user", "J+1 : Rappel inscription\nJ+3 : Dernière chance"),
  ];
  const steps = extractGroupSequenceSteps(hist);
  assert(steps.length === 2, `2 steps (got ${steps.length})`);
  assert(steps[0]?.delayDays === 1, "J+1");
  assert(steps[1]?.delayDays === 3, "J+3");
}

console.log("\n=== Briefing purpose=groupes (pas opener) ===\n");
{
  const hist = [
    msg("user", "Je veux poster dans mes groupes"),
    msg("assistant", "Quel message ?"),
    msg("user", "Message : Hello groupe, event samedi"),
  ];
  const a = assessCampaignBriefing(hist, "dans Team MASK", "groupes");
  assert(a.isGroupsFlow === true, "isGroupsFlow");
  assert(a.isInboundClosing === false, "pas support");
  assert(a.openerVariantsProposed === true, "skip 5 variantes");
  assert(a.readyForDraft === true, "ready (message+groupe)");

  const nudge = buildBriefingNudge(a, hist, "dans Team MASK") || "";
  assert(
    !/\b(propose|liste)\s+(les\s+)?5\b|\bA\.I\.D\.A\b/i.test(nudge),
    "nudge sans opener"
  );
  assert(/INTERDIT/i.test(nudge), "rappelle les interdits");
  assert(!/\bsimule\b|\btéléphone à droite\b/i.test(nudge), "pas de sim demandée");
  assert(
    /send_whatsapp|schedule|je valide|group_broadcast|Exécute/i.test(nudge),
    "nudge action send/schedule ou brouillon"
  );
}

console.log("\n=== Campagne multi-jours détectée ===\n");
{
  const hist = [
    msg("user", "Je veux une diffusion multi-jours"),
    msg("user", "Message : Annonce lancement"),
    msg("user", "groupe Ventes VIP"),
    msg("user", "J+1 : Relance douce"),
  ];
  assert(userWantsGroupsCampaign(hist, "je valide"), "détecte campagne");
  const a = assessCampaignBriefing(hist, "je valide", "groupes");
  const nudge = buildGroupsBriefingNudge(a, hist, "je valide") || "";
  assert(/je valide|group_broadcast/i.test(nudge), "pousse brouillon");
  assert(!/simule|téléphone/i.test(nudge.replace(/INTERDIT[^.]*simulation[^.]*\./gi, "")), "pas inviter à simuler");
}

console.log("\n=== Prospection inchangée (pas isGroupsFlow) ===\n");
{
  const hist = [
    msg("user", "Je veux prospecter des contacts"),
    msg("assistant", "Quelle offre ?"),
    msg("user", "Formation 50k, cible coaches"),
  ];
  const a = assessCampaignBriefing(hist, "ok", "prospection");
  assert(a.isGroupsFlow === false, "prospection pas groupes");
  assert(a.isInboundClosing === false, "prospection pas support");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
