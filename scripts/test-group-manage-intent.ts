/**
 * Intents ajouter / retirer / admin / lien groupes.
 * Run: npx tsx scripts/test-group-manage-intent.ts
 */
import {
  detectCreateGroupIntent,
  detectGroupInviteLinkIntent,
  detectGroupInviteSendIntent,
  detectGroupManageIntent,
  detectJoinGroupInviteIntent,
  detectLeaveGroupIntent,
  isGroupNonPublishAction,
  looksLikeAdminConfirmation,
  resolveManageIntentFromHistory,
} from "../src/group-manage-intent.js";
import { buildGroupsBriefingNudge } from "../src/groups-flow.js";
import { assessCampaignBriefing } from "../src/campaign-briefing.js";
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

console.log("\n=== detectGroupManageIntent ===\n");
{
  const a = detectGroupManageIntent(
    "Ajoute +22966082161 dans mon groupe Le Labo du No code"
  );
  assert(a?.action === "add", `action add (got ${a?.action})`);
  assert(a?.phones.some((p) => /66082161/.test(p)), `téléphone (got ${a?.phones})`);
  assert(
    /labo du no code/i.test(a?.groupQuery ?? ""),
    `groupe Labo (got ${a?.groupQuery})`
  );

  const b = detectGroupManageIntent("Retire +22941822980 du groupe GIT3 Information 25-26");
  assert(b?.action === "remove", "remove");
  assert(/GIT3/i.test(b?.groupQuery ?? ""), `GIT3 (got ${b?.groupQuery})`);

  assert(
    detectGroupManageIntent("donne moi 3 contacts du groupe RADAR") == null,
    "extract contacts ≠ manage"
  );
  assert(
    detectGroupManageIntent("Envoie 'Salut' dans le groupe Le labo") == null,
    "envoie message ≠ manage"
  );

  const promo = detectGroupManageIntent("fais +22966082161 admin du groupe Le Labo du No code");
  assert(promo?.action === "promote", `promote (got ${promo?.action})`);

  const invAdd = detectGroupManageIntent("invite +22966082161 dans le groupe Le Labo du No code");
  assert(invAdd?.action === "add", "invite + numéro = add");
}

console.log("\n=== admin confirm + history ===\n");
{
  assert(looksLikeAdminConfirmation("je suis admin bro"), "je suis admin bro");
  assert(
    looksLikeAdminConfirmation("je suis admin du groupe en question"),
    "je suis admin du groupe"
  );
  assert(!looksLikeAdminConfirmation("GIT3 Information 25-26"), "nom ≠ confirm");

  const hist = [
    msg("user", "Ajoute +22966082161 dans mon groupe Le Labo du No code"),
    msg("assistant", "Tu n'es pas admin…"),
  ];
  const retry = resolveManageIntentFromHistory("je suis admin bro", hist);
  assert(retry?.action === "add", "retry add");
  assert(/labo/i.test(retry?.groupQuery ?? ""), "retry garde le groupe");
  assert(retry?.phones.length === 1, "retry garde le numéro");
}

console.log("\n=== invite / leave / non-publish ===\n");
{
  const inv = detectGroupInviteLinkIntent("donne moi le lien d'invitation du groupe Team MASK");
  assert(/Team MASK/i.test(inv?.groupQuery ?? ""), `lien (got ${inv?.groupQuery})`);
  assert(inv?.action === "get_code", "lien = get_code");
  const rev = detectGroupInviteLinkIntent("révoque le lien du groupe Team MASK");
  assert(rev?.action === "revoke_code", "révoque");
  const send = detectGroupInviteSendIntent(
    "envoie le lien d'invitation du groupe Team MASK à +22966082161"
  );
  assert(send?.phones.length === 1, "send invite phones");
  assert(
    send?.groupQuery === "Team MASK",
    `send invite groupe (got ${send?.groupQuery})`
  );
  const join = detectJoinGroupInviteIntent("rejoins https://chat.whatsapp.com/AbCdEfGh123");
  assert(join?.inviteCode === "AbCdEfGh123", `join (got ${join?.inviteCode})`);
  const created = detectCreateGroupIntent("crée un groupe Team MASK avec +22966082161");
  assert(/Team MASK/i.test(created?.subject ?? ""), `create subject (got ${created?.subject})`);
  assert(created?.phones.length === 1, "create phones");
  assert(detectLeaveGroupIntent("quitte le groupe Team MASK")?.groupQuery, "quitte");
  assert(
    isGroupNonPublishAction("Ajoute +22966082161 dans mon groupe Le Labo du No code"),
    "add = non-publish"
  );
  assert(
    isGroupNonPublishAction("crée un groupe Team MASK avec +22966082161"),
    "create = non-publish"
  );
  assert(
    detectGroupInviteLinkIntent(
      "Envoie dans mon groupe le Labo du No code , le message 'Bien c'est parti' à 15h11"
    ) == null,
    "No code + envoie message ≠ lien d'invitation"
  );
  assert(
    !isGroupNonPublishAction(
      "Envoie dans mon groupe le Labo du No code , le message 'Bien c'est parti' à 15h11"
    ),
    "poster un texto ≠ action membres"
  );
}

console.log("\n=== nudge ne vole pas l'ajout ===\n");
{
  const hist = [
    msg("user", "Je veux lancer une campagne"),
    msg("assistant", "Il me manque le message…"),
  ];
  const a = assessCampaignBriefing(
    hist,
    "Ajoute +22966082161 dans mon groupe Le Labo du No code",
    "groupes"
  );
  const nudge =
    buildGroupsBriefingNudge(
      a,
      hist,
      "Ajoute +22966082161 dans mon groupe Le Labo du No code"
    ) || "";
  assert(/manage_group_participants/i.test(nudge), "nudge manage");
  assert(!/Pose UNE question/i.test(nudge), "ne pose pas la question poster");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
