/**
 * Garde-fous briefing campagne + détection simulation.
 * Complète les consignes de persona.ts (questions progressives, RDV, etc.).
 */
import type { AgentMessage } from "./db.js";

const CAMPAIGN_INTENT_RE =
  /\b(prospect|prospection|prospecter|campagne|closer|closing|support\s*client|g[eè]re[rz]?\s*(mon\s+)?support|automatis(er|ation)\s+(mes\s+)?(r[eé]ponses|ventes)|keyword_sales|group_prospect|contact_prospect)\b/i;

const SIMULATION_ACCEPT_RE =
  /\b(simulation|simule[rz]?|simuler|fais\s+(une\s+)?simu|on\s+simule|montre\s+(moi\s+)?(un\s+)?(aper[cç]u|exemple|fil))\b/i;

const SIMULATION_YES_RE =
  /^(oui|ouais|ok|okay|d'accord|dac|vas[- ]y|go|avec\s+plaisir|carr[eé]ment|volontiers|nickel|parfait)(\s|[!.]|$)/i;

export function isCampaignIntent(text: string): boolean {
  return CAMPAIGN_INTENT_RE.test(text);
}

/** L'utilisateur accepte / demande une simulation. */
export function wantsCampaignSimulation(userMessage: string, history: AgentMessage[]): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (SIMULATION_ACCEPT_RE.test(t)) return true;
  if (/\b(aper[cç]u|exemple\s+de\s+(fil|conversation)|montre[- ]moi)\b/i.test(t)) return true;

  // « oui » juste après que l'agent a proposé une simulation
  if (!SIMULATION_YES_RE.test(t)) return false;
  for (let i = history.length - 1; i >= 0 && i >= history.length - 6; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    if (
      /simulation|simuler|aper[cç]u|fil de (discussion|conversation)|veux-tu une simulation|simulation courte/i.test(
        m.content
      )
    ) {
      return true;
    }
    break;
  }
  return false;
}

export type BriefingAssessment = {
  inCampaignFlow: boolean;
  questionsAsked: number;
  missing: string[];
  readyForDraft: boolean;
  /** L'utilisateur a indiqué l'angle / le ton souhaité pour le 1er message (après question dédiée). */
  openerDirectionCollected: boolean;
  /** Les 5 variantes ont été proposées dans le chat. */
  openerVariantsProposed: boolean;
};

const OPENER_DIRECTION_ASK_RE =
  /\b(premier\s+message|premi[eè]re\s+(approche|accroche|phrase|ouverture)|comment\s+tu\s+veux\s+(aborder|commencer|ouvrir)|quelle\s+approche|quel\s+angle|premier\s+contact|naturel\s+comme\s+premi[eè]re|premi[eè]re\s+fois\s+que\s+tu\s+[ée]cris)\b/i;

const OPENER_VARIANTS_PROPOSED_RE =
  /\b(5\s+(pistes|variantes|accroches)|voici\s+5\s+(pistes|variantes|accroches))\b/i;

function isSubstantiveUserReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (/^(oui|non|ok|ouais|non merci|peu importe|d'accord|vas[- ]y|nickel|parfait)$/i.test(t)) return false;
  return true;
}

function lastAssistantMatchIndex(history: AgentMessage[], re: RegExp): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role === "assistant" && re.test(m.content)) return i;
  }
  return -1;
}

/** L'agent a posé la question sur le 1er message souhaité (obligatoire avant variantes). */
export function hasAgentAskedOpenerDirection(history: AgentMessage[]): boolean {
  return lastAssistantMatchIndex(history, OPENER_DIRECTION_ASK_RE) >= 0;
}

/** L'utilisateur a répondu avec un angle / une idée après cette question. */
export function hasUserProvidedOpenerDirection(
  history: AgentMessage[],
  userMessage: string
): boolean {
  const askIdx = lastAssistantMatchIndex(history, OPENER_DIRECTION_ASK_RE);
  if (askIdx < 0) return false;

  for (let i = askIdx + 1; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "user" && isSubstantiveUserReply(m.content)) return true;
  }

  const usersAfterAsk = history.slice(askIdx + 1).filter((m) => m.role === "user").length;
  if (usersAfterAsk === 0 && isSubstantiveUserReply(userMessage)) return true;

  return false;
}

/** Les 5 variantes ont déjà été listées dans le fil. */
export function hasProposedOpenerVariants(history: AgentMessage[]): boolean {
  return history
    .slice(-24)
    .some((m) => m.role === "assistant" && OPENER_VARIANTS_PROPOSED_RE.test(m.content));
}

