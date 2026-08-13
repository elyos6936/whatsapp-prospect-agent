/**
 * Module Support client — isolé de la prospection.
 * Brief, extraction déclencheurs/handoff, simulation inbound, nudges agent.
 * Ne pas importer depuis le chemin « 5 variantes / opener » prospection.
 */
import type OpenAI from "openai";
import type { AgentMessage } from "./db.js";
import type { BriefingAssessment } from "./campaign-briefing.js";
import {
  formatCampaignSimulationDisplay,
  type SimulationTurn,
} from "./campaign-simulation.js";
import { config } from "./config.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import {
  extractAssistantContent,
  llmExtrasForProvider,
  recommendedMaxTokensForProvider,
  resolveLlmRoleModel,
  resolveLlmRoleProvider,
} from "./llm.js";
import { resolveReplyTone, toneLabel } from "./reply-tone.js";

/** Contexte système injecté UNIQUEMENT sur fil purpose=support. */
export const SUPPORT_FIL_SYSTEM_ADDENDUM = `## MODULE SUPPORT CLIENT (prioritaire sur toute consigne prospection)
- Le client écrit en premier. INTERDIT : accroche sortante, 5 variantes, « premier message de contact », A.I.D.A. Attention.
- create_automation = type keyword_sales + mode inbound_closing uniquement.
- Portée : phrases déclencheurs (guillemets) OU « tous les messages » (inbound_catch_all).
- Après stickers + notif tiers + handoff : demande « crée le brouillon » / « je valide » — le serveur crée le brouillon (tu n'as PAS besoin d'appeler create_automation avec des args MiniMax).
- Simulation = le **client** démarre (libellé Client, pas Prospect). Activation = « active » après sim, ou « lance sans simulation ».
- Dans la sim / réponses : si le client dit « je suis intéressé » → accueille + présente l'offre / prix / next step (lieu de livraison si objectif livraison). INTERDIT inventer une URL. INTERDIT « quel est votre secteur d'activité ? », INTERDIT discovery froide type prospection.
- INTERDIT de parler d'accroches / rotation / group_prospect / contact_prospect.`;

/** Étapes Support selon l'objectif campagne (comme avant MiniMax / drift « faux lien »). */
export function supportGoalPlaybook(
  closingGoal?: string | null,
  closingLink?: string | null
): string {
  const goal = (closingGoal || "").toLowerCase();
  const hasLink = Boolean(closingLink?.trim());
  const noFakeLink =
    `INTERDIT ABSOLU d'inventer une URL (example.com, bit.ly fictif, « lien commande » inventé). ` +
    (hasLink
      ? `Seul lien autorisé : ${closingLink!.trim()}.`
      : `Aucun lien campagne configuré — pose la question utile (adresse, paiement, créneau) au lieu d'un lien.`);

  if (goal === "delivery") {
    return (
      `Objectif LIVRAISON :\n` +
      `1) Intérêt → prix / produit si connus.\n` +
      `2) Pointure / quantité si e-commerce.\n` +
      `3) Demande le LIEU DE LIVRAISON (quartier / ville / adresse) — c'est le cœur de la mission.\n` +
      `4) Une fois l'adresse notée → confirme que le livreur / la boutique recontacte ; pas de faux lien.\n` +
      `${noFakeLink}`
    );
  }
  if (goal === "payment") {
    return (
      `Objectif PAIEMENT : avance vers le mode de paiement réel configuré. ${noFakeLink}`
    );
  }
  if (goal === "appointment") {
    return (
      `Objectif RDV : propose / confirme un créneau (jour + heure). ${noFakeLink}`
    );
  }
  if (goal === "link") {
    return hasLink
      ? `Objectif LIEN : quand le client est prêt, envoie UNIQUEMENT : ${closingLink!.trim()}. ${noFakeLink}`
      : `Objectif LIEN mais AUCUN closing_link en config — demande comment finaliser (sans inventer d'URL). ${noFakeLink}`;
  }
  return (
    `Après intérêt + détails produit : avance vers l'objectif campagne (livraison = adresse ; paiement ; RDV ; lien réel seulement s'il est en config).\n` +
    `${noFakeLink}`
  );
}

