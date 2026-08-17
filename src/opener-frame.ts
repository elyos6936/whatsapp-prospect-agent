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

/** Risque réel encouru, formulé pour l'utilisateur (pas une règle produit). */
const OPENER_RISK_EXPLANATIONS: Array<{ test: (t: string) => boolean; risk: string }> = [
  {
    test: (t) => URL_RE.test(t),
    risk:
      "un lien dès le 1er message : c'est le principal facteur de blocage WhatsApp en prospection à froid, et le taux de réponse chute",
  },
  {
    test: (t) => PRICE_RE.test(t),
    risk:
      "un prix dès le 1er message : annoncé avant que l'intérêt soit créé, il fait décrocher la majorité des prospects",
  },
  {
    test: (t) => t.length > 140 && PITCH_DUMP_RE.test(t),
    risk:
      "un pitch complet dès le 1er message : les pavés commerciaux en ouverture sont les plus signalés comme spam",
  },
];

/**
 * Avertissement — PAS un refus.
 *
 * Le cadre A.I.D.A. est une recommandation anti-blocage, pas une contrainte produit :
 * les stratégies varient d'une campagne et d'un utilisateur à l'autre. On expose donc
 * le risque et on demande l'accord, au lieu d'imposer un format unique.
 */
export function formatAttentionOpenerWarning(
  label: string,
  text: string,
  opts?: { confirmField?: string }
): string {
  const opener = text.trim();
  const risks = OPENER_RISK_EXPLANATIONS.filter((r) => r.test(opener)).map((r) => r.risk);
  const field = opts?.confirmField ?? "keep_opener_as_is";
  const tooLong = opener.length > ATTENTION_OPENER_MAX_CHARS;
  const short = tooLong ? proposeShortAttentionOpener(opener) : null;
  return (
    `${label} sort du cadre A.I.D.A. Attention recommandé. ` +
    `AVERTIS l'utilisateur des risques puis DEMANDE-LUI s'il veut quand même garder son message tel quel — ` +
    `n'impose aucun format, c'est sa campagne et sa stratégie.\n` +
    `Risques à lui exposer : ${risks.length ? risks.join(" ; ") : "message hors cadre recommandé"}.` +
    (short ? `\nAlternative possible à lui proposer : « ${short} ».` : "") +
    `\nAlternative : lien → closing_link, prix → price, détails → conversation_guide.\n` +
    `S'il confirme vouloir garder son texte (« oui », « garde comme ça », « je préfère ainsi ») : ` +
    `rappelle le même outil avec ${field}=true et son message inchangé. Ne reformule PAS sans son accord.`
  );
}

export function openerRiskGatePayload(label: string, text: string): Record<string, unknown> {
  return {
    error: formatAttentionOpenerWarning(label, text),
    needs_opener_risk_acceptance: true,
    needsUserConfirmation: true,
    warning: formatAttentionOpenerWarning(label, text),
    hint:
      "Préviens l'utilisateur des risques. S'il confirme → keep_opener_as_is ou opener_risk_accepted=true.",
  };
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
 *
 * Contrôles STRUCTURELS uniquement (la rotation A/B en a besoin pour fonctionner).
 * Le style des accroches relève de l'avertissement, pas du refus : voir
 * `outboundVariantsOutOfFrame` + `formatAttentionOpenerWarning`.
 */
export function validateOutboundAbVariants(
  variants: Array<{ id?: string; message?: string }> | null | undefined,
  _opts?: { fromUserValidatedChat?: boolean; riskAccepted?: boolean }
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

/**
 * Première variante hors cadre recommandé, s'il y en a une.
 * Sert à AVERTIR (jamais à refuser) : l'utilisateur garde le dernier mot.
 */
export function outboundVariantsOutOfFrame(
  variants: Array<{ id?: string; message?: string }> | null | undefined
): { id: string; message: string } | null {
  const cleaned = (variants ?? []).map((v, i) => ({
    id: v.id || `v${i + 1}`,
    message: String(v.message ?? "").trim(),
  }));
  for (const v of cleaned) {
    if (v.message && !isValidAttentionOpener(v.message)) return v;
  }
  return null;
}
