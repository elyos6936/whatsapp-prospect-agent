import {
  getContact,
  updateContactLeadScore,
  updateContactAutomationLeadScore,
  updateAutomationStats,
  getAutomation,
  getContactAutomationState,
  type AutomationConfig,
} from "./db.js";

const HOT_KEYWORDS =
  /int[eé]ress|curieux|commander|commande|acheter|inscription|je veux|oui|d'accord|appel|rdv|rendez-vous/i;
const PRICE_KEYWORDS = /prix|tarif|combien|fcfa|franc|co[uû]t|budget/i;
const NEGATIVE_KEYWORDS =
  /pas int[eé]ress|non merci|laisse|occup[eé]|arnaque|scam|plainte|r[eé]clamation|avocat|police/i;
const HANDOFF_KEYWORDS =
  /parler (à|a) (un |une )?humain|responsable|g[eé]rant|directeur|plaint|plaindre|remboursement|r[eé]clamation urgente/i;

/** Accusé de réception court après livraison d'un lien / handoff livraison (pas après un simple prix). */
const SHORT_ACK =
  /^(ok|okay|oui|ouais|d['']accord|dac|parfait|super|merci|top|nickel|impeccable|c['']est (bon|not[eé])|re[cç]u|bien re[cç]u|je (vais )?regarder|je regarde|partant|volontiers|vas[- ]y|go|envoie[rz]?)([\s!.?,;:]|$)/i;

/** Affirmation courte (pas « non », pas « merci » seul de politesse). */
const SHORT_YES =
  /^(ok|okay|oui|ouais|d['']accord|dac|parfait|super|top|nickel|partant|volontiers|vas[- ]y|go|envoie[rz]?)([\s!.?,;:]|$)/i;

/** URL réellement livrée dans un message sortant. */
const URL_DELIVERED =
  /https?:\/\/\S+|wa\.me\/\S*|chat\.whatsapp\.com\/\S+|bit\.ly\/\S+|calendly\.\S+/i;

/**
 * Handoff livraison déjà fait (pas une simple proposition « le livreur peut… ? »).
 */
const DELIVERY_HANDOFF_DONE =
  /je (lui |vous |te )?(ai )?(transmets|transmis|envoy[eé]).{0,50}livreur|le livreur (vous |t['']|te )?(appelle|contactera)|adresse (not[eé]e|re[cç]ue)|c['']est (not[eé]|confirm[eé]).{0,40}(livraison|livreur)/i;

/**
 * L'agent a PROPOSÉ d'envoyer un lien / d'agir, sans l'avoir encore livré
 * (ex. « Je vous l'envoie tout de suite ? »).
 */
const PENDING_SEND_OFFER =
  /(?:je (?:peux |vais )?(?:vous |te )?(?:l['']?)?(?:envoyer|envoie)|(?:vous |te )(?:l['']?)envoie|envoyer (?:le )?lien|lien (?:du )?groupe|je (?:vous |te )(?:envoie|transmets) (?:le )?lien)/i;

/**
 * Action de conversion RÉELLEMENT livrée — pas une offre (« je vous envoie ? »),
 * et PAS un simple devis/prix (Support : « ok » après le prix = on avance, on ne clôture pas).
 * Un « oui » après une offre ne doit PAS clôturer la mission.
 */
export function outboundDeliveredAction(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (URL_DELIVERED.test(t)) return true;
  if (DELIVERY_HANDOFF_DONE.test(t) && !/\?\s*$/.test(t)) return true;
  // « Voici le lien » sans URL seulement si ce n'est pas une question d'offre
  if (
    /voici (mon |le )?lien|lien (ici|ci[- ]dessous|suivant)/i.test(t) &&
    !/\?/.test(t) &&
    !PENDING_SEND_OFFER.test(t)
  ) {
    return true;
  }
  return false;
}