function hasStickersQuestionAsked(blob: string): boolean {
  return /\bsticker/i.test(blob);
}

function hasThirdPartyQuestionAsked(blob: string): boolean {
  return /\btiers\b|pr[ée]venir\s+automatiquement|third.party|livreur.*whatsapp/i.test(blob);
}

function conversationBlob(history: AgentMessage[], userMessage: string): string {
  const recent = history.slice(-24);
  return [...recent.map((m) => m.content), userMessage].join("\n");
}

function countBriefingQuestions(history: AgentMessage[]): number {
  let campaignStart = -1;
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "user" && isCampaignIntent(m.content)) {
      campaignStart = i;
      break;
    }
  }
  if (campaignStart < 0) {
    // Intent dans le message courant seulement → 0 question encore
    return 0;
  }
  let n = 0;
  for (let i = campaignStart; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "assistant" && m.content.includes("?")) n++;
  }
  return n;
}

/**
 * Estime ce qui manque encore pour un brief exploitable
 * (tous produits / services / support).
 */
export function assessCampaignBriefing(
  history: AgentMessage[],
  userMessage: string
): BriefingAssessment {
  const inFlow =
    isCampaignIntent(userMessage) ||
    history.slice(-16).some((m) => m.role === "user" && isCampaignIntent(m.content)) ||
    history.slice(-10).some(
      (m) =>
        m.role === "assistant" &&
        /offre|approche|relance|d[eé]clencheur|simulation|campagne|prix|cible/i.test(m.content) &&
        m.content.includes("?")
    );

  if (!inFlow) {
    return {
      inCampaignFlow: false,
      questionsAsked: 0,
      missing: [],
      readyForDraft: false,
      openerDirectionCollected: false,
      openerVariantsProposed: false,
    };
  }

  const blob = conversationBlob(history, userMessage);
  const questionsAsked = countBriefingQuestions(history) + (isCampaignIntent(userMessage) ? 0 : 0);

  const missing: string[] = [];

  const hasOffer =
    /\b(offre|produit|service|formation|coaching|je\s+(vends|propose|offre)|automatisation|saas|agence)\b/i.test(
      blob
    ) && blob.length > 80;
  if (!hasOffer) missing.push("offre / produit ou service précis");

  const hasTarget =
    /\b(cible|prospect|audience|client[e]?s?|groupe|membres|contact|qui\s+(je|on)\s+|s'adresse)\b/i.test(
      blob
    );
  if (!hasTarget) missing.push("cible (qui contacter / qui écrit)");

  const isSupport =
    /\b(support|closing\s+entrant|d[eé]clencheur|mot[- ]?cl[eé]|keyword|quand\s+quelqu)\b/i.test(blob);
  if (isSupport) {
    const hasTrigger =
      /d[eé]clencheur|mot[- ]?cl[eé]|phrase\s+exacte|«[^»]{3,}»|"[^"]{3,}"/i.test(blob);
    if (!hasTrigger) missing.push("phrase(s) déclencheur exacte(s)");
  }

  const wantsRdv =
    /\b(rendez[- ]?vous|rdv|booking|r[eé]serv|calendly|cal\.com|prise\s+de\s+rdv)\b/i.test(blob);
  const wantsPay =
    /\b(paiement|payer|wave|orange\s*money|moov|lien\s+de\s+paiement|checkout)\b/i.test(blob);
  const wantsLink = /\b(envoyer\s+un\s+lien|lien\s+vers|url)\b/i.test(blob) || wantsPay;

  const hasHttpLink = /https?:\/\/\S+/i.test(blob);
  if (wantsRdv && !hasHttpLink) {
    missing.push("lien de réservation RDV (URL réelle Calendly / Google / autre)");
  } else if (wantsLink && !hasHttpLink && !wantsRdv) {
    missing.push("URL concrète à envoyer au prospect");
  }

  const hasPrice = /\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)|\bprix\b.{0,40}\d/i.test(blob);
  const isSale =
    /\b(vendre|vente|acheter|prix|tarif|fcfa|commander|paiement)\b/i.test(blob) && !wantsRdv;
  if (isSale && !hasPrice) missing.push("prix exact (chiffre en FCFA)");

  const hasGoal =
    /\b(objectif|rdv|rendez[- ]?vous|vente|paiement|livraison|inscription|d[eé]mo|closing)\b/i.test(
      blob
    );
  if (!hasGoal) missing.push("objectif final concret (RDV, vente, lien, livraison…)");

  const hasRhythm =
    /\b(relance|d[eé]lai|par\s+jour|anti[- ]?blocage|45|60|90|120\s*s|max_per_day|rythme)\b/i.test(
      blob
    );
  if (!hasRhythm) missing.push("rythme / relances (anti-blocage)");

  const hasSchedule =
    /\b(\d{1,2}\s*h|\d{1,2}:\d{2}|matin|soir|apr[eè]s-midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|aujourd.?hui|maintenant|cr[eé]neau|horaire|fen[eê]tre|lancer\s+(à|a)|d[eé]marr)\b/i.test(
      blob
    );
  if (!hasSchedule) {
    missing.push("horaires d'envoi (fenêtre) et jour/heure de lancement de la campagne");
  }

  // Identité face aux prospects — obligatoire pour « qui êtes-vous ? »
  const hasIdentity =
    /\b(se pr[eé]sent|pr[eé]sentation|comment (je |tu |on )?me pr[eé]sente|comment (je |tu |on )?dois me pr[eé]sent|qui (je |tu )?suis|mon pr[eé]nom|mon nom|appelle[- ]moi|je m.?appelle|pr[eé]sente[- ]toi|pr[eé]sente[- ]moi|face aux prospects|aux prospects.*(pr[eé]nom|nom)|owner_name|business_owner)\b/i.test(
      blob
    );
  if (!hasIdentity) {
    missing.push(
      "présentation face aux prospects (prénom/nom + formule si on demande « qui êtes-vous ? »)"
    );
  }

  // Au moins 6 questions posées + aucun élément critique manquant
  const criticalMissing = missing.filter(
    (m) =>
      m.includes("lien de réservation") ||
      m.includes("URL") ||
      m.includes("prix") ||
      m.includes("déclencheur") ||
      m.includes("offre") ||
      m.includes("objectif") ||
      m.includes("cible") ||
      m.includes("horaires") ||
      m.includes("rythme") ||
      m.includes("présentation")
  );
  const readyForDraft = questionsAsked >= 6 && criticalMissing.length === 0;
  const openerDirectionCollected = hasUserProvidedOpenerDirection(history, userMessage);
  const openerVariantsProposed = hasProposedOpenerVariants(history);

  return {
    inCampaignFlow: true,
    questionsAsked,
    missing,
    readyForDraft,
    openerDirectionCollected,
    openerVariantsProposed,
  };
}

