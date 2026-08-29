/**
 * P1 restants + P2 multi-turn continuity.
 * Run: npx tsx scripts/test-p2-continuity.ts
 */
import {
  messageNeedsCampaignMemory,
  messageNeedsWhatsAppConnection,
} from "../src/agent.js";
import { alreadyAskedRouterStallClarify } from "../src/agent-stall.js";
import type { AgentMessage } from "../src/db.js";
import {
  allowGroupQuickPaths,
  lastAssistantAskedForGroupName,
  resolveMembersIntentFromHistory,
} from "../src/group-list-intent.js";
import { detectCreateGroupIntent } from "../src/group-manage-intent.js";
import { classifyBriefingTurn } from "../src/turn-kind.js";
import { shouldSoftPauseInsteadOfHardReturn } from "../src/agent.js";

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

console.log("\n=== GAP-025 : WA soft gate ===\n");
{
  assert(!messageNeedsWhatsAppConnection("salut"), "salut ≠ WA");
  assert(!messageNeedsWhatsAppConnection("c'est quoi une mémoire ?"), "Q&A ≠ WA");
  assert(messageNeedsWhatsAppConnection("liste mes groupes"), "liste groupes → WA");
  assert(messageNeedsWhatsAppConnection("envoie Salut à +229…"), "envoie → WA");
  assert(messageNeedsWhatsAppConnection("simule"), "simule → WA");
}

console.log("\n=== GAP-026 : mémoire soft gate ===\n");
{
  assert(!messageNeedsCampaignMemory("bonjour"), "bonjour OK sans mémoire");
  assert(!messageNeedsCampaignMemory("merci"), "merci OK");
  assert(!messageNeedsCampaignMemory("c'est quoi Klanvio ?"), "Q&A OK");
  assert(messageNeedsCampaignMemory("je valide"), "je valide → mémoire");
  assert(messageNeedsCampaignMemory("lance la campagne"), "lance → mémoire");
  assert(messageNeedsCampaignMemory("simule la conversation"), "simule → mémoire");
}

console.log("\n=== GAP-006 : Support bare name après introuvable ===\n");
{
  const hist = [
    msg("user", "extrait les membres du groupe RADAR"),
    msg("assistant", "Groupe introuvable : « RADAR ».\n\nVérifiez le nom exact."),
  ];
  assert(
    allowGroupQuickPaths({
      purpose: "support",
      userMessage: "GIT3 ouvert",
      history: hist,
    }),
    "Support + GIT3 après introuvable",
  );
  const resolved = resolveMembersIntentFromHistory("GIT3 ouvert", hist);
  assert(resolved?.groupQuery === "GIT3 ouvert", "resolve members bare name");
}

console.log("\n=== GAP-007 : maintenant après extract ===\n");
{
  const histNow = [
    msg("user", "extrait les membres du groupe Automax Prospection"),
    msg("assistant", "J'extrais les membres du groupe Automax Prospection…"),
  ];
  const now = resolveMembersIntentFromHistory("maintenant", histNow);
  assert(
    Boolean(now?.groupQuery && /automax/i.test(now.groupQuery)),
    "maintenant → extract Automax",
  );
  assert(
    resolveMembersIntentFromHistory("maintenant", [
      msg("assistant", "On lance maintenant ou demain ?"),
    ]) === null,
    "maintenant hors extract ≠ members",
  );
}

console.log("\n=== GAP-012 : soft greeting digression (déjà) ===\n");
{
  const k = classifyBriefingTurn({
    userMessage: "salut",
    history: [msg("assistant", "Qui veux-tu contacter ?")],
    inCampaignFlow: true,
  });
  assert(k.kind === "digression" && k.pauseScenario, "salut → digression pause");
}

console.log("\n=== GAP-017/027 : stall mark détecté ===\n");
{
  const hist = [
    msg(
      "assistant",
      "Je n'ai pas bien accroché l'action. Tu veux : proposer l'accroche, créer le brouillon, simuler, ou autre chose ?",
    ),
  ];
  assert(alreadyAskedRouterStallClarify(hist), "stall mark détecté");
}

console.log("\n=== Soft-pause Cursor : crée groupe / nom après ask LLM ===\n");
{
  assert(
    Boolean(detectCreateGroupIntent("Je veux créer un groupe")),
    "je veux créer un groupe → intent",
  );
  assert(
    detectCreateGroupIntent("Je veux créer un groupe")?.subject === "",
    "sans nom → subject vide (ask)",
  );
  assert(
    allowGroupQuickPaths({
      purpose: "prospection",
      userMessage: "Je veux créer un groupe",
      history: [],
    }),
    "crée groupe → quick paths ouverts",
  );

  const askLlm = [
    msg("user", "Donne les contacts de mon groupe"),
    msg(
      "assistant",
      "Tu veux lister les membres d'un groupe en particulier ? Si oui, donne-moi son nom ou son lien.",
    ),
  ];
  assert(
    lastAssistantAskedForGroupName(askLlm),
    "phrasing LLM nom/lien → askedForGroupName",
  );
  assert(
    resolveMembersIntentFromHistory("Le labo du nocode", askLlm)?.groupQuery ===
      "Le labo du nocode",
    "nom après ask LLM → extract",
  );
  assert(
    allowGroupQuickPaths({
      purpose: "prospection",
      userMessage: "Le labo du nocode",
      history: askLlm,
    }),
    "bare name après ask LLM → quick paths",
  );
  assert(
    shouldSoftPauseInsteadOfHardReturn("Je veux créer un groupe", []),
    "soft-pause crée groupe",
  );
  assert(
    shouldSoftPauseInsteadOfHardReturn("Le labo du nocode", askLlm),
    "soft-pause nom après ask",
  );
  assert(
    shouldSoftPauseInsteadOfHardReturn("Bon faut laisser je veux plutot autre chose", []),
    "aparté hors whitelist → soft-pause LLM",
  );
  assert(
    !shouldSoftPauseInsteadOfHardReturn("maintenant", []),
    "maintenant = rail (hard-return OK si slot)",
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
