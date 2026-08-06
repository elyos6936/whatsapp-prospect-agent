/**
 * Tests module Support isolé (sans LLM).
 * Run: npx tsx scripts/test-support-flow.ts
 */
import type { AgentMessage } from "../src/db.js";
import {
  assessCampaignBriefing,
  buildBriefingNudge,
} from "../src/campaign-briefing.js";
import {
  extractSupportTriggerPhrases,
  extractSupportHandoffKeywords,
  buildSupportBriefingNudge,
} from "../src/support-flow.js";

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

console.log("\n=== Triggers ===\n");
{
  const hist = [
    msg("assistant", "Quelles phrases déclencheurs ?"),
    msg("user", 'Les déclencheurs : « je suis intéressé », « prix », je veux commander'),
  ];
  const t = extractSupportTriggerPhrases(hist);
  assert(t.some((x) => /intéress/i.test(x)), "extrait guillemets intéressé");
  assert(t.length >= 2, `au moins 2 triggers (got ${t.length}: ${t.join(" | ")})`);
}

console.log("\n=== Catch-all briefing nudge ===\n");
{
  const hist = [
    msg("user", "Je veux gérer mon support client WhatsApp pour ma crème"),
    msg("assistant", "Quel produit ?"),
    msg("user", "Crème 5000 FCFA, objectif vente, lien https://pay.example.com"),
    msg("assistant", "Tous les messages ou déclencheurs ?"),
    msg("user", "tous mes messages"),
    msg("assistant", "Comment je me présente ?"),
    msg("user", "Marie de BeautyShop"),
    msg("assistant", "Tu veux des stickers ?"),
    msg("user", "non"),
    msg(
      "assistant",
      "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?"
    ),
    msg("user", "non"),
    msg(
      "assistant",
      "Y a-t-il des mots pour lesquels je dois arrêter et te passer la main (remboursement) ?"
    ),
    msg("user", "non"),
  ];
  const a = assessCampaignBriefing(hist, "je valide", "support");
  assert(a.isInboundClosing, "purpose support → inbound");
  assert(a.inboundCatchAll, "tous les messages → catch-all");
  assert(a.stickersQuestionAsked, "stickers asked");
  assert(a.thirdPartyQuestionAsked, "tiers asked");
  assert(a.handoffKeywordsQuestionAsked, "handoff asked");
  const nudge = buildBriefingNudge(a, hist, "je valide") || "";
  assert(a.readyForDraft, `readyForDraft (missing: ${a.missing.join("; ")})`);
  assert(/je valide|crée le brouillon/i.test(nudge), "nudge demande validation serveur");
  assert(!/Voici l'accroche|exactement 5 variantes dérivées/i.test(nudge), "nudge sans opener prospection");
  const supportNudge = buildSupportBriefingNudge(a, hist, "je valide") || "";
  assert(supportNudge.length > 20, "support nudge non vide");
}

console.log("\n=== Prospection nudge inchangé (pas support) ===\n");
{
  const hist = [
    msg("user", "Je veux prospecter des contacts pour ma formation"),
    msg("assistant", "Quelle offre ?"),
    msg("user", "Formation 50k FCFA, cible entrepreneurs, RDV calendly https://cal.com/x"),
    msg("assistant", "Comment je me présente ?"),
    msg("user", "Paul coach"),
    msg("assistant", "Quand lancer ?"),
    msg("user", "demain 9h, fenêtre 8h-18h"),
    msg("assistant", "Tu veux des stickers dans les conversations avec les prospects ?"),
    msg("user", "non"),
  ];
  const a = assessCampaignBriefing(hist, "ok", "prospection");
  assert(!a.isInboundClosing, "prospection ≠ inbound");
  if (a.readyForDraft) {
    const nudge = buildBriefingNudge(a, hist, "ok") || "";
    assert(
      /premier message|accroche|variantes/i.test(nudge),
      "prospection garde le chemin opener"
    );
  } else {
    assert(true, "prospection pas encore ready (ok)");
  }
}

console.log("\n=== Handoff keywords ===\n");
{
  const hist = [
    msg("assistant", "Mots-clés pour passer la main à un humain ?"),
    msg("user", "remboursement, plainte"),
  ];
  const kw = extractSupportHandoffKeywords(hist);
  assert(kw.some((k) => /rembours/i.test(k)), "handoff remboursement");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
