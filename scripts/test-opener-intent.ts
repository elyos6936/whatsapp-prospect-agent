/**
 * Accroche dictée + 5 variantes (prospection).
 * Run: npx tsx scripts/test-opener-intent.ts
 */
import {
  extractUserDictatedOpener,
  formatOpenerVariantsReply,
  generateOpenerVariants,
} from "../src/opener-intent.js";
import {
  assessCampaignBriefing,
  hasNumberedOpenerList,
  hasProposedOpenerVariants,
  hasUserValidatedSingleOpener,
} from "../src/campaign-briefing.js";
import type { AgentMessage } from "../src/db.js";

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

console.log("\n=== extractUserDictatedOpener ===\n");
{
  const a = extractUserDictatedOpener(
    "Juste un 'Bonjour comment ça va ?' c'est ce que je veux"
  );
  assert(a === "Bonjour comment ça va ?", `dictée 1 (got ${a})`);

  const b = extractUserDictatedOpener(
    'Juste un "Bonjour comment ça va ?" comme premier message'
  );
  assert(b === "Bonjour comment ça va ?", `dictée 2 (got ${b})`);

  assert(extractUserDictatedOpener("a") == null, "choix a ≠ dictée");
  assert(extractUserDictatedOpener("ton direct") == null, "angle ≠ dictée");
}

console.log("\n=== 5 variantes générées ===\n");
{
  const v = generateOpenerVariants("Bonjour comment ça va ?");
  assert(v.length === 5, `5 variantes (got ${v.length})`);
  assert(v[0] === "Bonjour comment ça va ?", "v1 = texte validé");
  assert(new Set(v.map((x) => x.toLowerCase())).size === 5, "5 distinctes");

  const listed = formatOpenerVariantsReply("Bonjour comment ça va ?") || "";
  assert(hasNumberedOpenerList(listed), "liste 1–5 détectable");
}

console.log("\n=== mention « 5 variantes » ≠ déjà proposées ===\n");
{
  const hist = [
    msg(
      "assistant",
      "Quel angle pour le 1er message ? a / b / c. Puis une accroche, puis les **5 variantes**."
    ),
  ];
  assert(
    !hasProposedOpenerVariants(hist),
    "question d'angle ne compte pas comme les 5"
  );
  assert(
    hasUserValidatedSingleOpener(
      hist,
      "Juste un 'Bonjour comment ça va ?' c'est ce que je veux"
    ),
    "dictée = accroche validée"
  );

  const a = assessCampaignBriefing(
    hist,
    "Juste un 'Bonjour comment ça va ?' c'est ce que je veux",
    "prospection"
  );
  assert(a.openerVariantsProposed === false, "pas encore les 5 dans le fil");
  assert(a.openerSingleValidated === true, "opener validé");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
