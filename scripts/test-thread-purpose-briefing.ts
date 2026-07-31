/**
 * Tests : purpose fil (prospection | support) force le briefing inbound/outbound.
 * Usage : npx tsx scripts/test-thread-purpose-briefing.ts
 */
import {
  assessCampaignBriefing,
  buildBriefingNudge,
  isInboundClosingFlow,
  type BriefingAssessment,
} from "../src/campaign-briefing.js";
import type { AgentMessage } from "../src/db.js";

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function msg(role: "user" | "assistant", content: string): AgentMessage {
  return {
    id: Math.floor(Math.random() * 1e9),
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

console.log("=== isInboundClosingFlow + purpose ===");
{
  const hist = [msg("user", "Bonjour, on configure mon automatisation")];
  assert(
    "support → inbound même sans mot-clé",
    isInboundClosingFlow(hist, "Bonjour", "support") === true
  );
  assert(
    "prospection → outbound même si on dit déclencheur",
    isInboundClosingFlow(hist, "j'ai un déclencheur keyword_sales", "prospection") === false
  );
  assert(
    "null + support client dans le chat → inbound",
    isInboundClosingFlow(
      [msg("user", "Je veux du support client")],
      "ok",
      null
    ) === true
  );
}

console.log("\n=== assessCampaignBriefing purpose=support ===");
{
  const hist = [
    msg("user", "Je vends une cure minceur à 25000 FCFA"),
    msg("assistant", "Quelles phrases exactes doivent déclencher la réponse ?"),
  ];
  const a = assessCampaignBriefing(hist, "quand ils écrivent je suis intéressé", "support");
  assert("in flow", a.inCampaignFlow === true);
  assert("isInboundClosing", a.isInboundClosing === true);
  assert("openerDirection auto-OK", a.openerDirectionCollected === true);
  assert("variants auto-OK", a.openerVariantsProposed === true);
  assert(
    "pas d'exigence rythme sortant",
    !a.missing.some((m) => m.includes("rythme") || m.includes("horaires d'envoi"))
  );
}

console.log("\n=== assessCampaignBriefing purpose=prospection ===");
{
  const hist = [
    msg("user", "Je veux contacter mon groupe"),
    msg("assistant", "Quel groupe ?"),
  ];
  const a = assessCampaignBriefing(hist, "Groupe Business", "prospection");
  assert("in flow", a.inCampaignFlow === true);
  assert("pas inbound", a.isInboundClosing === false);
  assert(
    "pas d'exigence déclencheur",
    !a.missing.some((m) => m.includes("déclencheur"))
  );
}

console.log("\n=== buildBriefingNudge support prêt → pas d'opener ===");
{
  const ready: BriefingAssessment = {
    inCampaignFlow: true,
    questionsAsked: 8,
    missing: [],
    readyForDraft: true,
    isInboundClosing: true,
    openerDirectionCollected: true,
    openerVariantsProposed: true,
    stickersQuestionAsked: true,
    thirdPartyQuestionAsked: true,
    inboundPacingAsked: true,
  };
  const n = buildBriefingNudge(ready, [], "ok");
  assert(
    "nudge draft keyword_sales",
    !!n && /keyword_sales|inbound_closing/i.test(n) && !/premier message/i.test(n),
    n ?? "null"
  );
}

console.log("\n=== buildBriefingNudge prospection prêt → opener ===");
{
  const ready: BriefingAssessment = {
    inCampaignFlow: true,
    questionsAsked: 8,
    missing: [],
    readyForDraft: true,
    isInboundClosing: false,
    openerDirectionCollected: false,
    openerVariantsProposed: false,
    stickersQuestionAsked: true,
    thirdPartyQuestionAsked: true,
    inboundPacingAsked: true,
  };
  const n = buildBriefingNudge(ready, [], "ok");
  assert(
    "nudge premier message",
    !!n && /premier (message|contact)/i.test(n),
    n ?? "null"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
