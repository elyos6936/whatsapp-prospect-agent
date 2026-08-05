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

/**
 * Prospection sortante : exactement 5 accroches DISTINCTES.
 * Empêche de ne garder que initial_message (ou 5 copies du même texte).
 * @param opts.fromUserValidatedChat — textes déjà validés dans le chat : on n'applique
 *   pas le filtre A.I.D.A. strict (longueur / pitch) qui rejetterait sinon tout le lot.
 */
export function validateOutboundAbVariants(
  variants: Array<{ id?: string; message?: string }> | null | undefined,
  opts?: { fromUserValidatedChat?: boolean }
): string | null {
  const cleaned = (variants ?? [])
    .map((v, i) => ({
      id: v.id || `v${i + 1}`,
      message: String(v.message ?? "").trim(),
    }))
    .filter((v) => v.message.length > 0);

  if (cleaned.length !== 5) {
    return (
      `Prospection sortante : ab_variants doit contenir exactement 5 accroches Attention ` +
      `(reçu : ${cleaned.length}). Quand l'utilisateur valide, repasse TOUTES les 5 formulations ` +
      `proposées dans le chat — pas seulement celle choisie pour initial_message. ` +
      `Format : [{id:"v1",message:"…"}, … {id:"v5",message:"…"}].`
    );
  }

  if (!opts?.fromUserValidatedChat) {
    for (const v of cleaned) {
      if (!isValidAttentionOpener(v.message)) {
        return formatAttentionOpenerError(`ab_variants.${v.id}`, v.message);
      }
    }
  }

  const unique = new Set(cleaned.map((v) => v.message.toLowerCase().replace(/\s+/g, " ")));
  if (unique.size < 3) {
    return (
      `Les 5 ab_variants sont trop similaires (${unique.size} formulation(s) distincte(s)). ` +
      `Il faut 5 formulations DIFFÉRENTES (au moins 3 textes clairement distincts) — ` +
      `ne duplique pas le même message 5 fois. Reprends les 5 pistes proposées dans le chat.`
    );
  }

  return null;
}
