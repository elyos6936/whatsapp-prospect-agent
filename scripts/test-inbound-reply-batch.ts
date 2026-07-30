/**
 * Tests pacing closing entrant + détection question briefing.
 * npx tsx scripts/test-inbound-reply-batch.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  buildBriefingNudge,
  assessCampaignBriefing,
  hasInboundPacingQuestionAsked,
  hasStickersQuestionAsked,
  hasThirdPartyQuestionAsked,
} from "../src/campaign-briefing.js";
import {
  clampToSendWindow,
  computeNextInboundSlot,
  resolveInboundPacing,
  type InboundPacingConfig,
} from "../src/inbound-reply-batch.js";

function msg(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: 0,
    user_id: 1,
    thread_id: 1,
    role,
    content,
    created_at: new Date().toISOString(),
  } as AgentMessage;
}

let failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function pacingDefaults(over: Partial<InboundPacingConfig> = {}): InboundPacingConfig {
  return {
    batchSize: 50,
    waveGapMinutes: 120,
    intraMinSeconds: 60,
    intraMaxSeconds: 120,
    sendWindowStartHour: 8,
    sendWindowEndHour: 19,
    ...over,
  };
}

console.log("\n=== resolveInboundPacing ===");
{
  const p = resolveInboundPacing({
    quietHoursStart: 19,
    quietHoursEnd: 8,
    inboundWaveGapMinutes: 45, // clamp → 60
    inboundBatchSize: 50,
  });
  assert("gap min 60", p.waveGapMinutes === 60);
  assert("fenêtre 8→19", p.sendWindowStartHour === 8 && p.sendWindowEndHour === 19);
  assert("batch 50", p.batchSize === 50);
}

console.log("\n=== clampToSendWindow ===");
{
  const p = pacingDefaults();
  const morning = clampToSendWindow(new Date(2026, 6, 28, 7, 10, 0), p);
  assert("avant 8h → 8h", morning.getHours() === 8);

  const evening = clampToSendWindow(new Date(2026, 6, 28, 19, 5, 0), p);
  assert(
    "après 19h → lendemain 8h",
    evening.getDate() === 29 && evening.getHours() === 8,
    evening.toString()
  );

  const midday = clampToSendWindow(new Date(2026, 6, 28, 14, 0, 0), p);
  assert("dans la plage inchangé", midday.getHours() === 14);
}

console.log("\n=== computeNextInboundSlot — 1ʳᵉ vague immédiate ===");
{
  const p = pacingDefaults();
  const now = new Date(2026, 6, 28, 10, 0, 0);
  const first = computeNextInboundSlot(now, [], p, 90_000);
  assert("1er slot = now", first.getTime() === now.getTime());
}

console.log("\n=== computeNextInboundSlot — intra-vague 1–2 min ===");
{
  const p = pacingDefaults({ batchSize: 50 });
  const now = new Date(2026, 6, 28, 10, 0, 0);
  const existing = [new Date(2026, 6, 28, 10, 0, 0)];
  const next = computeNextInboundSlot(now, existing, p, 90_000);
  assert(
    "+90s après le dernier",
    next.getTime() === existing[0]!.getTime() + 90_000,
    String(next)
  );
}

console.log("\n=== computeNextInboundSlot — vague pleine → +2h ===");
{
  const p = pacingDefaults({ batchSize: 3, waveGapMinutes: 120 });
  const t0 = new Date(2026, 6, 28, 10, 0, 0);
  const existing = [
    t0,
    new Date(t0.getTime() + 90_000),
    new Date(t0.getTime() + 180_000),
  ];
  const now = new Date(t0.getTime() + 200_000);
  const next = computeNextInboundSlot(now, existing, p, 90_000);
  const expected = new Date(t0.getTime() + 120 * 60_000);
  assert(
    "début vague 2 = t0 + 2h",
    next.getTime() === expected.getTime(),
    `got ${next.toISOString()} expected ${expected.toISOString()}`
  );
}

console.log("\n=== computeNextInboundSlot — hors plage mid-vague ===");
{
  const p = pacingDefaults({ batchSize: 50 });
  const last = new Date(2026, 6, 28, 18, 59, 0);
  const now = new Date(2026, 6, 28, 18, 59, 30);
  const next = computeNextInboundSlot(now, [last], p, 120_000);
  assert(
    "report lendemain 8h si dépasse 19h",
    next.getDate() === 29 && next.getHours() === 8,
    next.toString()
  );
}

console.log("\n=== Briefing — question pacing détectée ===");
{
  const ask =
    "Pour éviter les blocages WhatsApp, je réponds par vagues de 50 (1–2 min entre chaque). " +
    "Délai entre deux vagues ? (minimum 1 h, recommandé 2 h) Et plage d'envoi ? (ex. 8h–19h).";
  assert("regex pacing match", hasInboundPacingQuestionAsked([msg("assistant", ask)]));
  assert(
    "stickers ne match pas pacing",
    !hasInboundPacingQuestionAsked([
      msg("assistant", "Tu veux que j'ajoute des stickers dans les conversations ? (oui/non)"),
    ])
  );
}

console.log("\n=== Briefing — ordre stickers → tiers → pacing (inbound) ===");
{
  // Teste l'ordre des nudges avec un assessment « ready » synthétique
  // (évite de dépendre du compteur de questions du brief).
  type A = import("../src/campaign-briefing.js").BriefingAssessment;
  const base: A = {
    inCampaignFlow: true,
    questionsAsked: 8,
    missing: [],
    readyForDraft: true,
    isInboundClosing: true,
    openerDirectionCollected: true,
    openerVariantsProposed: true,
    stickersQuestionAsked: false,
    thirdPartyQuestionAsked: false,
    inboundPacingAsked: false,
  };

  const n1 = buildBriefingNudge(base, [], "ok");
  assert(
    "1) stickers d'abord",
    !!n1 && /stickers/i.test(n1) && !/vagues de 50/i.test(n1),
    n1 ?? "null"
  );

  const n2 = buildBriefingNudge(
    { ...base, stickersQuestionAsked: true },
    [],
    "non"
  );
  assert(
    "2) tiers ensuite",
    !!n2 && /tiers|livreur/i.test(n2) && !/vagues de 50/i.test(n2),
    n2 ?? "null"
  );

  const n3 = buildBriefingNudge(
    { ...base, stickersQuestionAsked: true, thirdPartyQuestionAsked: true },
    [],
    "non"
  );
  assert(
    "3) pacing après tiers",
    !!n3 && /vagues de 50/i.test(n3) && /anti-blocage|blocages/i.test(n3),
    n3 ?? "null"
  );

  const n4 = buildBriefingNudge(
    {
      ...base,
      stickersQuestionAsked: true,
      thirdPartyQuestionAsked: true,
      inboundPacingAsked: true,
    },
    [],
    "2h"
  );
  assert(
    "4) après pacing → brouillon (pas d'opener)",
    !!n4 &&
      /create_automation/i.test(n4) &&
      /Pas de 5 variantes/i.test(n4) &&
      /inbound_wave_gap_minutes/i.test(n4),
    n4 ?? "null"
  );

  // Détection réelle dans un fil (regex + assess)
  const hist = [
    msg("user", "Campagne keyword_sales / closing entrant"),
    msg(
      "assistant",
      "Tu veux que j'ajoute des stickers dans les conversations avec les prospects ? (oui/non)"
    ),
    msg("user", "non"),
    msg(
      "assistant",
      "Quand un prospect convertit, tu veux qu'on prévienne automatiquement un tiers (livreur, associé, commercial…) sur WhatsApp ? (oui/non)"
    ),
    msg("user", "non"),
    msg(
      "assistant",
      "Pour éviter les blocages, je réponds par vagues de 50. Délai entre deux vagues ? (min 1 h) Et plage d'envoi 8h–19h ?"
    ),
  ];
  assert("detect stickers", hasStickersQuestionAsked(hist));
  assert("detect tiers", hasThirdPartyQuestionAsked(hist));
  assert("detect pacing", hasInboundPacingQuestionAsked(hist));
  const assessed = assessCampaignBriefing(hist, "2h");
  assert("assess inbound", assessed.isInboundClosing === true);
  assert("assess pacing asked", assessed.inboundPacingAsked === true);
}

console.log("\n=== Briefing — outbound ne demande PAS le pacing ===");
{
  type A = import("../src/campaign-briefing.js").BriefingAssessment;
  const outboundReady: A = {
    inCampaignFlow: true,
    questionsAsked: 8,
    missing: [],
    readyForDraft: true,
    isInboundClosing: false,
    openerDirectionCollected: false,
    openerVariantsProposed: false,
    stickersQuestionAsked: true,
    thirdPartyQuestionAsked: true,
    inboundPacingAsked: true, // N/A outbound
  };
  const n = buildBriefingNudge(outboundReady, [], "ok");
  assert(
    "outbound → opener direction (pas pacing)",
    !!n && /premier (message|contact)/i.test(n) && !/vagues de 50/i.test(n),
    n ?? "null"
  );

  const hist = [
    msg("user", "Je veux prospecter mon groupe WhatsApp"),
    msg("assistant", "Quel groupe ?"),
  ];
  const a = assessCampaignBriefing(hist, "Groupe Business");
  assert("pas inbound", a.isInboundClosing === false);
  assert("inboundPacingAsked=true (N/A)", a.inboundPacingAsked === true);
}

console.log(`\n${failed === 0 ? "✅ Tous les tests OK" : `❌ ${failed} échec(s)`}\n`);
process.exit(failed === 0 ? 0 : 1);
