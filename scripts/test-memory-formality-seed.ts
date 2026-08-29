/**
 * Formalité + prix/lien depuis la mémoire (seed / ton).
 * Run: npx tsx scripts/test-memory-formality-seed.ts
 */
import {
  extractPriceFromMemoryInstructions,
  extractUsefulLinkFromText,
  ensureFormalityInGuide,
  parseMemoryHints,
} from "../src/campaign-memory.js";
import {
  openerConflictsWithFormality,
  resolveReplyTone,
} from "../src/reply-tone.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const memTu =
  "- Je tutoie les interlocuteurs.\n" +
  "- Masterclass gratuite WhatsApp.\n" +
  "- Lien utile : https://chat.whatsapp.com/AbCdEfGh\n" +
  "- Prix : Gratuit\n";

const memVous =
  "- Je vouvoie les interlocuteurs.\n" +
  "- Offre no-code à 1500 FCFA.\n" +
  "- Lien : willwvs.pro\n";

console.log("=== extractPrice / extractLink ===");
assert(extractPriceFromMemoryInstructions(memTu) === "Gratuit", "gratuit depuis mémoire");
assert(
  extractPriceFromMemoryInstructions(memVous)?.includes("1500"),
  "1500 FCFA depuis mémoire",
);
assert(
  extractUsefulLinkFromText(memTu)?.includes("chat.whatsapp.com"),
  "lien groupe",
);
assert(
  extractUsefulLinkFromText(memVous)?.includes("willwvs.pro"),
  "lien bare domain",
);

console.log("=== ensureFormalityInGuide ===");
{
  const g = ensureFormalityInGuide("Mémoire « X » :\noffre cool", "tu");
  assert(/je\s+tutoie/i.test(g), "injecte tutoie");
  const g2 = ensureFormalityInGuide(g, "tu");
  assert(g2 === g, "idempotent si déjà ok");
  const g3 = ensureFormalityInGuide("- Je vouvoie les interlocuteurs.\nreste", "tu");
  assert(/je\s+tutoie/i.test(g3), "force tu même si vous déclaré");
}

console.log("=== resolveReplyTone memoryFormality ===");
{
  const tone = resolveReplyTone({
    memoryFormality: "tu",
    campaignTexts: ["Bonjour, je vous contacte pour…"],
  });
  assert(tone === "tu", "mémoire tu gagne sur accroche vous (sans sent)");
  const tone2 = resolveReplyTone({
    sentMessages: ["Parfait, je vous envoie ça."],
    memoryFormality: "tu",
  });
  assert(tone2 === "vous", "messages déjà envoyés gagnent");
}

console.log("=== openerConflictsWithFormality ===");
assert(
  openerConflictsWithFormality("Salut, je vous propose…", "tu"),
  "vous vs tu = conflit",
);
assert(
  !openerConflictsWithFormality("Salut, je te propose…", "tu"),
  "tu vs tu = ok",
);
assert(
  !openerConflictsWithFormality("Masterclass demain soir", "tu"),
  "sans pronom = ok",
);

console.log("=== parseMemoryHints formality ===");
assert(parseMemoryHints(memTu).formality === "tu", "hints tu");
assert(parseMemoryHints(memVous).formality === "vous", "hints vous");

console.log("\nOK — memory formality / price / link seed");