/** True si le dernier sortant proposait d'envoyer le lien / l'action sans l'avoir livré. */
export function hasPendingSendOffer(
  history: { direction: string; body: string }[]
): boolean {
  const recentOut = history
    .filter((m) => m.direction === "sortant")
    .slice(-4)
    .map((m) => m.body);
  if (!recentOut.length) return false;
  // Le plus récent compte le plus : offre sans URL livrée
  for (let i = recentOut.length - 1; i >= 0; i--) {
    const body = recentOut[i];
    if (outboundDeliveredAction(body)) return false;
    if (PENDING_SEND_OFFER.test(body)) return true;
  }
  return false;
}

/**
 * Prospect dit « oui / ok / d'accord » alors que l'agent venait de proposer
 * d'envoyer le lien (sans l'avoir encore envoyé) → il faut LIVRER, pas clôturer.
 */
export function isAffirmingPendingSendOffer(
  text: string,
  history: { direction: string; body: string }[]
): boolean {
  const t = text.trim();
  if (!t || t.startsWith("[") || /^non\b/i.test(t)) return false;
  if (!SHORT_YES.test(t) && !SHORT_YES.test(normalizeText(t))) return false;
  // Après un adieu / clôture refus → « ok » n'est PAS un consentement à envoyer le lien.
  const recentOut = history.filter((m) => m.direction === "sortant").slice(-6);
  if (
    recentOut.some((m) =>
      /je (ne )?(vous |te )?(d[eé]range|contacte|ecri) plus|bonne (journ[eé]e|continuation)|n['’]?h[eé]sitez pas.{0,40}recontact|passez une excellente/i.test(
        m.body
      )
    )
  ) {
    return false;
  }
  return hasPendingSendOffer(history);
}

/**
 * Si le prospect a affirmé une offre d'envoi et que la réponse n'a pas l'URL,
 * on l'ajoute (filet dur — le LLM oublie parfois).
 */
export function ensurePendingLinkInReply(
  reply: string,
  closingLink: string | null | undefined,
  text: string,
  history: { direction: string; body: string }[]
): string {
  const link = closingLink?.trim();
  if (!link) return reply;
  if (!isAffirmingPendingSendOffer(text, history)) return reply;
  if (URL_DELIVERED.test(reply) || reply.includes(link)) return reply;
  const base = reply.trim();
  if (!base) return link;
  return `${base}\n${link}`;
}

/**
 * L'agent a déjà annoncé la clôture verbale (transmission faite / livreur qui appelle).
 * Dans ce cas, un ack prospect → stop sans renvoyer une 2e confirmation.
 * Ne match PAS une simple offre (« le livreur peut passer… ? »).
 */
