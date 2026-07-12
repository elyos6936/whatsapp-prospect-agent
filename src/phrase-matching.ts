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
