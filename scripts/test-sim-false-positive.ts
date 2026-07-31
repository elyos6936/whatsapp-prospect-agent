/**
 * Repro + tests: planDisplay ne doit PAS compter comme une simulation.
 * Run: npx tsx scripts/test-sim-false-positive.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  hasSimulationThread,
  recentHistoryHasSimulation,
  resolveSimulationTurnMode,
} from "../src/simulation-gate.js";

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

const DRAFT_WITH_PLAN =
  "« Baskets Nike - Closing » est prêt en brouillon. Veux-tu tester une **simulation** dans ce chat avant le lancement ?\n\n" +
  "```klanvio-plan\n" +
  JSON.stringify({
    version: 1,
    title: "Baskets Nike - Closing",
    nodes: [
      {
        id: "start",
        label: "Déclencheur phrase exacte",
        subtitle: "je suis intéressé par ce produit",
      },
      {
        id: "reply",
        label: "Réponse IA",
        subtitle: "présentation + prix + livraison",
      },
    ],
    edges: [{ from: "start", to: "reply" }],
  }) +
  "\n```";

const REAL_SIM =
  "Toi → « Bonjour, vous cherchez des baskets ? »\n" +
  "Prospect → « Oui, lesquelles ? »\n" +
  "Toi → « Les Nike Air, 45000 FCFA. »\n";

console.log("\n=== False positive planDisplay ===\n");
assert(!hasSimulationThread(DRAFT_WITH_PLAN), "draft+plan n'est PAS une simulation");
assert(
  !recentHistoryHasSimulation([msg("assistant", DRAFT_WITH_PLAN)]),
  "historique draft ≠ sim déjà faite",
);
assert(
  resolveSimulationTurnMode([msg("assistant", DRAFT_WITH_PLAN)], "oui") === "force_sim",
  "oui après offre sim → force_sim",
);

console.log("\n=== Vraie simulation ===\n");
assert(hasSimulationThread(REAL_SIM), "fil Toi/Prospect détecté");
assert(
  resolveSimulationTurnMode([msg("assistant", REAL_SIM)], "oui") !== "force_sim",
  "oui après vraie sim ≠ force_sim (sauf resim explicite)",
);
assert(
  resolveSimulationTurnMode([msg("assistant", REAL_SIM)], "refais la simulation") ===
    "force_sim",
  "refais après vraie sim → force_sim",
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
