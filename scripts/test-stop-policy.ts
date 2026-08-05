/**
 * Audit stop / diagnostic / consent — cas screenshot + régressions.
 * Run: npx tsx scripts/_audit-stop.ts
 */
import {
  shouldStopConversation,
  detectNotInterested,
  detectContextualRefusal,
  isOutboundDiagnosticAsk,
  isOutboundConsentAsk,
  shouldSilenceAfterFarewell,
} from "../src/stop-policy.js";

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

const biz = {};

console.log("\n=== Screenshot: « non je pense pas » après Q process ===\n");
const processQ =
  "Solo, parfait. Vous avez déjà des process qui vous prennent du temps au quotidien, type gestion des commandes, SAV ou relances clients, ou c'est encore assez manuel pour l'instant ?";
assert(isOutboundDiagnosticAsk(processQ), "process Q = diagnostic");
assert(!isOutboundConsentAsk(processQ), "process Q ≠ consent");
assert(detectNotInterested("non je pense pas"), "pattern not_interested matche (brut)");
{
  const hist = [
    { direction: "sortant", body: "E-commerce, très bien. Vous gérez ça en solo ou avec une petite équipe ?" },
    { direction: "entrant", body: "Solo" },
    { direction: "sortant", body: processQ },
  ];
  const stop = shouldStopConversation("non je pense pas", biz, undefined, hist);
  assert(stop === null, `après Q diagnostic → continue (got ${stop})`);
}

console.log("\n=== Vrais stops ===\n");
assert(
  shouldStopConversation("pas intéressé", biz) === "not_interested",
  "pas intéressé → stop",
);
assert(
  shouldStopConversation("non merci", biz) === "not_interested",
  "non merci → stop",
);
assert(
  shouldStopConversation("tu me soules", biz, undefined, [
    { direction: "sortant", body: "Ça vous intéresse ?" },
  ]) === "skepticism" ||
    shouldStopConversation("tu me soules", biz) === "skepticism" ||
    shouldStopConversation("tu me soules", biz) === "dissatisfaction",
  "tu me soules → stop hostilité",
);
{
  const hist = [
    { direction: "sortant", body: "Est-ce que ça vous intéresse d'en parler ?" },
  ];
  assert(isOutboundConsentAsk(hist[0].body), "ça vous intéresse = consent");
  assert(
    shouldStopConversation("non", biz, undefined, hist) === "not_interested",
    "non seul après consent → stop",
  );
  assert(
    shouldStopConversation("non je pense pas", biz, undefined, hist) === "not_interested",
    "non je pense pas après consent → stop",
  );
}

console.log("\n=== Diagnostic bare non ===\n");
{
  const hist = [
    {
      direction: "sortant",
      body: "Utilisez-vous déjà un outil de gestion des commandes ?",
    },
  ];
  assert(isOutboundDiagnosticAsk(hist[0].body), "utilisez-vous = diagnostic");
  assert(
    shouldStopConversation("non", biz, undefined, hist) === null,
    "non après diagnostic → continue",
  );
}

console.log("\n=== Post-farewell silence ===\n");
{
  const hist = [
    {
      direction: "sortant",
      body: "Compris, je ne vous dérange plus. Bonne continuation ! 🙂",
    },
  ];
  assert(shouldSilenceAfterFarewell("okay", hist), "okay après adieu → silence");
  assert(
    shouldStopConversation("okay", biz, undefined, hist) === "not_interested",
    "okay après adieu → stop reason",
  );
}

console.log("\n=== Contextual refusal only on bare no ===\n");
assert(
  !detectContextualRefusal("non je pense pas", [
    { direction: "sortant", body: "Ça vous intéresse ?" },
  ]),
  "non je pense pas n'est PAS bare_no (géré via not_interested)",
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
