/**
 * Batterie — cadrage 1er message + mission conversation + non-régression.
 *
 * Couvre :
 *  A) opener-frame (A.I.D.A. Attention)
 *  B) driftsFromTemplate / anti-aléatoire personalizer
 *  C) fallback personalizer (sans LLM) — pas de prénom / tutoiement
 *  D) ab pick + 5 variantes (contrat)
 *  E) lead-scoring delivery / verbal close (non-régression)
 *  F) simulation-gate (non-régression + « variante »)
 *  G) contrats prompts (persona / briefing / reply)
 *  H) live LLM personalizer multi-prospects (si clé API)
 *
 * Usage : npx tsx scripts/test-opener-mission-frame.ts
 * Option  : SKIP_LLM=1 pour sauter la partie H
 */
import "dotenv/config";
import type { AgentMessage } from "../src/db.js";
import {
  attentionOpenerIssues,
  isValidAttentionOpener,
  ATTENTION_OPENER_MAX_CHARS,
} from "../src/opener-frame.js";
import {
  driftsFromTemplate,
  generatePersonalizedOpener,
} from "../src/prospect-personalizer.js";
import { pickAbVariant } from "../src/ab-testing.js";
import {
  isCampaignObjectiveReached,
  wasVerballyClosed,
} from "../src/lead-scoring.js";
import {
  resolveSimulationTurnMode,
  userWantsSilentCampaignTweak,
  shouldBlockDuplicateSimulation,
} from "../src/simulation-gate.js";
import { SYSTEM_PROMPT } from "../src/persona.js";
import { buildBriefingNudge, type BriefingAssessment, hasStickersQuestionAsked, hasThirdPartyQuestionAsked } from "../src/campaign-briefing.js";
import { WHATSAPP_REPLY_PROMPT } from "../src/whatsapp-reply.js";
import { config } from "../src/config.js";
import type { Automation } from "../src/db.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fail(name: string, detail: string): void {
  failed++;
  failures.push(`${name}: ${detail}`);
  console.log(`  ✗ ${name} — ${detail}`);
}

function assert(name: string, cond: boolean, detail = ""): void {
  if (cond) ok(name);
  else fail(name, detail || "assertion false");
}

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

const GOOD_OPENER =
  "Bonjour, je me permets de vous écrire rapidement — j'aide des commerçants à gagner du temps sur WhatsApp. Ça vous parle un peu ?";

const BAD_REAL_OPENERS = [
  "Salut Patient, oui ça va merci. Dis-moi, je t'écris parce que j'organise une petite formation gratuite sur l'automatisation WhatsApp ce mercredi 29 à 18h, il reste seulement 5 places et j'ai pensé que ça pourrait t'intéresser",
  "Ah cool, profite bien de ta pause alors. Je t'écris parce que j'organise une petite formation gratuite sur l'automatisation WhatsApp ce mercredi 29 à 18h, il reste seulement 5 places",
  "Ah super, ravi de te croiser ici! Je t'écris parce que j'organise une petite formation gratuite — https://form.typeform.com/to/iTQ3HA0B",
  "Super ! Voici le lien : https://form.typeform.com/to/iTQ3HA0B — 15000 FCFA",
];

