/**
 * Vague 4 — filet D prix / clôture du DM WhatsApp.
 * Run: npx tsx scripts/test-whatsapp-reply-guard.ts
 */
import {
  alignOutboundPrice,
  applyWhatsAppReplyGuard,
  compactPriceDigits,
  extractMoneyAmounts,
  incomingAsksPrice,
  incomingMentionsAmount,
  outboundAlreadyStatedPrice,
  textContainsConfiguredPrice,
} from "../src/whatsapp-reply-guard.js";

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

console.log("\n=== Détection question prix ===\n");
assert(incomingAsksPrice("C'est combien ?"), "c'est combien");
assert(incomingAsksPrice("c'est combien"), "c'est combien sans ?");
assert(incomingAsksPrice("Quel est le prix"), "quel est le prix");
assert(incomingAsksPrice("le tarif ?"), "le tarif");
assert(!incomingAsksPrice("ok je regarde"), "ack ≠ question prix");
assert(incomingMentionsAmount("c'est 40 000 ?"), "montant cité = confirmation");

console.log("\n=== Extraction montants ===\n");
assert(
  extractMoneyAmounts("C'est 25 000 FCFA").includes("25000"),
  "25 000 → 25000"
);
assert(
  extractMoneyAmounts("C'est 25000").includes("25000"),
  "25000 compact"
);
assert(
  !extractMoneyAmounts("Depuis 2026 on forme").includes("2026"),
  "année ignorée"
);
assert(
  !extractMoneyAmounts("https://pay.example/25000").includes("25000"),
  "chiffres d'URL ignorés"
);
assert(compactPriceDigits("25 000 FCFA") === "25000", "compact config");

console.log("\n=== Prix déjà dit / présent ===\n");
assert(
  textContainsConfiguredPrice("Le tarif est 25 000 FCFA.", "25000"),
  "détecte prix config dans le texte"
);
assert(
  outboundAlreadyStatedPrice(
    [
      { direction: "sortant", body: "C'est 25 000 FCFA." },
      { direction: "entrant", body: "ok" },
    ],
    "25 000 FCFA"
  ),
  "sortant a déjà dit le prix"
);
assert(
  !outboundAlreadyStatedPrice(
    [{ direction: "sortant", body: "Tu as 2 min ?" }],
    "25 000 FCFA"
  ),
  "opener sans prix"
);

console.log("\n=== Question prix → injecte le tarif config ===\n");
{
  const r = alignOutboundPrice("Je vous envoie les détails.", {
    incomingText: "C'est combien ?",
    configuredPrice: "25 000 FCFA",
    history: [],
  });
  assert(r.injected, "flag injecté");
  assert(textContainsConfiguredPrice(r.reply, "25000"), "montant config présent");
  assert(/25\s*000/i.test(r.reply), "libellé 25 000");
}

console.log("\n=== Prix inventé ≠ config → recale ===\n");
{
  const r = alignOutboundPrice("C'est 40 000 FCFA.", {
    incomingText: "C'est combien ?",
    configuredPrice: "25 000 FCFA",
    history: [],
  });
  assert(r.invented, "flag inventé");
  assert(textContainsConfiguredPrice(r.reply, "25000"), "recalé 25000");
  assert(!extractMoneyAmounts(r.reply).includes("40000"), "40000 retiré");
}

console.log("\n=== Frais livraison 2000 ≠ recalé (longueur / hors contexte prix) ===\n");
{
  const r = alignOutboundPrice("Les frais de livraison sont 2000 FCFA.", {
    incomingText: "ok pour la livraison",
    configuredPrice: "25 000 FCFA",
    history: [],
  });
  assert(!r.invented, "2000 n'est pas le tarif principal");
  assert(extractMoneyAmounts(r.reply).includes("2000"), "2000 conservé");
}

console.log("\n=== Répétition prix déjà dit, hors question → retire ===\n");
{
  const r = alignOutboundPrice("C'est 25 000 FCFA. On avance quand vous voulez.", {
    incomingText: "ok je vois",
    configuredPrice: "25 000 FCFA",
    history: [{ direction: "sortant", body: "Le tarif est 25 000 FCFA." }],
  });
  assert(r.strippedRepeat, "flag répétition");
  assert(
    !textContainsConfiguredPrice(r.reply, "25000") || /\?|http/i.test(r.reply),
    "montant retiré du rappel"
  );
  assert(/avance/i.test(r.reply), "le reste du message est conservé");
}

console.log("\n=== Répétition : on ne touche pas si le prospect redemande ===\n");
{
  const r = alignOutboundPrice("C'est 25 000 FCFA.", {
    incomingText: "C'est combien ?",
    configuredPrice: "25 000 FCFA",
    history: [{ direction: "sortant", body: "C'est 25 000 FCFA." }],
  });
  assert(!r.strippedRepeat, "redemande → on garde le prix");
  assert(textContainsConfiguredPrice(r.reply, "25000"), "prix toujours là");
}

console.log("\n=== Aucun tarif config + montant inventé → retire ===\n");
{
  const r = alignOutboundPrice("C'est 99 000 FCFA pour la formation.", {
    incomingText: "C'est combien ?",
    configuredPrice: "",
    history: [],
  });
  assert(r.strippedInvented, "flag inventé sans config");
  assert(extractMoneyAmounts(r.reply).length === 0, "aucun montant laissé");
}

console.log("\n=== Clôture prématurée recadrée (garde Vague 2) ===\n");
{
  const r = applyWhatsAppReplyGuard(
    "D'accord. Je ne vous dérange plus, bonne continuation !",
    {
      incomingText: "ok",
      configuredPrice: "25 000 FCFA",
      history: [{ direction: "sortant", body: "Tu as 2 min pour en parler ?" }],
    }
  );
  assert(r.prematureClose, "adieu sans action D → prématuré");
  assert(!/bonne continuation/i.test(r.reply), "adieu retiré");
}

console.log("\n=== Clôture OK après lien livré ===\n");
{
  const r = applyWhatsAppReplyGuard("C'est noté de mon côté, bonne continuation !", {
    incomingText: "merci",
    history: [
      {
        direction: "sortant",
        body: "Voici le lien : https://calendly.com/demo",
      },
    ],
    closingGoal: "link",
    closingLink: "https://calendly.com/demo",
  });
  assert(!r.prematureClose, "lien déjà livré → clôture autorisée");
}

console.log("\n=== Change le prix après sim : nouveau tarif respecté ===\n");
{
  const r = alignOutboundPrice("C'est 25 000 FCFA.", {
    incomingText: "C'est combien ?",
    configuredPrice: "40 000 FCFA",
    history: [{ direction: "sortant", body: "C'est 25 000 FCFA." }],
  });
  assert(r.invented, "ancien montant ≠ nouveau config");
  assert(textContainsConfiguredPrice(r.reply, "40000"), "nouveau tarif");
  assert(!extractMoneyAmounts(r.reply).includes("25000"), "ancien tarif retiré");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
