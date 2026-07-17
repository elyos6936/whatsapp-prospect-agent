import {
  getContact,
  updateContactLeadScore,
  updateContactAutomationLeadScore,
  updateAutomationStats,
  getAutomation,
  getContactAutomationState,
} from "./db.js";

const HOT_KEYWORDS =
  /int[eé]ress|curieux|commander|commande|acheter|inscription|je veux|oui|d'accord|appel|rdv|rendez-vous/i;
const PRICE_KEYWORDS = /prix|tarif|combien|fcfa|franc|co[uû]t|budget/i;
const NEGATIVE_KEYWORDS =
  /pas int[eé]ress|non merci|laisse|occup[eé]|arnaque|scam|plainte|r[eé]clamation|avocat|police/i;
const HANDOFF_KEYWORDS =
  /parler (à|a) (un |une )?humain|responsable|g[eé]rant|directeur|plainte|remboursement|r[eé]clamation urgente/i;

export interface ScoringResult {
  newScore: number;
  delta: number;
  label: "froid" | "tiède" | "chaud";
  interested: boolean;
  needsHandoff: boolean;
  handoffReason?: string;
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

/** Le prospect signale qu'il a payé / commandé / pris RDV / cliqué le lien. */
export function detectConversionIntent(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ");
  return /j.?ai paye|paiement (fait|effectue|ok|valide)|j.?ai (commande|acheter|achete)|commande (passee|faite)|c.?est commande|j.?ai clique|lien (recu|marche|ok)|rdv (confirme|pris|ok)|rendez[- ]vous (confirme|pris)|c.?est bon j.?ai|ok j.?ai paye|transfert (fait|effectue)/i.test(
    t
  );
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
