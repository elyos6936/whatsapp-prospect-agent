/**
 * Cadre A.I.D.A. Attention pour les premiers messages sortants.
 * Variation = micro-formulation uniquement — pas de pitch complet.
 */

const URL_RE = /https?:\/\/\S+/i;
const PRICE_RE = /\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)\b/i;
const PITCH_DUMP_RE =
  /\b(il reste\s+\d+|places?\s+(limité|restant)|inscription|webinaire|formation gratuite|paie(z)?|r[eé]serv(e|ez)|lien (ici|ci[- ]dessous))\b/i;

export const ATTENTION_OPENER_MAX_CHARS = 200;

/** Blocants durs : URL / prix / pitch — la longueur seule n'est plus un refus (choix produit 7-C). */
export function attentionOpenerHardIssues(text: string): string[] {
  const opener = text.trim();
  const issues: string[] = [];
  if (!opener) {
    issues.push("message vide");
    return issues;
  }
  if (URL_RE.test(opener)) issues.push("lien URL interdit");
  if (PRICE_RE.test(opener)) issues.push("prix interdit");
  if (opener.length > 140 && PITCH_DUMP_RE.test(opener)) {
    issues.push("pitch trop complet pour une accroche Attention");
  }
  return issues;
}

export function attentionOpenerIssues(text: string): string[] {
  const opener = text.trim();
  const issues = attentionOpenerHardIssues(opener);
  if (opener && opener.length > ATTENTION_OPENER_MAX_CHARS) {
    issues.push(`trop long (>${ATTENTION_OPENER_MAX_CHARS} caractères) — version courte recommandée`);
  }
  return issues;
}

export function isValidAttentionOpener(text: string): boolean {
  return attentionOpenerHardIssues(text).length === 0;
}

/** Propose une version Attention courte (1–2 phrases) si le texte dépasse la cible. */
export function proposeShortAttentionOpener(text: string): string | null {
  const opener = text.trim().replace(/\s+/g, " ");
  if (!opener || opener.length <= ATTENTION_OPENER_MAX_CHARS) return null;
  const sentences = opener.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let short = "";
  for (const s of sentences) {
    const next = short ? `${short} ${s}` : s;
    if (next.length > ATTENTION_OPENER_MAX_CHARS) break;
    short = next;
    if (short.length >= 60 && /[.!?…]$/.test(short)) break;
  }
  if (!short || short.length < 24) {
    short = opener.slice(0, ATTENTION_OPENER_MAX_CHARS - 1).replace(/\s+\S*$/, "").trim();
  }
  if (!short || short === opener || short.length < 20) return null;
  return short;
}

export function formatAttentionOpenerError(label: string, text: string): string {
  const hard = attentionOpenerHardIssues(text);
  if (hard.length) {
    return (
      `${label} viole A.I.D.A. (Attention) : ${hard.join(", ")}. ` +
      `Le 1er message = accroche SANS lien, SANS prix, SANS pitch complet. ` +
      `Mets le lien dans closing_link, le prix dans price, les détails dans conversation_guide.`
    );
  }
  const short = proposeShortAttentionOpener(text);
  return (
    `${label} est longue (>${ATTENTION_OPENER_MAX_CHARS} car.). ` +
    (short
      ? `Version courte proposée : « ${short} ». Tu peux garder la longue ou valider la courte.`
      : `Propose aussi une version ≤${ATTENTION_OPENER_MAX_CHARS} car.`)
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
