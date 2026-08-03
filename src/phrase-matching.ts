/** Normalise un texte pour comparaison (casse, accents). */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

/**
 * Vérifie si un mot ou une phrase exacte est présent dans le texte.
 * - Mot seul : correspondance mot entier (frontières).
 * - Phrase multi-mots : sous-chaîne exacte normalisée.
 */
export function matchesTriggerPhrase(text: string, phrase: string): boolean {
  const normText = normalizeForMatch(text);
  const normPhrase = normalizeForMatch(phrase);
  if (!normPhrase) return false;

  if (normPhrase.includes(" ")) {
    return normText.includes(normPhrase);
  }

  const escaped = normPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
  return re.test(normText);
}

export function matchesAnyTriggerPhrase(text: string, phrases: string[]): boolean {
  const cleaned = phrases.map((p) => p.trim()).filter(Boolean);
  return cleaned.some((p) => matchesTriggerPhrase(text, p));
}

/**
 * Handoff : plus souple qu'un déclencheur campagne.
 * « plainte » doit aussi matcher « me plaindre », « se plaint », « plaintes ».
 */
export function matchesHandoffKeyword(text: string, keyword: string): boolean {
  if (matchesTriggerPhrase(text, keyword)) return true;

  const normPhrase = normalizeForMatch(keyword);
  if (!normPhrase || normPhrase.includes(" ")) return false;
  // Mots trop courts : rester strict (évite faux positifs).
  if (normPhrase.length < 5) return false;

  const radical = normPhrase.slice(0, Math.max(5, normPhrase.length - 2));
  const escaped = radical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped}[a-z]{0,5}(?:[^a-z0-9]|$)`, "i");
  return re.test(normalizeForMatch(text));
}
