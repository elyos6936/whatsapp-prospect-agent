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
  extractSupportThirdParty,
  extractPhoneFromUserText,
  looksLikeThirdPartyPhoneReply,
  buildSupportBriefingNudge,
  buildSupportConversationGuide,
} from "../src/support-flow.js";
import { allowGroupQuickPaths } from "../src/group-list-intent.js";
import { ensureLeadingCapital } from "../src/outbound-sanitize.js";

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

console.log("\n=== Notif tiers / livreur ===\n");
{
  assert(extractPhoneFromUserText("le prix c'est 15 000 FCFA") == null, "prix ≠ numéro");
  assert(extractPhoneFromUserText("préviens +229 97 00 00 00")?.includes("229") === true, "extrait +229");
  assert(looksLikeThirdPartyPhoneReply("+22997000000"), "reply = numéro");
  assert(!looksLikeThirdPartyPhoneReply("je valide"), "je valide ≠ numéro");

  const yesPhone = extractSupportThirdParty(
    [
      msg("assistant", "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?"),
      msg("user", "oui, mon livreur c'est +229 97 11 22 33"),
      msg("assistant", "Y a-t-il des mots pour lesquels je dois arrêter et te passer la main ?"),
      msg("user", "non"),
    ],
    "je valide"
  );
  assert(yesPhone.accepted, "oui → accepté");
  assert(/229/.test(yesPhone.phone || ""), "numéro conservé malgré je valide / handoff non");
  assert(yesPhone.role === "livreur", "rôle livreur");

  const declined = extractSupportThirdParty(
    [
      msg("assistant", "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?"),
      msg("user", "non"),
    ],
    "je valide"
  );
  assert(declined.declined, "non → refusé");
  assert(!declined.accepted, "non ≠ accepté");

  const yesNoPhone = extractSupportThirdParty(
    [
      msg("assistant", "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?"),
      msg("user", "oui"),
    ],
    "je valide"
  );
  assert(yesNoPhone.accepted && !yesNoPhone.phone, "oui sans numéro → accepté, phone vide");

  const laterPhone = extractSupportThirdParty(
    [
      msg("assistant", "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?"),
      msg("user", "oui"),
      msg("assistant", "Mots-clés pour passer la main à un humain ?"),
      msg("user", "non"),
    ],
    "+22996158855"
  );
  assert(laterPhone.accepted && /22996158855/.test(laterPhone.phone || ""), "numéro collé après oui");

  const briefPhone = extractSupportThirdParty(
    [
      msg("user", "préviens mon livreur au +22955556666 à chaque commande"),
      msg("assistant", "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur) ?"),
      msg("user", "oui"),
    ],
    "je valide"
  );
  assert(/22955556666/.test(briefPhone.phone || ""), "numéro déjà dans le brief + oui");
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

console.log("\n=== Guide Support isolé de la prospection ===\n");
{
  const guide = buildSupportConversationGuide({
    catchAll: false,
    triggers: ["je suis intéressé", "je veux plus d'infos"],
    price: "15000 FCFA",
    productHint: "crème",
  });
  assert(/CADRE SUPPORT CLIENT/i.test(guide), "cadre support présent");
  assert(/INTERDIT ABSOLU/i.test(guide) && /secteur/i.test(guide), "interdit secteur / cold");
  assert(/je suis intéressé/i.test(guide), "déclencheurs dans le guide");
  assert(/15000/i.test(guide), "prix dans le guide");
  assert(!/5 variantes|A\.I\.D\.A|accroche sortante/i.test(guide.replace(/INTERDIT[^\n]*/g, "")), "pas d'opener prospection à faire");
  assert(/type de tâche|secteur/i.test(guide), "interdit type de tâche ou secteur");
}

console.log("\n=== Support isolé des chemins groupes ===\n");
{
  const hist = [
    msg("user", "donne moi 3 contacts du groupe GIT3"),
    msg("assistant", "Voici les contacts…"),
    msg("assistant", "Je lance le support à quel moment ? (maintenant, demain matin…)"),
  ];
  assert(
    !allowGroupQuickPaths({ purpose: "support", userMessage: "maintenant", history: hist }),
    "maintenant ≠ groupe introuvable"
  );
  assert(
    !allowGroupQuickPaths({ purpose: "support", userMessage: "+22996158855", history: hist }),
    "numéro livreur ≠ invite / add membre"
  );
  assert(
    !allowGroupQuickPaths({ purpose: "support", userMessage: "lance la campagne", history: hist }),
    "lance la campagne support ≠ admin groupe"
  );
}

console.log("\n=== Majuscule en tête ===\n");
{
  assert(ensureLeadingCapital("merci pour votre message.") === "Merci pour votre message.", "capitalise merci");
  assert(ensureLeadingCapital("! Merci") === "Merci", "retire ! parasite");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
