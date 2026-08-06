/**
 * Audit objectifs / handoff / delivery / support gating.
 * Run: npx tsx scripts/_audit-runtime.ts
 */
import {
  isCampaignObjectiveReached,
  wasVerballyClosed,
  isAppointmentSlotConfirmed,
  isAffirmingPendingSendOffer,
  outboundDeliveredAction,
  ensurePendingLinkInReply,
} from "../src/lead-scoring.js";
import {
  phoneKeyFromWhatsAppId,
  phonesMatchStrict,
  toE164Display,
} from "../src/integrations/google.js";
import { findMatchingHandoffKeyword } from "../src/handoff.js";
import { isInboundCatchAllCampaign } from "../src/campaign-gating.js";
import { looksLikeInternalMonologue, safeFallbackWhatsAppReply } from "../src/prospect-facing-sanitize.js";
import type { Automation } from "../src/db.js";

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

console.log("\n=== Objectifs: lien livré + ack ===\n");
{
  const hist = [
    { direction: "sortant", body: "Voici le lien pour réserver : https://calendly.com/demo" },
  ];
  assert(outboundDeliveredAction(hist[0].body), "URL = action livrée");
  assert(isCampaignObjectiveReached("ok", hist, { closingGoal: "link" }), "ok après lien → objectif");
  assert(isCampaignObjectiveReached("merci", hist, { closingGoal: "link" }), "merci après lien → objectif");
}

console.log("\n=== Objectifs: offre envoi + oui ≠ clôture ===\n");
{
  const hist = [
    { direction: "sortant", body: "Je vous envoie le lien tout de suite ?" },
  ];
  assert(isAffirmingPendingSendOffer("oui", hist), "oui après offre = affirm pending");
  assert(
    !isCampaignObjectiveReached("oui", hist, { closingGoal: "link", closingLink: "https://x.com" }),
    "oui après offre ≠ objectif",
  );
  const patched = ensurePendingLinkInReply("Parfait", "https://pay.example.com", "oui", hist);
  assert(patched.includes("https://pay.example.com"), "filet ajoute le lien manquant");
}

console.log("\n=== Objectifs: livreur ===\n");
{
  const histDone = [
    {
      direction: "sortant",
      body: "Parfait, je transmets votre adresse au livreur, il vous appelle dans quelques minutes.",
    },
  ];
  assert(outboundDeliveredAction(histDone[0].body), "handoff livreur = livré");
  assert(wasVerballyClosed(histDone), "clôture verbale livreur");
  assert(
    isCampaignObjectiveReached("ok", histDone, { closingGoal: "delivery" }),
    "ok après livreur → objectif",
  );

  const histOffer = [
    { direction: "sortant", body: "Le livreur peut passer demain, ça vous va ?" },
  ];
  assert(!outboundDeliveredAction(histOffer[0].body), "offre livreur ? ≠ livré");
}

console.log("\n=== Objectifs: ok après adieu ≠ conversion ===\n");
{
  const hist = [
    {
      direction: "sortant",
      body: "Compris, je ne vous dérange plus. Bonne continuation !",
    },
  ];
  assert(
    !isCampaignObjectiveReached("okay", hist, { closingGoal: "link" }),
    "okay après adieu ≠ conversion",
  );
}

console.log("\n=== Objectifs: ok après prix seul ≠ clôture (Support) ===\n");
{
  const hist = [
    {
      direction: "sortant",
      body: "Merci pour votre intérêt! Les baskets Nike noires et rouges sont disponibles à 40 000 FCFA.",
    },
  ];
  assert(!outboundDeliveredAction(hist[0].body), "prix seul ≠ action conversion livrée");
  assert(
    !isCampaignObjectiveReached("Okay", hist, { closingGoal: "link" }),
    "Okay après prix ≠ objectif",
  );
  assert(
    !isCampaignObjectiveReached("ok", hist, { closingGoal: "payment" }),
    "ok après prix ≠ objectif",
  );
  assert(
    !isCampaignObjectiveReached("merci", hist, { closingGoal: "link" }),
    "merci après prix ≠ objectif",
  );
}

console.log("\n=== RDV créneau ===\n");
{
  const hist = [
    { direction: "sortant", body: "Vous êtes dispo mardi ou mercredi cette semaine ?" },
  ];
  assert(
    isAppointmentSlotConfirmed("mardi à 14h", hist, { closingGoal: "appointment" }),
    "mardi 14h = créneau confirmé",
  );
  assert(
    !isAppointmentSlotConfirmed("mardi à 14h", hist, { closingGoal: "link" }),
    "créneau ignoré si goal ≠ appointment",
  );
}

console.log("\n=== Handoff mots-clés ===\n");
assert(
  findMatchingHandoffKeyword("Je veux un remboursement", ["remboursement", "plainte"]) ===
    "remboursement",
  "match remboursement",
);
assert(
  findMatchingHandoffKeyword("Combien ça coûte ?", ["remboursement"]) === null,
  "pas de faux positif prix",
);

console.log("\n=== Support catch-all typing ===\n");
{
  const catchAll = {
    type: "keyword_sales",
    config: { mode: "inbound_closing", inboundCatchAll: true },
  } as Automation;
  const phrase = {
    type: "keyword_sales",
    config: { mode: "inbound_closing", inboundCatchAll: false },
  } as Automation;
  assert(isInboundCatchAllCampaign(catchAll), "catch-all détecté");
  assert(!isInboundCatchAllCampaign(phrase), "phrases ≠ catch-all");
}

console.log("\n=== Sanitize / fallback MiniMax ===\n");
assert(
  looksLikeInternalMonologue("Il vient de répondre Solo. Je reste sur la mission puis je recadre."),
  "détecte monologue",
);
assert(
  !looksLikeInternalMonologue("Solo, parfait. Vous avez déjà un outil de gestion ?"),
  "vrai message ≠ monologue",
);
{
  const fb = safeFallbackWhatsAppReply("non je pense pas");
  assert(
    !/ne vous dérange plus/i.test(fb),
    `fallback soft « non je pense pas » ne clôture pas (got: ${fb.slice(0, 60)})`,
  );
  assert(
    /ne vous dérange plus/i.test(safeFallbackWhatsAppReply("non merci")),
    "fallback hard « non merci » clôture",
  );
}

console.log("\n=== Google Contacts: numéros Bénin 22901… ===\n");
{
  const key = phoneKeyFromWhatsAppId("2290166082161@c.us");
  assert(key === "22966082161", "JID 22901…13 → clé sans 01");
  assert(toE164Display(key!) === "+22966082161", "e164 canon");
  assert(phonesMatchStrict("22966082161", "2290166082161"), "match avec/sans 01");
  assert(phonesMatchStrict("+22966082161", "+229 01 66 08 21 61"), "match formaté");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
