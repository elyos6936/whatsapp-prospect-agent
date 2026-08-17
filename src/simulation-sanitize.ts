/**
 * Empêche la simu de recoller les listes opérationnelles (numéros, cibles)
 * du chat agence dans un message destinés au prospect.
 */

const PHONE_TOKEN_RE = /(?:\+|00)\d{6,18}|\b\d{8,15}\b/g;

export function countPhoneTokens(text: string): number {
  return (text.match(PHONE_TOKEN_RE) ?? []).length;
}

export function looksLikePhoneDump(text: string): boolean {
  const t = text.trim();
  if (countPhoneTokens(t) >= 3) return true;
  if (/prospect\s+list|prospects?\s+en\s+attente|liste\s+des?\s+(nouveaux\s+)?contacts/i.test(t)) {
    return countPhoneTokens(t) >= 2;
  }
  return false;
}

/** Remplace un pavé de contacts par un marqueur que le LLM ne doit pas recopier. */
export function sanitizeOperationalText(text: string): string {
  if (!text.trim()) return text;
  if (!looksLikePhoneDump(text)) return text;
  return (
    "[Liste opérationnelle de contacts / numéros — INTERDIT de la recopier au prospect. " +
    "Ce n'est PAS un message WhatsApp.]"
  );
}

export function sanitizeSimInput(text: string, maxChars: number): string {
  return sanitizeOperationalText(text).slice(0, maxChars);
}

export function turnsContainPhoneDump(
  turns: Array<{ text?: string }>
): boolean {
  return turns.some((t) => looksLikePhoneDump(String(t.text ?? "")));
}

const VAGUE_AFTER_YES_RE =
  /\b(comment\s+(vous\s+)?pr[eé]f[eé]rez\s+finaliser|dites[- ]moi\s+comment|on\s+avance\s+avec\s+vous|je\s+reste\s+[aà]\s+votre\s+disposition)\b/i;

export function turnLooksVagueAfterYes(text: string): boolean {
  return VAGUE_AFTER_YES_RE.test(text);
}
