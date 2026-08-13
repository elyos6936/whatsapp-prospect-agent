/**
 * Audit stop / diagnostic / consent — cas screenshot + régressions.
 * Run: npx tsx scripts/_audit-stop.ts
 */
import {
  shouldStopConversation,
  detectNotInterested,
  detectContextualRefusal,
  detectOutOfScope,
  detectUnknownQuestion,
  detectRepeatedUnknownQuestion,
  isOutboundDiagnosticAsk,
  isOutboundConsentAsk,
  shouldSilenceAfterFarewell,
  getStopFarewellReply,
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

console.log("\n=== « C'est combien ? » conversation engagée ===\n");
{
  const hist = [
    { direction: "sortant", body: "Salut, je lance une masterclass graphisme, tu as 2 min ?" },
    { direction: "entrant", body: "Oui dis-moi" },
    { direction: "sortant", body: "C'est 4 semaines, live + replay, pour monter tes visuels." },
  ];
  const biz = { offer: "Masterclass graphisme", price: "25 000 FCFA", ownerName: "Alex" };
  const cfg = {
    productName: "Masterclass graphisme",
    price: "25 000 FCFA",
    conversationGuide: "formation design canva",
    salesScript: "masterclass",
    initialMessage: "Salut, masterclass graphisme",
  };
  const stop = shouldStopConversation("C'est combien ?", biz, cfg, hist);
  assert(stop === null, `C'est combien ? → continue (got ${stop})`);
}

console.log("\n=== Eusebe hors-cible (mécanicien / créa) ===\n");
{
  const graphisme = {
    productName: "Graphisme / motion design",
    conversationGuide: "création de contenu youtube miniatures",
    salesScript: "design canva",
    initialMessage: "Salut, je fais du motion",
  };
  assert(
    detectOutOfScope("je suis mécanicien", graphisme),
    "Eusebe mécanicien + campagne graphisme → hors cible"
  );
  const stop = shouldStopConversation("je suis mécanicien", {}, graphisme);
  assert(stop === "out_of_scope", `Eusebe → out_of_scope (got ${stop})`);
  const bye = getStopFarewellReply("out_of_scope");
  assert(/ne vous dérange plus|Bonne continuation/i.test(bye), "clôture + stop technique");
}

console.log("\n=== Croisé masterclass / graphisme (mission par campagne) ===\n");
{
  const masterclass = {
    productName: "Masterclass YouTube",
    conversationGuide: "formation contenu youtube",
    salesScript: "masterclass formation",
    initialMessage: "Salut, masterclass youtube",
  };
  const graphisme = {
    productName: "Studio graphisme logo",
    conversationGuide: "création logo design canva",
    salesScript: "graphisme",
    initialMessage: "Salut, je fais des logos",
  };
  assert(
    detectOutOfScope("je suis mécanicien", masterclass),
    "mécanicien hors masterclass (digital/formation)"
  );
  assert(
    detectOutOfScope("je suis mécanicien", graphisme),
    "mécanicien hors graphisme (design)"
  );
  assert(
    !detectOutOfScope("c'est combien la masterclass ?", graphisme),
    "question prix ≠ hors-cible (ne change pas de mission)"
  );
  assert(
    !detectOutOfScope("je veux un logo", masterclass),
    "demande logo sur masterclass ≠ out_of_scope métier (pas de switch auto)"
  );
  const engaged = [
    { direction: "sortant", body: "La masterclass dure 4 semaines, tu veux le programme ?" },
    { direction: "entrant", body: "Oui" },
  ];
  assert(
    shouldStopConversation("C'est combien ?", { price: "40 000 FCFA" }, masterclass, engaged) ===
      null,
    "prix sur fil masterclass → on reste sur CETTE campagne"
  );
}

console.log("\n=== unknown_question : alerte sans coupure ===\n");
{
  const biz = { offer: "Offre", price: "", ownerName: "Alex" };
  const cfg = { productName: "Offre", conversationGuide: "pas de tarif" };
  assert(detectUnknownQuestion("C'est combien ?", biz, cfg), "prix absent → unknown");
  assert(
    detectRepeatedUnknownQuestion("C'est combien ?", [], biz, cfg) === null,
    "1re unknown → pas d'alerte"
  );
  const hist = [{ direction: "entrant", body: "C'est combien ?" }];
  const rep = detectRepeatedUnknownQuestion("Vous facturez combien ?", hist, biz, cfg);
  assert(rep?.alert === true && rep.topic === "price" && rep.count === 2, "2e unknown prix → alerte");
  assert(
    shouldStopConversation("Vous facturez combien ?", biz, cfg, hist) === null,
    "unknown (question) → pas de coupure"
  );
  const withPrice = { offer: "Offre", price: "25 000 FCFA", ownerName: "Alex" };
  assert(
    detectRepeatedUnknownQuestion(
      "C'est combien ?",
      [{ direction: "entrant", body: "C'est combien ?" }],
      withPrice,
      { price: "25 000 FCFA" }
    ) === null,
    "prix en config → pas unknown, pas d'alerte"
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

