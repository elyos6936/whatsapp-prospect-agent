/**
 * Vague 2 / point 10 — stall routeur D (générique, aucun nom réel).
 * Run: npx tsx scripts/test-agent-stall.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  ROUTER_STALL_CLARIFY,
  alreadyAskedRouterStallClarify,
  countRouterStallToolErrors,
  detectCrossTurnRouterStall,
  isRouterStallToolError,
  lastQuestionFingerprint,
  shouldStopAfterRouterBlocks,
} from "../src/agent-stall.js";

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

console.log("\n=== Fingerprint / même question ===\n");
{
  const a = lastQuestionFingerprint(
    "Pour avancer : comment tu veux aborder le premier contact ?"
  );
  const b = lastQuestionFingerprint(
    "Ok. Pour avancer : comment tu veux aborder le premier contact ?"
  );
  assert(a.length >= 16, "fingerprint assez long");
  assert(a === b, "même question → même empreinte");
  assert(
    lastQuestionFingerprint("Quel est le prix ?") !==
      lastQuestionFingerprint("Quel est l'objectif ?"),
    "questions différentes → empreintes distinctes"
  );
}

console.log("\n=== Cross-turn stall ===\n");
{
  const ask = "Comment tu veux aborder le premier contact ?";
  const history = [
    am("user", "prospecte les membres du groupe"),
    am("assistant", ask),
    am("user", "vas-y propose"),
    am("assistant", ask),
  ];
  assert(
    detectCrossTurnRouterStall({
      history,
      userMessage: "propose encore",
      inCampaignFlow: true,
    }),
    "2× la même question + fil campagne → stall"
  );
  assert(
    !detectCrossTurnRouterStall({
      history,
      userMessage: "propose encore",
      inCampaignFlow: false,
    }),
    "hors flux campagne → pas de stall"
  );
  const withClarify = [
    ...history,
    am("assistant", ROUTER_STALL_CLARIFY),
  ];
  assert(
    alreadyAskedRouterStallClarify(withClarify),
    "clarify déjà posée"
  );
  assert(
    !detectCrossTurnRouterStall({
      history: withClarify,
      userMessage: "encore",
      inCampaignFlow: true,
    }),
    "pas de 2e clarify"
  );
}

{
  const ask = "Comment tu veux aborder le premier contact ?";
  const history = [
    am("user", "prospecte les membres du groupe"),
    am("assistant", ask),
    am("user", "vas-y propose"),
    am("assistant", ask),
  ];
  assert(
    !detectCrossTurnRouterStall({
      history,
      userMessage:
        "en fait on est une agence de prospection via WhatsApp et on a besoin d'accrocher les gens pour notre propre service d'automatisation",
      inCampaignFlow: true,
    }),
    "long brief → pas un stall"
  );
  assert(
    !detectCrossTurnRouterStall({
      history,
      userMessage: "oui, c'est bon",
      inCampaignFlow: true,
    }),
    "oui c'est bon → pas un stall"
  );
  assert(
    alreadyAskedRouterStallClarify([
      am(
        "assistant",
        "Désolé je ne peux effectuer l'instruction. Tu peux me proposer les accroches, créer le brouillon, simuler.",
      ),
    ]),
    "paraphrase MiniMax = déjà stall"
  );
}

console.log("\n=== Intra-tour outils bloqués ===\n");
assert(
  isRouterStallToolError(JSON.stringify({ error: "Trop tôt pour la simulation." })),
  "erreur sim = stall tool"
);
assert(
  !isRouterStallToolError(JSON.stringify({ error: "ENVOI BLOQUÉ (déterministe)." })),
  "high-stakes ≠ stall routeur"
);
assert(
  shouldStopAfterRouterBlocks(2),
  "seuil 2"
);
assert(
  !shouldStopAfterRouterBlocks(1),
  "1 blocage ≠ stop"
);
assert(
  countRouterStallToolErrors([
    { role: "tool", content: '{"error":"Briefing incomplet (≈1/5 questions)"}' },
    { role: "tool", content: '{"error":"INTERDIT de créer le brouillon avant"}' },
  ]) === 2,
  "compte 2 erreurs routeur"
);

console.log("\n=== Non-régression validation campagne ===\n");
{
  const history = [
    am("user", "Propose des accroches"),
    am(
      "assistant",
      "1. Salut, tu as 2 min ?\n2. Hey, petit message.\n3. Coucou.\n4. Hello.\n5. Salut, masterclass."
    ),
  ];
  assert(
    !detectCrossTurnRouterStall({
      history,
      userMessage: "je valide",
      inCampaignFlow: true,
    }),
    "je valide après variantes ≠ stall (1 seul assistant)"
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
