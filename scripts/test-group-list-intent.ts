/**
 * Intentions listes membres / publication groupes.
 * Run: npx tsx scripts/test-group-list-intent.ts
 */
import {
  detectGroupPublishIntent,
  detectQuickGroupMembersIntent,
  lastGroupQueryFromHistory,
  looksLikeBareGroupName,
  resolveMembersIntentFromHistory,
} from "../src/group-list-intent.js";
import { shouldDeterministicGroupsDraft } from "../src/groups-flow.js";
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

console.log("\n=== detectQuickGroupMembersIntent ===\n");
{
  const a = detectQuickGroupMembersIntent("donne moi 3 contacts du groupe RADAR");
  assert(a?.groupQuery === "RADAR", `RADAR nommé (got ${a?.groupQuery})`);
  assert(a?.limit === 3, `limit 3 (got ${a?.limit})`);

  const b = detectQuickGroupMembersIntent("okay donne moi 3 contacts du groupe");
  assert(b != null && b.groupQuery === "", "3 contacts du groupe sans nom");
  assert(b?.limit === 3, "limit 3 sans nom");

  const c = detectQuickGroupMembersIntent("GIT3 Information 25-26");
  assert(c == null, "nom seul n'est pas un intent membres");
}

console.log("\n=== looksLikeBareGroupName ===\n");
{
  assert(looksLikeBareGroupName("GIT3 Information 25-26"), "GIT3 est un nom");
  assert(!looksLikeBareGroupName("okay donne moi 3 contacts du groupe"), "pas un nom");
  assert(!looksLikeBareGroupName("okay"), "okay n'est pas un nom");
}

console.log("\n=== resolveMembersIntentFromHistory (captures) ===\n");
{
  const hist = [
    msg("user", "donne moi 3 contacts du groupe RADAR"),
    msg("assistant", "Groupe introuvable : « RADAR »."),
    msg("user", "GIT3 Information 25-26"),
    msg("assistant", "Tu n'es pas admin…"),
    msg("user", "okay donne moi 3 contacts du groupe"),
  ];

  const fromBare = resolveMembersIntentFromHistory("GIT3 Information 25-26", hist.slice(0, 2));
  assert(
    fromBare?.groupQuery === "GIT3 Information 25-26",
    `nom seul après RADAR → GIT3 (got ${fromBare?.groupQuery})`
  );
  assert(fromBare?.limit === 3, "reprend limit 3");

  const followUp = resolveMembersIntentFromHistory(
    "okay donne moi 3 contacts du groupe",
    hist
  );
  assert(
    followUp?.groupQuery === "GIT3 Information 25-26",
    `follow-up préfère GIT3 pas RADAR (got ${followUp?.groupQuery})`
  );
  assert(followUp?.limit === 3, "follow-up limit 3");

  const last = lastGroupQueryFromHistory(hist.slice(0, -1));
  assert(last?.query === "GIT3 Information 25-26", "dernier nom = GIT3 (correction)");
}

console.log("\n=== detectGroupPublishIntent ===\n");
{
  assert(detectGroupPublishIntent("lancer campagne"), "lancer campagne = écriture");
  assert(detectGroupPublishIntent("lance la campagne"), "lance la campagne");
  assert(detectGroupPublishIntent("envoie dans le groupe"), "envoie dans le groupe");
  assert(
    !detectGroupPublishIntent("okay donne moi 3 contacts du groupe"),
    "extraction contacts ≠ écriture"
  );
  assert(!detectGroupPublishIntent("donne moi 3 contacts du groupe RADAR"), "RADAR extract ≠ écriture");
}

console.log("\n=== shouldDeterministicGroupsDraft ignore contacts ===\n");
{
  const hist = [
    msg("user", "Message : Promo demain"),
    msg("user", "dans le groupe Team MASK"),
  ];
  assert(
    !shouldDeterministicGroupsDraft("okay donne moi 3 contacts du groupe", hist),
    "okay + contacts ne crée pas de brouillon"
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
