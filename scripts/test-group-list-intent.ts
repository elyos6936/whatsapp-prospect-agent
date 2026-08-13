/**
 * Intentions listes membres / publication groupes.
 * Run: npx tsx scripts/test-group-list-intent.ts
 */
import {
  detectGroupPublishIntent,
  detectGroupSendNowIntent,
  detectQuickGroupMembersIntent,
  extractGroupNameFromPublishMessage,
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
  assert(looksLikeBareGroupName("Le labo du no code"), "Le labo est un nom");
  assert(!looksLikeBareGroupName("okay donne moi 3 contacts du groupe"), "pas un nom");
  assert(!looksLikeBareGroupName("okay"), "okay n'est pas un nom");
  assert(!looksLikeBareGroupName("je suis admin bro"), "confirmation admin ≠ nom");
  assert(
    !looksLikeBareGroupName("je suis admin du groupe en question"),
    "phrase admin ≠ nom"
  );
}

console.log("\n=== confirmation admin ne déclenche pas l'extract ===\n");
{
  const hist = [
    msg("user", "donne moi 3 contacts du groupe le Labo du no code"),
    msg("assistant", "Tu n'es pas admin…"),
  ];
  assert(
    resolveMembersIntentFromHistory("je suis admin bro", hist) == null,
    "« je suis admin bro » → pas un extract"
  );
  assert(
    resolveMembersIntentFromHistory("je suis admin du groupe en question", hist) == null,
    "« je suis admin du groupe en question » → pas un extract"
  );
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
    detectGroupPublishIntent("Envoie 'Salut' dans le groupe Le labo du no code à 14h"),
    "envoie + groupe + heure"
  );
  assert(
    !detectGroupPublishIntent("okay donne moi 3 contacts du groupe"),
    "extraction contacts ≠ écriture"
  );
  assert(!detectGroupPublishIntent("donne moi 3 contacts du groupe RADAR"), "RADAR extract ≠ écriture");
  assert(
    !detectGroupPublishIntent("Ajoute +22966082161 dans mon groupe Le Labo du No code"),
    "ajouter un membre ≠ publication"
  );
}

console.log("\n=== detectGroupSendNowIntent (pas campagne, pas lien) ===\n");
{
  const a = detectGroupSendNowIntent('Super. Envoie "Salut Klanvio 1" dans le groupe Automax');
  assert(a?.message === "Salut Klanvio 1", `message Automax (got ${a?.message})`);
  assert(/automax/i.test(a?.groupQuery ?? ""), `groupe Automax (got ${a?.groupQuery})`);
  assert(!a?.sendAtLocal, "envoi immédiat");

  const b = detectGroupSendNowIntent(
    "Envoie dans mon groupe le Labo du No code , le message 'Bien c'est parti' à 15h11"
  );
  assert(
    /bien c'est parti/i.test(b?.message ?? ""),
    `message Labo (got ${b?.message})`
  );
  assert(/labo du no code/i.test(b?.groupQuery ?? ""), `groupe Labo (got ${b?.groupQuery})`);
  assert(b?.sendAtLocal === "15:11", `heure 15:11 (got ${b?.sendAtLocal})`);

  const c = detectGroupSendNowIntent("Non envoie juste 'Salut Klanvio 1' dans ce groupe");
  assert(c?.message === "Salut Klanvio 1", "ce groupe + message");
  assert(!c?.groupQuery, "ce groupe → nom via historique");
}

console.log("\n=== extractGroupNameFromPublishMessage (pas l'historique) ===\n");
{
  const a = extractGroupNameFromPublishMessage(
    "Envoie 'Salut' dans le groupe Le labo du no code à 14h"
  );
  assert(
    a === "Le labo du no code",
    `envoie Salut → Le labo (got ${a})`
  );
  const b = extractGroupNameFromPublishMessage("Non envoie dans le groupe 'Le labo du no code'");
  assert(b === "Le labo du no code", `correction citée (got ${b})`);
  assert(
    extractGroupNameFromPublishMessage("lancer campagne") == null,
    "lancer campagne sans nom → null (fallback historique)"
  );
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
