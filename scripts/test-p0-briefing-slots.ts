/**
 * P0 multi-turn : slot satisfy oui/non + asked≠answered stickers.
 * Run: npx tsx scripts/test-p0-briefing-slots.ts
 */
import {
  assessCampaignBriefing,
  BRIEFING_Q_HANDOFF,
  BRIEFING_Q_THIRD_PARTY,
  nextCanonicalBriefingQuestion,
} from "../src/campaign-briefing.js";
import type { AgentMessage } from "../src/db.js";
import {
  briefingStatePatchForSatisfiedSlot,
  userMessageSatisfiesSlot,
} from "../src/thread-briefing-state.js";

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
  return { id: 0, user_id: 1, thread_id: 1, role, content, created_at: new Date().toISOString() };
}

const STICKERS_Q =
  "Tu veux que j'ajoute des stickers dans les conversations avec les prospects ? (oui/non)";

console.log("\n=== GAP-009 : oui/non satisfont stickers / tiers / handoff ===\n");
{
  assert(userMessageSatisfiesSlot(STICKERS_Q, "oui"), "oui → stickers");
  assert(userMessageSatisfiesSlot(STICKERS_Q, "non"), "non → stickers");
  assert(userMessageSatisfiesSlot(BRIEFING_Q_THIRD_PARTY, "oui"), "oui → tiers");
  assert(userMessageSatisfiesSlot(BRIEFING_Q_THIRD_PARTY, "non"), "non → tiers");
  assert(userMessageSatisfiesSlot(BRIEFING_Q_HANDOFF, "non"), "non → handoff");
  assert(
    userMessageSatisfiesSlot(BRIEFING_Q_HANDOFF, "remboursement, plainte"),
    "liste → handoff",
  );
  assert(
    briefingStatePatchForSatisfiedSlot(STICKERS_Q, "oui").stickersAnswered === true,
    "patch stickersAnswered",
  );
}

console.log("\n=== GAP-010 : hard-return stickers sans réponse → reste sur stickers ===\n");
{
  const hist = [
    msg("user", "Je veux prospecter pour ma formation 50k FCFA"),
    msg("assistant", "Qui contacter ?"),
    msg("user", "groupe Automax, demain 9h, objectif RDV https://cal.com/x"),
    msg("assistant", "Comment te présenter ?"),
    msg("user", "Paul coach"),
    // Hard-return collé — pas encore de réponse user
    msg("assistant", STICKERS_Q),
  ];
  const a = assessCampaignBriefing(hist, "ok", "prospection");
  assert(!a.stickersQuestionAsked, "stickers pas encore répondu (asked≠answered)");
  const next = nextCanonicalBriefingQuestion(a, hist, "ok");
  assert(
    next != null && /stickers/i.test(next),
    `next reste stickers (got ${next?.slice(0, 60)})`,
  );
}

console.log("\n=== GAP-010 suite : oui après stickers → slot passé ===\n");
{
  const hist = [
    msg("user", "Je veux prospecter pour ma formation 50k FCFA"),
    msg("assistant", "Qui contacter ?"),
    msg("user", "groupe Automax, demain 9h, objectif RDV https://cal.com/x"),
    msg("assistant", "Comment te présenter ?"),
    msg("user", "Paul coach"),
    msg("assistant", STICKERS_Q),
    msg("user", "oui"),
  ];
  const a = assessCampaignBriefing(hist, "oui", "prospection", null, {
    stickersAnswered: true,
  });
  assert(a.stickersQuestionAsked, "stickers répondu via persist");
}

console.log("\n=== GAP-018 Support : oui après stickers compte ===\n");
{
  const hist = [
    msg("user", "Je veux du support client tous les messages"),
    msg("assistant", "Quel produit ?"),
    msg("user", "Formation 50k FCFA, présente-toi comme Marie, lien https://cal.com/x"),
    msg("assistant", "Tu veux des stickers ?"),
    msg("user", "non"),
  ];
  const a = assessCampaignBriefing(hist, "non", "support");
  assert(a.stickersQuestionAsked, "support stickers answered");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