export const VERBAL_CLOSE_DONE =
  /je (lui |vous |te )?(ai )?(transmets|transmis|envoy[eé])|le livreur (vous |t['’]|te )?(appelle|contactera)|il (vous |te )contactera|dans quelques minutes|bonne continuation|bonne journ[eé]e|c['’]est not[eé] de mon c[oô]t[eé]|je (ne )?(vous |te )?(d[eé]range|contacte|ecri) plus|n['’]?h[eé]sitez pas.{0,40}recontact|passez une excellente/i;

export interface ScoringResult {
  newScore: number;
  delta: number;
  label: "froid" | "tiède" | "chaud";
  interested: boolean;
  needsHandoff: boolean;
  handoffReason?: string;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ");
}

export async function scoreIncomingMessage(userId: number, text: string, chatId: string): Promise<ScoringResult> {
  const contact = await getContact(userId, chatId);
  const automationId = contact?.conversation_campaign_id ?? null;
  let current = contact?.lead_score ?? 0;
  if (automationId != null) {
    const state = await getContactAutomationState(userId, chatId, automationId);
    if (state) current = state.lead_score;
  }
  let delta = 2;

  if (HOT_KEYWORDS.test(text)) delta += 25;
  if (PRICE_KEYWORDS.test(text)) delta += 15;
  if (NEGATIVE_KEYWORDS.test(text)) delta -= 35;
  if (text.trim().length > 80) delta += 5;
  if (/\?/.test(text)) delta += 5;
  if (detectConversionIntent(text)) delta += 30;

  const newScore = Math.max(0, Math.min(100, current + delta));
  await updateContactLeadScore(userId, chatId, newScore);
  if (automationId != null) {
    await updateContactAutomationLeadScore(userId, chatId, automationId, newScore).catch(() => {});
  }

  const label = newScore >= 70 ? "chaud" : newScore >= 40 ? "tiède" : "froid";
  const interested = newScore >= 70 || HOT_KEYWORDS.test(text) || detectConversionIntent(text);
  const needsHandoff = HANDOFF_KEYWORDS.test(text) || newScore >= 85;

  return {
    newScore,
    delta,
    label,
    interested,
    needsHandoff,
    handoffReason: needsHandoff
      ? HANDOFF_KEYWORDS.test(text)
        ? "Demande explicite d'intervention humaine"
        : "Prospect très chaud — score ≥ 85"
      : undefined,
  };
}

/** Preuve explicite rare (paiement, etc.) — bonus scoring / filet. */
export function detectConversionIntent(text: string): boolean {
  const t = normalizeText(text);
  return /j.?ai paye|paiement (fait|effectue|ok|valide)|j.?ai (commande|acheter|achete)|commande (passee|faite)|c.?est commande|j.?ai clique|lien (recu|marche|ok)|rdv (confirme|pris|ok)|rendez[- ]vous (confirme|pris)|c.?est bon j.?ai|ok j.?ai paye|transfert (fait|effectue)/i.test(
    t
  );
}

const WEEKDAY =
  /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|aujourd'?hui)\b/i;
/** Heure style WhatsApp : 14h, 14 h 30, 14:30, 9h. */
const CLOCK_TIME =
  /\b([01]?\d|2[0-3])\s*h(?:\s*[0-5]\d)?\b|\b([01]?\d|2[0-3])[:.][0-5]\d\b/i;
const ASKED_FOR_SLOT =
  /dispo|disponib|cr[eé]neau|quand|cette semaine|la semaine|on (fixe|voit|book)|pr[eé]f[eè]res|10h ou|appel|rdv|rendez[- ]vous|te book/i;

/**
 * Objectif campagne atteint — règles simples, pas de LLM.
 * Lien / paiement explicite / handoff livraison déjà LIVRÉ + « ok » = on arrête.
 * Analogie prospection (offre + oui ≠ close) : un devis/prix + « okay » ≠ objectif
 * (Support doit avancer : taille, quantité, lien, paiement — pas « Bonne continuation »).
 * Une simple offre (« Je vous l'envoie ? ») + « oui » ≠ objectif atteint.
 */
export function isCampaignObjectiveReached(
  text: string,
  history: { direction: string; body: string }[],
  config?: Pick<AutomationConfig, "closingGoal" | "closingLink"> | null
): boolean {
  void config;
  if (detectConversionIntent(text)) return true;

  const t = text.trim();
  if (!t || t.startsWith("[")) return false;
  if (!SHORT_ACK.test(t) && !SHORT_ACK.test(normalizeText(t))) return false;

  // « Oui » à une offre d'envoi → on doit encore livrer le lien, pas clôturer.
  if (isAffirmingPendingSendOffer(t, history)) return false;

  // Adieu / refus déjà dit → un « ok » n'est PAS une conversion.
  const recentOut = history
    .filter((m) => m.direction === "sortant")
    .slice(-6)
    .map((m) => m.body);
  if (
    recentOut.some((body) =>
      /je (ne )?(vous |te )?(d[eé]range|contacte|ecri) plus|bonne (journ[eé]e|continuation)|n['’]?h[eé]sitez pas.{0,40}recontact/i.test(
        body
      )
    )
  ) {
    return false;
  }

  return recentOut.some((body) => outboundDeliveredAction(body));
}

/** True si un message sortant récent a déjà clôturé à l'oral (évite double confirmation). */
export function wasVerballyClosed(
  history: { direction: string; body: string }[]
): boolean {
  const recentOut = history
    .filter((m) => m.direction === "sortant")
    .slice(-6);
  // Clôture orale définitive seulement s'il y a aussi une action D livrée.
  if (!recentOut.some((m) => outboundDeliveredAction(m.body))) return false;
  return recentOut.slice(-4).some((m) => VERBAL_CLOSE_DONE.test(m.body));
}

const CONTINUE_AFTER_PREMATURE_CLOSE =
  "Je reste disponible pour la suite — dites-moi simplement ce qu'il vous faut.";

function stripPrematureFarewell(text: string): string {
  const stripped = text
    .replace(
      /(?:^|[.!?]\s+)(?:bonne continuation|bonne journ[eé]e|passez une excellente)[^.!?]*[.!?]?\s*/gi,
      " "
    )
    .replace(
      /\bje (ne )?(vous |te )?(d[eé]range|contacte|ecri) plus[^.!?]*[.!?]?\s*/gi,
      " "
    )
    .replace(/\bc['’]est not[eé] de mon c[oô]t[eé][^.!?]*[.!?]?\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (stripped.length >= 12 && !VERBAL_CLOSE_DONE.test(stripped)) return stripped;
  if (stripped.length >= 12) {
    const withoutClose = stripped.replace(VERBAL_CLOSE_DONE, "").replace(/\s{2,}/g, " ").trim();
    if (withoutClose.length >= 12) return withoutClose;
  }
  return CONTINUE_AFTER_PREMATURE_CLOSE;
}

/**
 * Filet : un adieu LLM n'est définitif que si une action D est déjà livrée
 * (ce message ou l'historique). Sinon on recadre le texte, on n'arrête pas.
 */
export function alignOutboundVerbalClose(
  reply: string,
  inboundText: string,
  history: { direction: string; body: string }[],
  config?: Pick<AutomationConfig, "closingGoal" | "closingLink"> | null
): { reply: string; premature: boolean } {
  const t = String(reply ?? "").trim();
  if (!t || !VERBAL_CLOSE_DONE.test(t)) return { reply: t, premature: false };
  if (outboundDeliveredAction(t)) return { reply: t, premature: false };
  const recentOut = history.filter((m) => m.direction === "sortant").slice(-6);
  if (recentOut.some((m) => outboundDeliveredAction(m.body))) {
    return { reply: t, premature: false };
  }
  if (isCampaignObjectiveReached(inboundText, history, config)) {
    return { reply: t, premature: false };
  }
  return { reply: stripPrematureFarewell(t), premature: true };
}

/**
 * Prise de RDV verbale : le prospect donne un créneau (jour + heure, ou heure
 * après proposition) alors que l'agent venait de demander une dispo.
 * Distinct de isCampaignObjectiveReached (ack après lien) pour laisser l'IA
 * envoyer le lien de résa avant clôture + notif tiers.
 */
export function isAppointmentSlotConfirmed(
  text: string,
  history: { direction: string; body: string }[],
  config?: Pick<AutomationConfig, "closingGoal"> | null
): boolean {
  const goal = (config?.closingGoal || "").toLowerCase();
  if (goal && goal !== "appointment") return false;

  const t = text.trim();
  if (!t || t.startsWith("[")) return false;

  const recentOut = history
    .filter((m) => m.direction === "sortant")
    .slice(-6)
    .map((m) => m.body);
  if (!recentOut.some((body) => ASKED_FOR_SLOT.test(body))) return false;

  const hasDay = WEEKDAY.test(t);
  const hasTime = CLOCK_TIME.test(t);
  if (hasDay && hasTime) return true;

  // « 14h c'est cool » après « 10h ou 14h »
  if (
    hasTime &&
    recentOut.some((body) => CLOCK_TIME.test(body) && /\bou\b|pr[eé]f/i.test(body))
  ) {
    return true;
  }

  return false;
}

export async function recordAutomationConversion(
  userId: number,
  automationId: number,
  revenueFcfa = 0
): Promise<void> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return;
  const stats = auto.stats;
  await updateAutomationStats(userId, automationId, {
    conversions: (stats.conversions ?? 0) + 1,
    revenueFcfa: (stats.revenueFcfa ?? 0) + revenueFcfa,
  });
}