// ═══════════════════════════════════════════════════════════
console.log("\n=== A) opener-frame ===");
{
  assert("accepte accroche Attention valide", isValidAttentionOpener(GOOD_OPENER));
  assert(
    "accepte variante courte",
    isValidAttentionOpener(
      "Bonjour, petite question : vous gérez encore vos échanges clients à la main sur WhatsApp ?"
    )
  );

  for (const bad of [
    { t: "", why: "vide" },
    { t: "Voici le lien https://example.com/x", why: "URL" },
    { t: "Le pack est à 15000 FCFA si ça vous dit", why: "prix" },
    {
      t:
        "Bonjour, j'organise une formation gratuite sur WhatsApp ce mercredi, il reste 5 places limitées, inscription ouverte, webinaire gratuit, venez vite réserver votre place avant qu'il ne soit trop tard vraiment",
      why: "pitch long",
    },
    {
      t: "x".repeat(ATTENTION_OPENER_MAX_CHARS + 5),
      why: "trop long",
    },
  ]) {
    assert(
      `rejette ${bad.why}`,
      !isValidAttentionOpener(bad.t),
      `issues=${attentionOpenerIssues(bad.t).join(",")}`
    );
  }

  // Les openers réels pathologiques doivent être refusés
  for (const [i, o] of BAD_REAL_OPENERS.entries()) {
    assert(
      `rejette opener réel #${i + 1}`,
      !isValidAttentionOpener(o),
      `len=${o.length} issues=${attentionOpenerIssues(o).join(",")}`
    );
  }
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== B) driftsFromTemplate (anti-aléatoire) ===");
{
  assert(
    "légère reformulation OK",
    !driftsFromTemplate(
      "Bonjour, je me permets de vous écrire — j'aide des commerçants à gagner du temps sur WhatsApp. Ça vous parle ?",
      GOOD_OPENER
    )
  );
  assert(
    "détecte « profite de ta pause »",
    driftsFromTemplate(
      "Ah cool, profite bien de ta pause alors. Je vous écris pour WhatsApp.",
      GOOD_OPENER
    )
  );
  assert(
    "détecte « je traînais dans le coin »",
    driftsFromTemplate(
      "Salut, je traînais dans le coin Elyos et je me suis demandé si vous aussi…",
      GOOD_OPENER
    )
  );
  assert(
    "détecte « ravi de te croiser »",
    driftsFromTemplate("Ah super, ravi de te croiser ici! " + GOOD_OPENER, GOOD_OPENER)
  );
  assert(
    "détecte « Hey Prénom » / Salut Prénom",
    driftsFromTemplate("Salut Patient, " + GOOD_OPENER, GOOD_OPENER)
  );
  assert(
    "détecte « Ah super » collé devant",
    driftsFromTemplate("Ah super!\n\n" + GOOD_OPENER, GOOD_OPENER)
  );
  assert(
    "détecte texte beaucoup trop long vs template",
    driftsFromTemplate(GOOD_OPENER + " " + "bla ".repeat(80), GOOD_OPENER)
  );
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== C) fallback personalizer (sans LLM) ===");
{
  // Fallback / LLM selon clé : on vérifie toujours les invariants cadre.
  const names = ["Patient", "Samuel", "Awa", "Marie-Claire", "Koffi"];
  const results: string[] = [];
  for (const name of names) {
    const out = await generatePersonalizedOpener(1, {
      template: GOOD_OPENER,
      memberName: name,
      groupName: "Groupe Test",
      conversationGuide: "Vouvoyer. Accroche courte Attention.",
      recentOpeners: results.slice(-3),
    });
    results.push(out);

    assert(
      `prospect « ${name} » : pas de prénom prospect`,
      !new RegExp(`\\b${name}\\b`, "i").test(out),
      out.slice(0, 120)
    );
    assert(
      `prospect « ${name} » : pas de tutoiement grossier`,
      !/\b(tu as|tu es|ton |ta |te |t'|je t')\b/i.test(out),
      out.slice(0, 120)
    );
    assert(
      `prospect « ${name} » : Attention-valide ou = template`,
      isValidAttentionOpener(out) ||
        out.trim() === GOOD_OPENER.trim() ||
        out.length <= ATTENTION_OPENER_MAX_CHARS + 20,
      `issues=${attentionOpenerIssues(out).join(",")} | ${out.slice(0, 100)}`
    );
    assert(
      `prospect « ${name} » : pas de drift hors cadre`,
      !driftsFromTemplate(out, GOOD_OPENER),
      out.slice(0, 120)
    );
  }

  assert(
    "au moins 1 résultat non vide",
    results.every((r) => r.trim().length > 10)
  );
  const unique = new Set(results.map((r) => r.trim().toLowerCase()));
  console.log(`    (variantes uniques: ${unique.size}/${results.length})`);
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== D) ab_variants / pickAbVariant ===");
{
  const five = [1, 2, 3, 4, 5].map((i) => ({
    id: `v${i}`,
    message: `Bonjour, variante ${i} — vous avez un instant pour parler WhatsApp ?`,
  }));
  assert("5 variantes toutes Attention-valides", five.every((v) => isValidAttentionOpener(v.message)));

  const auto = {
    config: {
      initialMessage: five[0].message,
      abVariants: five,
    },
    stats: { abResults: {} },
  } as unknown as Automation;

  const pick = pickAbVariant(auto);
  assert("pickAbVariant choisit une des 5", five.some((v) => v.id === pick.variantId));
  assert("pickAbVariant message non vide", Boolean(pick.message?.trim()));

  const noAb = {
    config: { initialMessage: GOOD_OPENER, abVariants: [] },
    stats: {},
  } as unknown as Automation;
  const pickDefault = pickAbVariant(noAb);
  assert("sans ab → initial_message", pickDefault.message === GOOD_OPENER);
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== E) lead-scoring delivery (non-régression) ===");
{
  const histHandoff = [
    {
      direction: "sortant",
      body: "Parfait, je transmets votre adresse au livreur, il vous appelle dès qu'il arrive.",
    },
    { direction: "entrant", body: "Ok" },
  ];
  assert(
    "ack après handoff livreur → objectif atteint",
    isCampaignObjectiveReached("Ok", histHandoff, { closingGoal: "delivery" })
  );
  assert("verbal close détecté", wasVerballyClosed(histHandoff));

  const histMereQuestion = [
    {
      direction: "sortant",
      body: "Vous êtes dispo pour la livraison ? Quelle adresse exacte ?",
    },
  ];
  assert(
    "sans ACTION_OFFERED → pas d'objectif",
    !isCampaignObjectiveReached("Ok", histMereQuestion, { closingGoal: "delivery" })
  );

  const histLink = [
    {
      direction: "sortant",
      body: "Voici le lien pour vous inscrire : https://form.typeform.com/to/abc",
    },
  ];
  assert(
    "ack après lien → objectif atteint",
    isCampaignObjectiveReached("Parfait merci", histLink, { closingGoal: "link" })
  );
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== F) simulation-gate (non-régression) ===");
{
  const SIM = `Toi → « ${GOOD_OPENER} »
Prospect → « Oui dites-moi »
Toi → « On livre à Cotonou »
Prospect → « Ok »
Toi → « Super »
Prospect → « Go »

Qu'est-ce que tu veux ajuster ?`;

  assert(
    "après simu, change le ton → silent_tweak",
    resolveSimulationTurnMode([msg("assistant", SIM)], "Adoucis le ton") === "silent_tweak"
  );
  assert(
    "après simu, change variante → silent_tweak",
    resolveSimulationTurnMode([msg("assistant", SIM)], "Change la variante 2") ===
      "silent_tweak"
  );
  assert(
    "userWantsSilentCampaignTweak('variante')",
    userWantsSilentCampaignTweak("Modifie la variante 3 un peu")
  );
  assert(
    "block duplicate sim après tweak",
    shouldBlockDuplicateSimulation([msg("assistant", SIM)], "Adoucis le ton")
  );
  assert(
    "refais la simulation → force_sim",
    resolveSimulationTurnMode([msg("assistant", SIM)], "Refais la simulation") ===
      "force_sim"
  );
  assert(
    "première demande sim → force_sim",
    resolveSimulationTurnMode(
      [msg("assistant", "Veux-tu tester la simulation à droite ?")],
      "Oui"
    ) === "force_sim"
  );
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== G) contrats prompts ===");
{
  assert("persona: section 5 variantes", /5 variantes/i.test(SYSTEM_PROMPT));
  assert("persona: ab_variants", /ab_variants/i.test(SYSTEM_PROMPT));
  assert("persona: interdit Ah super vide", /Ah super/i.test(SYSTEM_PROMPT));
  assert("persona: vouvoyer", /vouvoy/i.test(SYSTEM_PROMPT));
  assert(
    "persona: pas d'exemple tutoiement Awa",
    !/Bonjour Awa.*Tu as/i.test(SYSTEM_PROMPT)
  );
  assert(
    "persona: Attention seulement",
    /A\s*=\s*Attention|Attention seulement/i.test(SYSTEM_PROMPT)
  );
  assert(
    "persona: demande 1er message avant variantes",
    /demander le 1er message|Étape A/i.test(SYSTEM_PROMPT)
  );

  const readyBase: BriefingAssessment = {
    inCampaignFlow: true,
    readyForDraft: true,
    questionsAsked: 6,
    missing: [],
    isInboundClosing: false,
    openerDirectionCollected: false,
    openerVariantsProposed: false,
    stickersQuestionAsked: false,
    thirdPartyQuestionAsked: false,
  };

  const nudgeStickers =
    buildBriefingNudge(readyBase, [], "oui c'est bon") || "";
  assert("briefing ready → stickers d'abord", /sticker/i.test(nudgeStickers));
  assert(
    "briefing ready → pas variantes avant 1er message",
    !/exactement 5 variantes/i.test(nudgeStickers)
  );

  // Régression e-commerce : parler de livreur/WhatsApp dans le brief NE DOIT PAS
  // compter comme « question tiers posée ».
  const histEcommerceFalsePositive: AgentMessage[] = [
    msg(
      "user",
      "Je vends des chaussures, objectif livraison. Mon livreur appelle le client sur WhatsApp."
    ),
    msg(
      "assistant",
      "Tu veux que j'ajoute des stickers dans les conversations avec les prospects ? (oui/non)"
    ),
    msg("user", "non"),
  ];
  const readyAfterStickers: BriefingAssessment = {
    ...readyBase,
    stickersQuestionAsked: true,
    thirdPartyQuestionAsked: false,
  };
  const nudgeTiers =
    buildBriefingNudge(readyAfterStickers, histEcommerceFalsePositive, "non") || "";
  assert("e-com livreur+WhatsApp → encore question tiers", /tiers|livreur|associ/i.test(nudgeTiers));
  assert(
    "e-com : pas de faux positif tiers",
    !hasThirdPartyQuestionAsked(histEcommerceFalsePositive)
  );
  assert(
    "e-com : stickers bien détectés (assistant)",
    hasStickersQuestionAsked(histEcommerceFalsePositive)
  );

  const histStickersTiers: AgentMessage[] = [
    msg("assistant", "Tu veux des stickers dans les conversations ? (oui/non)"),
    msg("user", "non"),
    msg(
      "assistant",
      "Quand un prospect convertit, tu veux prévenir automatiquement un tiers sur WhatsApp ? (oui/non)"
    ),
    msg("user", "non merci"),
  ];
  const readyStickersTiers: BriefingAssessment = {
    ...readyBase,
    stickersQuestionAsked: true,
    thirdPartyQuestionAsked: true,
  };
  const nudgeAskOpener =
    buildBriefingNudge(readyStickersTiers, histStickersTiers, "non") || "";
  assert("briefing ready → question 1er message", /premier message/i.test(nudgeAskOpener));
  assert(
    "briefing ready → interdit variantes sans angle",
    /INTERDIT/i.test(nudgeAskOpener)
  );

  const histWithDirection: AgentMessage[] = [
    ...histStickersTiers,
    msg(
      "assistant",
      "Comment tu veux aborder le premier contact ? Ton direct, question ouverte…"
    ),
    msg("user", "Je veux quelque chose de direct qui parle de formation WhatsApp sans vendre tout de suite."),
  ];
  const readyWithDirection: BriefingAssessment = {
    ...readyStickersTiers,
    openerDirectionCollected: true,
  };
  const nudgeVariants =
    buildBriefingNudge(readyWithDirection, histWithDirection, "direct") || "";
  assert("briefing avec angle → 5 variantes", /5 variantes/i.test(nudgeVariants));
  assert("briefing avec angle → ab_variants", /ab_variants/i.test(nudgeVariants));

  // Closing entrant : après stickers+tiers → brouillon, PAS de 5 variantes opener
  const readyInbound: BriefingAssessment = {
    ...readyStickersTiers,
    isInboundClosing: true,
    openerDirectionCollected: true,
    openerVariantsProposed: true,
  };
  const nudgeInbound =
    buildBriefingNudge(readyInbound, histStickersTiers, "non") || "";
  assert("inbound → pas d'opener variantes", /closing entrant|keyword_sales|pas de 5 variantes/i.test(nudgeInbound));
  assert("inbound → create draft", /create_automation|brouillon/i.test(nudgeInbound));
  assert(
    "reply prompt: réactions vides interdites",
    /Ah super/i.test(WHATSAPP_REPLY_PROMPT)
  );
  assert(
    "reply prompt: vouvoiement",
    /VOUVOIEMENT|vous \/ votre/i.test(WHATSAPP_REPLY_PROMPT)
  );
  assert(
    "reply prompt: pas prénom prospect à tout va",
    /pr[eé]nom du prospect/i.test(WHATSAPP_REPLY_PROMPT)
  );
  assert(
    "reply prompt: Interest Desire Action",
    /Interest|Desire|Action/i.test(WHATSAPP_REPLY_PROMPT)
  );
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== H) live LLM personalizer (multi-individus) ===");
{
  const skip = process.env.SKIP_LLM === "1" || !config.envOpenAiKey;
  if (skip) {
    console.log("  (skipped — pas de clé LLM ou SKIP_LLM=1)");
    console.log("  → filet fallback + section I couvrent le cas « LLM KO / hors cadre »");
  } else {
    const personas = [
      { name: "Patient", note: "commerçant textile" },
      { name: "Samuel", note: "étudiant" },
      { name: "Awa", note: "coiffeuse" },
      { name: "Koffi", note: "livreur" },
      { name: "Fatou", note: "resto" },
      { name: "Jean-Baptiste", note: "immobilier" },
    ];
    const template =
      "Bonjour, je me permets de vous écrire rapidement — j'aide des commerçants à gagner du temps sur WhatsApp. Ça vous parle un peu ?";
    const outs: string[] = [];
    let liveFails = 0;

    for (const p of personas) {
      const out = await generatePersonalizedOpener(1, {
        template,
        memberName: p.name,
        groupName: `Prospects ${p.note}`,
        conversationGuide:
          "Vouvoyer. Attention seulement. Ne pas utiliser le prénom du prospect. Micro-variation uniquement.",
        recentOpeners: outs,
      });
      outs.push(out);
      const checks: Array<[string, boolean]> = [
        ["non vide", out.trim().length > 15],
        ["pas prénom", !new RegExp(`\\b${p.name.split("-")[0]}\\b`, "i").test(out)],
        ["pas tutoiement", !/\b(tu as|tu es| t'|ton |ta |te )\b/i.test(out)],
        ["pas URL", !/https?:\/\//i.test(out)],
        ["pas prix", !/\bfcfa\b/i.test(out)],
        ["pas drift", !driftsFromTemplate(out, template)],
        ["longueur OK", out.length <= Math.max(220, Math.floor(template.length * 1.4) + 40)],
        [
          "pas chitchat",
          !/\b(profite|pause|tra[iî]nais|dans le coin|ravi de te|hey\b)\b/i.test(out),
        ],
      ];
      const bad = checks.filter(([, c]) => !c).map(([n]) => n);
      if (bad.length) {
        liveFails++;
        fail(`LLM « ${p.name} »`, `${bad.join(", ")} | « ${out.slice(0, 140)} »`);
      } else {
        ok(`LLM « ${p.name} » cadré (${out.length} car.)`);
      }
    }

    const uniq = new Set(outs.map((o) => o.trim().toLowerCase()));
    // Avec recentOpeners, on attend un peu de variété mais pas obligatoire si fallback template
    console.log(`    uniques=${uniq.size}/${outs.length} liveFails=${liveFails}`);
    assert(
      "au moins la moitié des openers LLM valides",
      liveFails <= Math.floor(personas.length / 2),
      `${liveFails} échecs / ${personas.length}`
    );
  }
}

// ═══════════════════════════════════════════════════════════
console.log("\n=== I) filet anti-aléatoire (sorties LLM simulées) ===");
{
  // Ce que l'ancien personalizer produisait réellement — doit être bloqué
  const wild = [
    "Ah cool, profite bien de ta pause alors. Je t'écris parce que j'organise une formation gratuite…",
    "Salut Patient, ravi de te croiser ici! Dis-moi tu as 2 minutes ?",
    "Hey Samuel! Je traînais dans le coin Elyos et je me suis demandé…",
    "Ah super!\n\n" + GOOD_OPENER,
    GOOD_OPENER + " " + "détail ".repeat(60),
  ];
  for (const [i, w] of wild.entries()) {
    assert(
      `sortie sauvage #${i + 1} rejetée par driftsFromTemplate`,
      driftsFromTemplate(w, GOOD_OPENER),
      w.slice(0, 80)
    );
  }
  // Si le LLM dérive → le code doit retomber sur le template validé
  // (comportement documenté dans prospect-personalizer.ts)
  assert(
    "template validé lui-même ne drift pas",
    !driftsFromTemplate(GOOD_OPENER, GOOD_OPENER)
  );
}

// ═══════════════════════════════════════════════════════════
console.log("\n────────────────────────────────────────");
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
process.exit(0);
