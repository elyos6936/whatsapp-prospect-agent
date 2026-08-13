/**
 * Vague 5 — promesses photo/lien du DM.
 * Run: npx tsx scripts/test-outbound-promise-guard.ts
 */
import {
  fulfillOutboundPromises,
  replyHasUrl,
  replyPromisesLink,
  replyPromisesMedia,
} from "../src/outbound-promise-guard.js";

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

console.log("\n=== Détection promesse vs offre ===\n");
assert(
  replyPromisesLink("Je vous envoie le lien tout de suite."),
  "promesse lien"
);
assert(
  !replyPromisesLink("Je vous envoie le lien ?"),
  "offre « je vous envoie le lien ? » ≠ promesse"
);
assert(
  replyPromisesMedia("Je vous envoie la photo du produit."),
  "promesse photo"
);
assert(
  !replyPromisesMedia("Je vous envoie la photo ?"),
  "offre photo ≠ promesse"
);
assert(replyHasUrl("Voici https://pay.example/x"), "URL détectée");
assert(!replyHasUrl("Je vous envoie le lien."), "sans URL");

console.log("\n=== Lien promis + closingLink → joint ===\n");
{
  const r = fulfillOutboundPromises("Je vous envoie le lien tout de suite.", {
    closingLink: "https://calendly.com/demo",
    hasMedia: false,
  });
  assert(r.appendLink, "flag append");
  assert(r.reply.includes("https://calendly.com/demo"), "URL ajoutée");
  assert(!r.strippedLinkPromise, "pas retiré");
}

console.log("\n=== Lien promis sans config → promesse retirée ===\n");
{
  const r = fulfillOutboundPromises(
    "Parfait. Je vous envoie le lien tout de suite.",
    { closingLink: "", hasMedia: false }
  );
  assert(r.strippedLinkPromise, "flag strip lien");
  assert(!/envoie le lien/i.test(r.reply), "promesse absente");
  assert(!r.appendLink, "rien à joindre");
}

console.log("\n=== Lien déjà dans le texte → no-op ===\n");
{
  const r = fulfillOutboundPromises(
    "Voici le lien : https://calendly.com/demo",
    { closingLink: "https://calendly.com/demo", hasMedia: false }
  );
  assert(!r.appendLink, "pas de doublon");
  assert(
    (r.reply.match(/calendly\.com\/demo/g) || []).length === 1,
    "une seule URL"
  );
}

console.log("\n=== Photo promise + mediaUrl → attach ===\n");
{
  const r = fulfillOutboundPromises("Je vous envoie la photo.", {
    closingLink: null,
    hasMedia: true,
  });
  assert(r.attachMedia, "flag attach");
  assert(/photo/i.test(r.reply), "texte conservé (média partira)");
  assert(!r.strippedMediaPromise, "pas retiré");
}

console.log("\n=== Photo promise sans média → promesse retirée ===\n");
{
  const r = fulfillOutboundPromises(
    "Je vous envoie la photo. Dites-moi si ça correspond.",
    { hasMedia: false }
  );
  assert(r.strippedMediaPromise, "flag strip photo");
  assert(!/envoie la photo/i.test(r.reply), "promesse absente");
  assert(/correspond/i.test(r.reply), "le reste est conservé");
}

console.log("\n=== Offre interrogative inchangée (flux oui → lien) ===\n");
{
  const r = fulfillOutboundPromises("Je vous envoie le lien ?", {
    closingLink: "https://calendly.com/demo",
    hasMedia: false,
  });
  assert(!r.appendLink, "offre ≠ auto-join (ensurePendingLink gère le oui)");
  assert(r.reply === "Je vous envoie le lien ?", "texte intact");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
