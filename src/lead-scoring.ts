import { getContact, updateContactLeadScore, updateAutomationStats, getAutomation } from "./db.js";

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

export async function scoreIncomingMessage(text: string, chatId: string): Promise<ScoringResult> {
  const contact = await getContact(chatId);
  const current = contact?.lead_score ?? 0;
  let delta = 2;

  if (HOT_KEYWORDS.test(text)) delta += 25;
  if (PRICE_KEYWORDS.test(text)) delta += 15;
  if (NEGATIVE_KEYWORDS.test(text)) delta -= 35;
  if (text.trim().length > 80) delta += 5;
  if (/\?/.test(text)) delta += 5;

  const newScore = Math.max(0, Math.min(100, current + delta));
  await updateContactLeadScore(chatId, newScore);

  const label = newScore >= 70 ? "chaud" : newScore >= 40 ? "tiède" : "froid";
  const interested = newScore >= 70;
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

export async function recordAutomationConversion(
  automationId: number,
  revenueFcfa = 0
): Promise<void> {
  const auto = await getAutomation(automationId);
  if (!auto) return;
  const stats = auto.stats;
  await updateAutomationStats(automationId, {
    conversions: (stats.conversions ?? 0) + 1,
    revenueFcfa: (stats.revenueFcfa ?? 0) + revenueFcfa,
  });
}
