/**
 * Cadre A.I.D.A. Attention pour les premiers messages sortants.
 * Variation = micro-formulation uniquement — pas de pitch complet.
 */

const URL_RE = /https?:\/\/\S+/i;
const PRICE_RE = /\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)\b/i;
const PITCH_DUMP_RE =
  /\b(il reste\s+\d+|places?\s+(limité|restant)|inscription|webinaire|formation gratuite|paie(z)?|r[eé]serv(e|ez)|lien (ici|ci[- ]dessous))\b/i;

export const ATTENTION_OPENER_MAX_CHARS = 200;

export function attentionOpenerIssues(text: string): string[] {
  const opener = text.trim();
  const issues: string[] = [];
  if (!opener) {
    issues.push("message vide");
    return issues;
  }
  if (URL_RE.test(opener)) issues.push("lien URL interdit");
  if (PRICE_RE.test(opener)) issues.push("prix interdit");
  if (opener.length > ATTENTION_OPENER_MAX_CHARS) {
    issues.push(`trop long (>${ATTENTION_OPENER_MAX_CHARS} caractères)`);
  }
  // Pitch trop chargé dès l'accroche (dates + places + offre complète…)
  if (opener.length > 140 && PITCH_DUMP_RE.test(opener)) {
    issues.push("pitch trop complet pour une accroche Attention");
  }
  return issues;
}

export function isValidAttentionOpener(text: string): boolean {
  return attentionOpenerIssues(text).length === 0;
}

export function formatAttentionOpenerError(label: string, text: string): string {
  const issues = attentionOpenerIssues(text);
  return (
    `${label} viole A.I.D.A. (Attention) : ${issues.join(", ")}. ` +
    `Le 1er message = accroche courte (1-2 phrases, ≤${ATTENTION_OPENER_MAX_CHARS} car.), ` +
    `SANS lien, SANS prix, SANS pitch complet. Mets le lien dans closing_link, le prix dans price, ` +
    `les détails dans conversation_guide.`
  );
}