/** Cadre conversationnel Support — prioritaire sur une mémoire écrite pour la prospection. */
export function buildSupportConversationGuide(opts: {
  catchAll: boolean;
  triggers: string[];
  handoffKeywords?: string[];
  productHint?: string | null;
  price?: string | null;
  link?: string | null;
  closingGoal?: string | null;
}): string {
  const triggersLine = opts.catchAll
    ? "Portée : TOUS les messages privés (hors groupes)."
    : `Déclencheurs (répondre seulement si match) : ${opts.triggers.map((t) => `« ${t} »`).join(", ") || "(à préciser)"}.`;
  const handoff =
    opts.handoffKeywords && opts.handoffKeywords.length
      ? `Handoff humain si le client écrit : ${opts.handoffKeywords.join(", ")}.`
      : "Handoff : selon mots-clés configurés (sinon STOP classique).";
  const offerBits = [
    opts.productHint ? `Produit / offre : ${opts.productHint}` : "",
    opts.price ? `Prix : ${opts.price}` : "",
    opts.link ? `Lien (seul autorisé) : ${opts.link}` : "Lien : AUCUN — n'invente pas d'URL.",
    opts.closingGoal ? `Objectif : ${opts.closingGoal}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    `## CADRE SUPPORT CLIENT (PRIORITAIRE — écrase toute consigne de cold outreach)\n` +
    `${triggersLine}\n` +
    `${handoff}\n` +
    (offerBits ? `${offerBits}\n` : "") +
    `\n${supportGoalPlaybook(opts.closingGoal, opts.link)}\n` +
    `\nComportement :\n` +
    `- Tu es l'assistant du compte / de la boutique. Le CLIENT a écrit en premier.\n` +
    `- INTERDIT ABSOLU : « je vous contacte pour… », pitch d'ouverture, 5 accroches, demander le « secteur d'activité », qualification froide B2B.\n` +
    `- Si le client montre de l'intérêt (« je suis intéressé », « je veux plus d'infos ») : remercie brièvement + présente l'offre concrète (prix / dispo / produit) en 1-2 phrases. Une seule question utile max (ex. quantité, taille, lieu de livraison) — pas une enquête.\n` +
    `- Si le client répond « ah », « ok », « okay », « hmm » ou « 1 » après une question : réponds à CETTE réponse puis pose la prochaine question utile (souvent le lieu de livraison) — INTERDIT inventer un lien, INTERDIT clôturer (« Bonne continuation », « C'est noté »).\n` +
    `- Vouvoiement, ton chaleureux et utile. Pas de « ! » parasite en début de message.`
  );
}

/** Indice produit / offre depuis le fil Support (sans inventer). */
export function extractSupportProductHint(history: AgentMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role !== "user") continue;
    const labeled =
      /(?:produit|offre|service|je\s+(?:vends|propose|offre))\s*[:\-–]?\s*([^\n]{4,120})/i.exec(
        m.content
      );
    if (labeled?.[1]) {
      const t = labeled[1].replace(/[«»"]/g, "").trim();
      if (t.length >= 3 && !/^(oui|non|ok)\b/i.test(t)) return t.slice(0, 120);
    }
  }
  return null;
}

