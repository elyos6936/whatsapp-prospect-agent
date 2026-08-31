/**
 * Validation 5 accroches → brouillon : A–E, [nom], groupe entre quotes.
 * Run: npx tsx scripts/test-opener-draft-path.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  extractOpenerVariantsFromHistory,
  hasNumberedOpenerList,
  hasProposedOpenerVariants,
  hasValidProspectOpenerVariants,
  isShortCampaignValidation,
} from "../src/campaign-briefing.js";
import { extractProspectGroupQueryFromHistory } from "../src/deterministic-campaign.js";
import { stripProspectNamePlaceholders, hasTemplatePlaceholders } from "../src/outbound-sanitize.js";
import { looksLikePhantomCampaignUi } from "../src/user-facing.js";

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

console.log("\n=== variants 1–5 ===\n");
{
  const history = [
    msg(
      "assistant",
      "Voici les 5 variantes :\n1. « Salut, tu as une minute ? »\n2. « Coucou, une minute ? »\n3. « Hello, tu as 30 secondes ? »\n4. « Hey, je te dérange ? »\n5. « Bonjour, une minute à m'accorder ? »",
    ),
  ];
  const v = extractOpenerVariantsFromHistory(history);
  assert(hasNumberedOpenerList(history[0]!.content), "hasNumberedOpenerList 1-5");
  assert(v?.length === 5, "extract 5 numbered");
  assert(v?.[0]?.message.includes("Salut"), "v1 text");
}

console.log("\n=== variants A–E ===\n");
{
  const history = [
    msg(
      "assistant",
      "Voici 5 variantes :\nA. « Salut [nom] vu sur la société klan. As tu une minute à m'accorder? »\nB. « Salut, vu sur klan. Une minute ? »\nC. « Coucou, société klan — tu as une minute ? »\nD. « Hey, klan ici. Tu as 30 secondes ? »\nE. « Bonjour, vu sur klan. On peut échanger 1 min ? »",
    ),
  ];
  assert(hasNumberedOpenerList(history[0]!.content), "hasNumberedOpenerList A-E");
  const v = extractOpenerVariantsFromHistory(history);
  assert(v?.length === 5, "extract 5 lettered");
  assert(Boolean(v?.[0]?.message.includes("klan")), "vA has klan");
  assert(!v?.[0]?.message.includes("Elodie"), "not a member dump");
}

console.log("\n=== skip member dump as variants ===\n");
{
  const history = [
    msg(
      "assistant",
      "5 membres :\n1. Elodie CASAS +33621458123\n2. Jean DUPONT +33600000000\n3. Marie MARTIN +33611111111\n4. Paul BERNARD +33622222222\n5. Luc PETIT +33633333333",
    ),
  ];
  const v = extractOpenerVariantsFromHistory(history);
  assert(v == null, "member phones are not openers");
  assert(!hasProposedOpenerVariants(history), "hasProposedOpenerVariants false on member dump");
}

console.log("\n=== Test 1 Will — SGBD member list + maintenant ===\n");
{
  const history = [
    msg(
      "assistant",
      'Voici vos groupes WhatsApp (122) :\n1. "Institut de Coiffure"\n2. (Agent) IA V2\n3. EEIA-SAP\n4. JEEP eFoot\n5. More groups…',
    ),
    msg(
      "assistant",
      "Voici les membres du groupe « SGBD & PL-EDL » (7) :\n\n1. +22997365155\n2. +22959593540 · admin\n3. +22952353484\n4. +22951781761\n5. +22945631585\n6. +22945584212\n7. +22942695820",
    ),
    msg("assistant", "Tu veux que je lance la prospection à quel moment exactement ? (maintenant, demain matin, lundi 9h…)"),
    msg("user", "maintenant"),
  ];
  assert(hasNumberedOpenerList(history[1]!.content), "member list still numbered");
  assert(extractOpenerVariantsFromHistory(history) == null, "no fake openers from member list");
  assert(!hasValidProspectOpenerVariants(history), "maintenant must not unlock draft");
  assert(!hasProposedOpenerVariants(history), "openerVariantsProposed false before real variants");
}

console.log("\n=== validation courte ===\n");
{
  assert(isShortCampaignValidation("oui, c'est bon"), "oui, c'est bon");
  assert(isShortCampaignValidation("je valide"), "je valide");
}

console.log("\n=== groupe quotes ===\n");
{
  const h1 = [msg("user", "Je veux prospecter tous les membres du groupe 'Extension'")];
  assert(
    extractProspectGroupQueryFromHistory(h1) === "Extension",
    "groupe 'Extension'",
  );
  const h2 = [msg("user", "prospecter les membres du groupe « CLAN ECLAIREURS »")];
  assert(
    extractProspectGroupQueryFromHistory(h2) === "CLAN ECLAIREURS",
    "groupe « CLAN ECLAIREURS »",
  );
}

console.log("\n=== [nom] strip ===\n");
{
  const stripped = stripProspectNamePlaceholders(
    "Salut [nom] vu sur la société klan. As tu une minute à m'accorder?",
  );
  assert(!hasTemplatePlaceholders(stripped), "no leftover brackets");
  assert(/klan/i.test(stripped), "keeps offer wording");
  assert(!/\[nom\]/i.test(stripped), "removed [nom]");
}

console.log("\n=== phantom UI ===\n");
{
  assert(
    looksLikePhantomCampaignUi(
      "D'accord, c'est parti pour ta campagne. Clique sur le bouton pour confirmer la campagne.",
    ),
    "click-the-button",
  );
  assert(
    looksLikePhantomCampaignUi(
      "Une erreur est survenue lors de la création de votre campagne. Réessayez plus tard.",
    ),
    "generic create error",
  );
  assert(
    !looksLikePhantomCampaignUi("Clique sur le bouton Mémoire en haut du chat."),
    "memory button is real UI",
  );
  assert(
    looksLikePhantomCampaignUi(
      "Désolé je ne peux effectuer l'instruction. Tu peux me proposer les accroches, créer le brouillon, simuler la campagne.",
    ),
    "stall paraphrase",
  );
  assert(
    looksLikePhantomCampaignUi(
      "Je ne comprends pas, votre mémoire ne contient pas l'opener, cette campagne risque de ne pas se lancer.",
    ),
    "memory missing opener",
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
