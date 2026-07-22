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
  /parler (à|a) (un |une )?humain|responsable|g[eé]rant|directeur|plainte|remboursement|r[eé]clamation urgente/i;

/** Accusé de réception court après envoi d'un lien / prix / créneau. */
const SHORT_ACK =
  /^(ok|okay|oui|ouais|d['']accord|dac|parfait|super|merci|top|nickel|impeccable|c['']est (bon|not[eé])|re[cç]u|bien re[cç]u|je (vais )?regarder|je regarde|partant|volontiers)([\s!.?,;:]|$)/i;

/** L'agent a envoyé quelque chose d'actionnable (lien externe, paiement, RDV). */
const ACTION_OFFERED =
  /https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/|bit\.ly\/|calendly\.|fcfa|lien (ici|ci[- ]dessous|suivant)|voici (mon |le )?lien|pour (r[eé]server|payer|rejoindre)/i;

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
 * Lien / paiement / RDV envoyé par l'agent + « ok » du prospect = on arrête
 * (on n'attend pas qu'il confirme avoir rejoint / payé sur un site externe).
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

  const recentOut = history
    .filter((m) => m.direction === "sortant")
    .slice(-6)
    .map((m) => m.body);

  return recentOut.some((body) => ACTION_OFFERED.test(body));
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