function sanitizeSupportSimText(text: string): string {
  return text
    .replace(/^[\s!*#>\-–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phrases déclencheurs : guillemets + listes près de « déclencheur ».
 */
export function extractSupportTriggerPhrases(history: AgentMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const inner = raw.replace(/\s+/g, " ").trim();
    if (inner.length < 2 || inner.length > 100) return;
    if (/\?$/.test(inner) && inner.length > 40) return;
    const key = inner.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(inner);
  };

  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const quotes = m.content.match(/[«"]([^»"]{2,100})[»"]/g) || [];
    for (const q of quotes) push(q.replace(/^[«"]|[»"]$/g, ""));
  }

  // User : « déclencheurs : intéressé, je veux commander »
  for (const m of history) {
    if (m.role !== "user") continue;
    const block =
      /d[eé]clencheur[s]?\s*[:\-–]\s*([^\n]+)/i.exec(m.content) ||
      /phrases?\s*(exactes?|d[eé]clencheur[s]?)?\s*[:\-–]\s*([^\n]+)/i.exec(m.content) ||
      /quand\s+(?:quelqu.?un|un\s+client|il|elle)\s+[eé]crit\s*[:\-–]?\s*([^\n]+)/i.exec(
        m.content
      );
    const list = block?.[1] || block?.[2];
    if (!list) continue;
    for (const part of list.split(/[,;|/]| et /i)) {
      push(part.replace(/^[«"'\s]+|[»"'\s.]+$/g, ""));
    }
  }

  // Puces user après qu'on a parlé de déclencheur
  const blob = history.map((h) => h.content).join("\n");
  if (/d[eé]clencheur|mot[- ]?cl[eé]|phrase\s+exacte/i.test(blob)) {
    for (const m of history) {
      if (m.role !== "user") continue;
      const lines = m.content.split(/\n+/);
      for (const line of lines) {
        const bullet = /^\s*[-*•\d]+[.)]\s*(.+)$/.exec(line.trim());
        if (bullet?.[1]) push(bullet[1].replace(/^[«"]|[»"]$/g, ""));
      }
    }
  }

  return found.slice(0, 12);
}

/** Mots-clés handoff cités par l'utilisateur (après question handoff). */
export function extractSupportHandoffKeywords(history: AgentMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const inner = raw.replace(/\s+/g, " ").trim();
    if (inner.length < 2 || inner.length > 80) return;
    if (/^(non|nan|aucun|pas\s+besoin|rien)$/i.test(inner)) return;
    const key = inner.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(inner);
  };

  let afterHandoffQ = false;
  for (const m of history) {
    if (
      m.role === "assistant" &&
      /\b(passer\s+la\s+main|handoff|mots?\s*cl[eé]|humain)\b/i.test(m.content)
    ) {
      afterHandoffQ = true;
      continue;
    }
    if (!afterHandoffQ || m.role !== "user") continue;
    if (/^(non|nan|aucun|pas\s+besoin|rien)\b/i.test(m.content.trim())) {
      return [];
    }
    const quotes = m.content.match(/[«"]([^»"]{2,80})[»"]/g) || [];
    for (const q of quotes) push(q.replace(/^[«"]|[»"]$/g, ""));
    for (const part of m.content.split(/[,;|/]| et /i)) {
      const cleaned = part.replace(/^[«"'\s]+|[»"'\s.]+$/g, "").trim();
      if (
        cleaned.length >= 3 &&
        cleaned.length <= 40 &&
        !/^(oui|ok|voici|les|mots)/i.test(cleaned)
      ) {
        push(cleaned);
      }
    }
  }
  return found.slice(0, 12);
}

const SUPPORT_THIRD_PARTY_ASK_RE =
  /\b(pr[eé]venir|notifier|pr[eé]vienne|notifie).{0,80}\b(tiers|quelqu.?un d.?autre|livreur|associ[eé]|commercial)\b|\b(tiers|livreur|associ[eé]|commercial).{0,80}\b(pr[eé]venir|notifier|automatiquement)\b|\bthird.party\b/i;

const SUPPORT_HANDOFF_ASK_RE =
  /\b(passer\s+la\s+main|handoff|mots?\s*cl[eé]|humain)\b/i;

export type SupportThirdPartyExtract = {
  asked: boolean;
  declined: boolean;
  accepted: boolean;
  phone: string | null;
  role: string | null;
};

/** Numéro WhatsApp dans un texte user — ignore les montants (FCFA / €). */
export function extractPhoneFromUserText(text: string): string | null {
  const cleaned = String(text ?? "").replace(
    /\b\d[\d\s.,]{0,12}\s*(?:fcfa|f\b|€|euros?)\b/gi,
    " "
  );
  const matches = cleaned.match(/(?:\+|00)?(?:229)?[\s.\-]*(?:01[\s.\-]*)?\d(?:[\s.\-]*\d){6,13}/g) ?? [];
  for (const raw of matches) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    if (/^0+$/.test(digits)) continue;
    return raw.replace(/\s+/g, " ").trim();
  }
  return null;
}

export function looksLikeThirdPartyPhoneReply(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || /\b(fcfa|euros?)\b/i.test(t)) return false;
  return Boolean(extractPhoneFromUserText(t));
}

/**
 * Notif tiers (livreur) après la question Support — pas le brief e-commerce avant.
 * « non » à la question handoff qui suit ne désactive pas le tiers.
 */
export function extractSupportThirdParty(
  history: AgentMessage[],
  userMessage = ""
): SupportThirdPartyExtract {
  const msgs: AgentMessage[] = userMessage.trim()
    ? [
        ...history,
        {
          id: 0,
          role: "user",
          content: userMessage,
          created_at: "",
        },
      ]
    : history;

  let asked = false;
  const afterAsk: string[] = [];
  for (const m of msgs) {
    if (m.role === "assistant" && SUPPORT_THIRD_PARTY_ASK_RE.test(m.content)) {
      asked = true;
      afterAsk.length = 0;
      continue;
    }
    if (asked && m.role === "assistant" && SUPPORT_HANDOFF_ASK_RE.test(m.content)) {
      break;
    }
    if (asked && m.role === "user") afterAsk.push(m.content);
  }

  const first = (afterAsk[0] ?? "").trim();
  const afterBlob = afterAsk.join("\n");
  const phoneAfterAsk = extractPhoneFromUserText(afterBlob);
  const declined =
    asked &&
    /^(non|nan|pas\s+besoin|aucun|nope|niet)\b/i.test(first) &&
    !phoneAfterAsk;

  let phone = phoneAfterAsk;
  const accepted =
    !declined &&
    (/\b(oui|ouais|yes|ok|okay|d['’]accord|vas[- ]y|go)\b/i.test(afterBlob) ||
      Boolean(phoneAfterAsk));

  if (accepted && !phone) {
    for (const m of msgs) {
      if (m.role !== "user") continue;
      phone = extractPhoneFromUserText(m.content);
      if (phone) break;
    }
  }

  let role: string | null = null;
  const roleHit = /\b(livreur|commercial|associ[eé]|assistant|tiers)\b/i.exec(afterBlob);
  if (roleHit?.[1]) role = roleHit[1].toLowerCase();
  if (accepted && !role) role = "livreur";

  return { asked, declined, accepted, phone, role };
}

/**
 * Nudges Support uniquement — jamais d'opener / 5 variantes.
 */
export function buildSupportBriefingNudge(
  assessment: BriefingAssessment,
  _history: AgentMessage[],
  _userMessage: string
): string | null {
  if (!assessment.inCampaignFlow || !assessment.isInboundClosing) return null;

  if (assessment.readyForDraft) {
    if (!assessment.stickersQuestionAsked) {
      return (
        "Briefing SUPPORT : éléments essentiels réunis. " +
        "Pose UNE question — « Tu veux des stickers dans les réponses aux clients ? (oui/non) » — puis ARRÊTE-TOI. " +
        "INTERDIT : accroches, 5 variantes, create_automation dans ce message."
      );
    }
    if (!assessment.thirdPartyQuestionAsked) {
      return (
        "Briefing SUPPORT : pose UNE question — « Quand un client convertit / objectif atteint, tu veux qu'on prévienne automatiquement un tiers (livreur, associé…) sur WhatsApp ? (oui/non) ». " +
        "Si oui : numéro + rôle (une question à la fois). INTERDIT create_automation tant que ce n'est pas couvert."
      );
    }
    if (!assessment.handoffKeywordsQuestionAsked) {
      return (
        "Briefing SUPPORT : pose UNE question — « Y a-t-il des mots/phrases pour lesquels je dois arrêter et te passer la main " +
        "(ex. remboursement, plainte) ? Liste-les ou dis non. » Puis ARRÊTE-TOI."
      );
    }

    if (assessment.inboundCatchAll) {
      return (
        "SUPPORT prêt (compte entier). " +
        "Demande à l'utilisateur de répondre **« je valide »** ou **« crée le brouillon »** — le serveur enregistre keyword_sales + inbound_catch_all=true puis propose la simulation. " +
        "INTERDIT : 5 variantes, accroche sortante, inventer un fil Toi→ sans tool serveur. " +
        "Explique : l'IA répondra à tout message privé (hors groupes), sauf STOP / handoff."
      );
    }
    return (
      "SUPPORT prêt (phrases déclencheurs). " +
      "Demande **« je valide »** / **« crée le brouillon »** — le serveur crée keyword_sales + trigger_phrases + handoff_keywords, " +
      "puis simulation où le **client écrit en premier**. " +
      "INTERDIT : 5 variantes d'opener, contact_prospect, group_prospect."
    );
  }

  const next = assessment.missing[0] ?? "un détail concret encore flou";
  const q = assessment.questionsAsked;
  if (next.includes("déclencheur") || next.includes("tous les messages")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : il manque la **portée**. ` +
      `Pose UNE question : « Tu veux des **phrases déclencheurs** exactes (ex. « je suis intéressé »), ` +
      `ou que je gère **tous les messages privés** du compte ? »`
    );
  }
  if (next.includes("offre")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : pose UNE question ouverte — ` +
      `« Quel produit / service dois-je défendre dans les réponses clients ? »`
    );
  }
  if (next.includes("présentation") || next.includes("identité")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : pose UNE question — ` +
      `comment te présenter si un client demande « qui êtes-vous ? » (prénom + formule courte).`
    );
  }
  if (next.includes("objectif")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : pose UNE question — ` +
      `quel objectif quand le client est prêt (lien, paiement, RDV, livraison…) ?`
    );
  }
  return (
    `## Briefing SUPPORT EN COURS\n` +
    `Il manque encore : **${next}**. Pose UNE seule question courte. ` +
    `INTERDIT : accroche sortante, 5 variantes, simuler avant brouillon, basculer en prospection.`
  );
}

/**
 * Simulation inbound : le client démarre (pas l'agent).
 * Même stack Claude/filet que la sim prospection (client OpenAI passé en arg).
 */
export async function generateSupportSimulationDirect(
  client: OpenAI,
  opts: {
    businessContext: string;
    recentTranscript: string;
    campaignBrief?: string | null;
    triggerPhrases?: string[];
    catchAll?: boolean;
  }
): Promise<{ display: string; turns: SimulationTurn[] } | null> {
  const tone = resolveReplyTone({
    campaignTexts: [opts.campaignBrief, opts.businessContext],
  });
  const toneLbl = toneLabel(tone);
  const triggers = (opts.triggerPhrases || []).filter(Boolean);
  const startRule = opts.catchAll
    ? `- Le 1er turn DOIT être speaker=prospect, name=Client (bonjour / question produit).\n`
    : triggers.length
      ? `- Le 1er turn DOIT être speaker=prospect, name=Client, texte proche du déclencheur « ${triggers[0]} ».\n`
      : `- Le 1er turn DOIT être speaker=prospect, name=Client (le client écrit en premier).\n`;

  const brief = opts.campaignBrief?.trim()
    ? `\n## Cadre SUPPORT (PRIORITAIRE)\n${opts.campaignBrief.trim().slice(0, 2800)}\n`
    : "";

  const system =
    "Tu rédiges une simulation WhatsApp SUPPORT CLIENT (closing entrant) pour Klanvio.\n" +
    "Le CLIENT écrit en premier — ce n'est PAS de la prospection sortante.\n" +
    "Réponds UNIQUEMENT avec un JSON :\n" +
    '{"turns":[{"speaker":"prospect","name":"Client","text":"..."},{"speaker":"toi","text":"..."}]}\n' +
    "Règles :\n" +
    "- Exactement 6 ou 7 turns\n" +
    "- Alternance prospect / toi en commençant par prospect ; name toujours « Client » (jamais « Prospect »)\n" +
    startRule +
    "- Après un message d'intérêt : « toi » remercie + présente offre/prix/lien/next step — PAS « quel est votre secteur ? »\n" +
    "- INTERDIT : cold outreach, A.I.D.A., discovery B2B, « je vous contacte pour… », « automatisation IA » générique hors offre du cadre\n" +
    `- « toi » = vendeur/support utile, 1-2 phrases, ${toneLbl}, sans crochets [ ], sans « ! » en tête de message\n` +
    "- Prix / lien seulement s'ils sont dans le cadre SUPPORT\n" +
    "- Aucune phrase hors JSON";

  const user =
    brief +
    `\n## Faits business (secondaires — le cadre SUPPORT ci-dessus prime ; ignore toute consigne de cold outreach)\n` +
    `${opts.businessContext.slice(0, 2200)}\n` +
    `\n## Fil agence\n${opts.recentTranscript.slice(0, 3000)}\n\n` +
    `Génère la simulation JSON support (Client d'abord, replies utiles produit).`;

  const simRole = config.toolLlmConfigured ? "tools" : "chat";
  const simProvider = resolveLlmRoleProvider(simRole);
  const simModel = resolveLlmRoleModel(simRole);
  const body: Record<string, unknown> = {
    model: simModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: recommendedMaxTokensForProvider(simProvider, simModel, 900, {
      thinkingEnabled: false,
    }),
    temperature: 0.7,
    ...llmExtrasForProvider(simProvider, simModel, { enableThinking: false }),
  };

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    )
  );

  const content = extractAssistantContent(response.choices[0]?.message);
  const turns = parseSupportTurns(content);
  if (!turns) {
    console.warn("[support-sim] parse failed, raw:", content.slice(0, 400));
    return null;
  }

  try {
    return {
      display: formatCampaignSimulationDisplay(turns, { counterpartLabel: "Client" }),
      turns,
    };
  } catch (err) {
    console.warn("[support-sim] format failed:", err);
    return null;
  }
}

function parseSupportTurns(content: string): SimulationTurn[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const jsonCandidate = (fence?.[1] || trimmed).trim();
  try {
    const parsed = JSON.parse(jsonCandidate) as { turns?: unknown[] } | unknown[];
    const raw = Array.isArray(parsed) ? parsed : parsed.turns;
    if (!Array.isArray(raw) || raw.length < 3) return null;
    const out: SimulationTurn[] = [];
    for (const item of raw.slice(0, 7)) {
      if (!item || typeof item !== "object") return null;
      const t = item as { speaker?: string; name?: string; text?: string };
      const speaker = String(t.speaker ?? "").toLowerCase();
      const text = sanitizeSupportSimText(String(t.text ?? ""));
      if (!text) return null;
      if (speaker === "toi" || speaker === "moi" || speaker === "you" || speaker === "agent") {
        out.push({ speaker: "toi", text });
      } else {
        out.push({
          speaker: "prospect",
          name: "Client",
          text,
        });
      }
    }
    if (out[0]?.speaker !== "prospect") return null;
    // Rejette une sim qui part en discovery prospection
    const agentBlob = out
      .filter((t) => t.speaker === "toi")
      .map((t) => t.text)
      .join(" ");
    if (
      /\bsecteur\s+d['']activit|\bje\s+vous\s+contacte\b|\bautomatisation\s+IA\s*\?/i.test(
        agentBlob
      )
    ) {
      console.warn("[support-sim] rejected prospection-like agent turns");
      return null;
    }
    return out.length >= 3 ? out : null;
  } catch {
    return null;
  }
}