const NEW_CAMPAIGN_IN_THREAD_RE =
  /\b(nouvelle|autre|deuxi[eè]me|2e|second|encore\s+une|une\s+autre|relance\s+une\s+autre)\s+(campagne|automatisation|prospection|s[eé]quence)\b/i;

/** Bloque une 2e campagne dans un fil qui en a déjà une. */
export function buildThreadCampaignBlockNudge(
  automationId: number | null,
  userMessage: string
): string | null {
  if (!automationId) return null;
  if (!isCampaignIntent(userMessage) && !NEW_CAMPAIGN_IN_THREAD_RE.test(userMessage)) return null;
  if (NEW_CAMPAIGN_IN_THREAD_RE.test(userMessage)) {
    return (
      `## BLOCAGE TECHNIQUE — fil occupé\n` +
      `Ce fil gère déjà l'automatisation #${automationId}. INTERDIT d'appeler create_automation sans automation_id.\n` +
      `Explique à l'utilisateur qu'il doit cliquer « Nouvelle automatisation » dans la barre latérale pour créer une autre campagne.\n` +
      `Pour modifier la campagne actuelle → update_automation_config ou create_automation avec automation_id=${automationId}.`
    );
  }
  return null;
}

export function buildBriefingNudge(
  assessment: BriefingAssessment,
  history: AgentMessage[],
  userMessage: string
): string | null {
  if (!assessment.inCampaignFlow) return null;
  if (assessment.readyForDraft) {
    const blob = conversationBlob(history, userMessage);

    if (!hasStickersQuestionAsked(blob)) {
      return (
        "Briefing campagne : éléments essentiels réunis (≥6 questions). " +
        "Pose UNE question — « Tu veux que j'ajoute des stickers dans les conversations avec les prospects ? (oui/non) » — puis ARRÊTE-TOI. " +
        "INTERDIT : résumer + proposer des variantes de 1er message dans le même message."
      );
    }

    if (!hasThirdPartyQuestionAsked(blob)) {
      return (
        "Briefing campagne : pose UNE question optionnelle — « Quand un prospect convertit, tu veux qu'on prévienne automatiquement un tiers (livreur, commercial…) sur WhatsApp ? (oui/non) ». " +
        "Si oui : récupère numéro + rôle + infos (une question à la fois). " +
        "INTERDIT : proposer des variantes de 1er message avant d'avoir posé la question sur le premier message souhaité."
      );
    }

    if (!hasAgentAskedOpenerDirection(history)) {
      return (
        "Briefing campagne : avant toute variante, pose UNE question sur le **premier message** souhaité — " +
        "ex. « Comment tu veux aborder le premier contact ? (ton direct, question ouverte, mystère, formel…) — donne-moi une idée ou une phrase type. » " +
        "Puis ARRÊTE-TOI et attends sa réponse. " +
        "**INTERDIT ABSOLU** : lister 5 variantes, proposer des accroches, ou mélanger récap + variantes dans ce message."
      );
    }

    if (!assessment.openerDirectionCollected) {
      return (
        "Tu as demandé le premier message — **ATTENDS** la réponse de l'utilisateur (angle, ton, exemple). " +
        "INTERDIT : proposer des variantes, create_automation, ou simulation tant qu'il n'a pas donné son idée."
      );
    }

    if (!assessment.openerVariantsProposed) {
      return (
        "L'utilisateur a indiqué son angle pour le 1er message. " +
        "Propose maintenant **exactement 5 variantes** d'accroche A.I.D.A. Attention (liste numérotée 1–5), alignées sur **SA** direction — courtes, SANS prix/lien/pitch, vouvoiement, sans prénom du prospect. " +
        "Attends son choix / validation. Puis create_automation draft (initial_message + ab_variants). " +
        "Ensuite propose la simulation (show_campaign_simulation, 6-7 tours)."
      );
    }

    return (
      "Les 5 variantes ont été proposées — attends le choix ou la validation de l'utilisateur. " +
      "Puis create_automation draft avec personalize_messages=true, initial_message=variante choisie, ab_variants=les 5 textes. " +
      "Propose ensuite la simulation (6-7 messages via show_campaign_simulation)."
    );
  }

  const next = assessment.missing[0] ?? "un détail concret encore flou";
  const q = assessment.questionsAsked;
  if (next.includes("offre")) {
    return (
      `Briefing campagne (${q}/6 question(s)) : offre pas encore confirmée par l'utilisateur. ` +
      `Pose UNE question OUVERTE (« Qu'est-ce que tu proposes concrètement ? »). ` +
      `N'affirme JAMAIS l'offre du profil business — elle peut être obsolète.`
    );
  }
  if (next.includes("présentation")) {
    return (
      `Briefing campagne (${q}/6 question(s)) : identité face aux prospects manquante. ` +
      `Pose UNE seule question : comment tu dois te présenter si un prospect demande « qui êtes-vous ? » ` +
      `(prénom/nom + formule courte). Enregistre via save_business_profile. INTERDIT d'inventer un nom.`
    );
  }
  return (
    `## Briefing campagne EN COURS (obligatoire)\n` +
    `Questions déjà posées ≈ ${q}/6 minimum. Éléments encore manquants : ${
      assessment.missing.length ? assessment.missing.join(" ; ") : "à creuser"
    }.\n` +
    `Prochaine étape : pose **UNE seule** question précise sur « ${next} », puis ARRÊTE-TOI et attends.\n` +
    `INTERDIT : create_automation, activate_automation, show_campaign_simulation, rédiger le message final, ou sauter des questions.\n` +
    `Même si l'utilisateur dit « c'est un test », « plus tard », « comme tu veux », « fais simple » → insiste pour une réponse concrète exploitable. Un test = vrais paramètres.\n` +
    `Si objectif = rendez-vous → tu DOIS obtenir le **lien de réservation** (URL) avant tout brouillon.\n` +
    `N'oublie pas le **planning** : fenêtre horaire d'envoi + jour/heure de lancement (une question à la fois).\n` +
    `N'oublie pas l'**identité** : comment se présenter aux prospects si on demande « qui êtes-vous ? » (prénom/nom réel, save_business_profile) — INTERDIT d'inventer.\n` +
    `Avant activation : demande aussi si l'utilisateur veut des **stickers** dans les conversations (oui/non).\n` +
    `Valable pour TOUS produits / services / support client.`
  );
}

/** Texte qui évoque un RDV sans lien HTTP. */
export function needsAppointmentLink(config: {
  closingGoal?: string | null;
  conversationGuide?: string | null;
  initialMessage?: string | null;
  closingLink?: string | null;
  productName?: string | null;
}): boolean {
  if (config.closingLink?.trim()) return false;
  if (config.closingGoal === "appointment") return true;
  const blob = [config.conversationGuide, config.initialMessage, config.productName]
    .filter(Boolean)
    .join(" ");
  return /\b(rendez[- ]?vous|rdv|booking|r[eé]serv|calendly|cal\.com)\b/i.test(blob);
}
