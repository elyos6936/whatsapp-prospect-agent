/**
 * Cadre A.I.D.A. Attention pour les premiers messages sortants (recommandé).
 * L'utilisateur peut imposer un autre format après avertissement + consentement.
 */

const URL_RE = /https?:\/\/\S+/i;
const PRICE_RE = /\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)\b/i;
const PITCH_DUMP_RE =
  /\b(il reste\s+\d+|places?\s+(limité|restant)|inscription|webinaire|formation gratuite|paie(z)?|r[eé]serv(e|ez)|lien (ici|ci[- ]dessous))\b/i;

/** Consentement explicite à garder un 1er message hors cadre Attention. */
const OPENER_RISK_ACCEPT_RE =
  /\b(je\s+(garde|assume|prends|maintiens)|garde\s+(ma|la\s+mienne|celle[- ]ci)|ok\s+(je\s+)?(garde|assume)|je\s+veux\s+(garder|ma\s+version)|cr[eé]e(r)?\s+(quand\s+m[eê]me\s+)?(les\s+)?variantes?|quand\s+m[eê]me|j['’]accepte|j['’]assume|risque\s+(ok|accept[eé])|vas[- ]y\s+(quand\s+m[eê]me)?|on\s+garde\s+(ma|cette)\s+version|je\s+reste\s+sur\s+(ma|cette))\b/i;

/** L'agent a déjà prévenu des risques (prix/lien/pitch dans le 1er message). */
const OPENER_RISK_WARN_RE =
  /\b(risque|spam|moins\s+de\s+r[eé]ponses?|d[eé]livrabilit[eé]|prix.{0,60}lien|lien.{0,60}prix|pitch\s+(trop\s+)?(complet|t[oô]t)|version\s+courte|garde(r)?\s+(ta|votre|cette)\s+version|assumer?\s+(le\s+)?risque|hors\s+(du\s+)?cadre\s+attention|a\.?i\.?d\.?a)\b/i;

export const ATTENTION_OPENER_MAX_CHARS = 200;

/** Seul blocant technique dur : message vide. */
export function attentionOpenerEmptyIssue(text: string): string | null {
  return text.trim() ? null : "message vide";
}

/**
 * Avertissements (non bloquants si l'utilisateur accepte le risque) :
 * URL / prix / pitch trop complet.
 */
export function attentionOpenerSoftIssues(text: string): string[] {
  const opener = text.trim();
  const issues: string[] = [];
  if (!opener) return issues;
  if (URL_RE.test(opener)) issues.push("lien URL dès le 1er message");
  if (PRICE_RE.test(opener)) issues.push("prix dès le 1er message");
  if (opener.length > 140 && PITCH_DUMP_RE.test(opener)) {
    issues.push("pitch très complet dès le 1er message");
  }
  return issues;
}

/** @deprecated alias — soft issues (prix/lien/pitch), plus un refus serveur sans consentement. */
export function attentionOpenerHardIssues(text: string): string[] {
  const empty = attentionOpenerEmptyIssue(text);
  if (empty) return [empty];
  return attentionOpenerSoftIssues(text);
}

export function attentionOpenerIssues(text: string): string[] {
  const opener = text.trim();
  const issues = attentionOpenerHardIssues(opener);
  if (opener && opener.length > ATTENTION_OPENER_MAX_CHARS) {
    issues.push(`trop long (>${ATTENTION_OPENER_MAX_CHARS} caractères) — version courte recommandée`);
  }
  return issues;
}

/** true si conforme au format Attention recommandé (sans soft issues). */
export function isValidAttentionOpener(text: string): boolean {
  if (attentionOpenerEmptyIssue(text)) return false;
  return attentionOpenerSoftIssues(text).length === 0;
}

export function isOpenerRiskAcceptedText(text: string): boolean {
  return OPENER_RISK_ACCEPT_RE.test(text.trim());
}

export function hasAgentWarnedOpenerRisk(
  history: Array<{ role: string; content: string }>
): boolean {
  return history.slice(-20).some(
    (m) => m.role === "assistant" && OPENER_RISK_WARN_RE.test(m.content)
  );
}

export function hasUserAcceptedOpenerRisk(
  history: Array<{ role: string; content: string }>,
  userMessage?: string
): boolean {
  if (userMessage && isOpenerRiskAcceptedText(userMessage)) return true;
  const warnIdx = (() => {
    for (let i = history.length - 1; i >= Math.max(0, history.length - 20); i--) {
      const m = history[i];
      if (m?.role === "assistant" && OPENER_RISK_WARN_RE.test(m.content)) return i;
    }
    return -1;
  })();
  if (warnIdx < 0) {
    // Consentement explicite même sans warning détecté (ex. « je garde ma version »)
    return history.slice(-12).some(
      (m) => m.role === "user" && isOpenerRiskAcceptedText(m.content)
    );
  }
  for (let i = warnIdx + 1; i < history.length; i++) {
    const m = history[i];
    if (m?.role !== "user") continue;
    const t = m.content.trim();
    if (isOpenerRiskAcceptedText(t)) return true;
    // « oui / ok / je valide » juste après l'avertissement = acceptation
    if (
      /^(oui|ouais|ok|okay|d['’]accord|dac|parfait|valide|je\s+valide|c['’]est\s+bon|vas[- ]?y|garde)\b/i.test(
        t
      ) &&
      t.length < 80
    ) {
      return true;
    }
  }
  return false;
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

export function formatAttentionOpenerWarning(label: string, text: string): string {
  const soft = attentionOpenerSoftIssues(text);
  const short = proposeShortAttentionOpener(text);
  const risks =
    soft.length > 0
      ? soft.join(", ")
      : `longueur >${ATTENTION_OPENER_MAX_CHARS} car.`;
  return (
    `${label} sort du format Attention recommandé (${risks}). ` +
    `Risques possibles : moins de réponses, signalement spam, pitch trop tôt. ` +
    `Le format de base reste Attention (sans prix/lien/pitch). ` +
    (short ? `Version courte proposée : « ${short} ». ` : "") +
    `Si l'utilisateur confirme qu'il garde SA version → passe opener_risk_accepted=true ` +
    `et crée les 5 variantes dans SON style (ne force pas le format Attention).`
  );
}

/** @deprecated — utiliser formatAttentionOpenerWarning (soft gate). */
export function formatAttentionOpenerError(label: string, text: string): string {
  return formatAttentionOpenerWarning(label, text);
}

/**
 * Payload renvoyé par create/update quand un consentement risque est requis.
 */
export function openerRiskGatePayload(label: string, text: string): Record<string, unknown> {
  return {
    error: formatAttentionOpenerWarning(label, text),
    needs_opener_risk_acceptance: true,
    soft_issues: attentionOpenerSoftIssues(text),
    hint:
      "Préviens l'utilisateur des risques, propose une version Attention en option. " +
      "S'il confirme (« je garde », « ok », « crée les variantes ») → rappelle l'outil avec opener_risk_accepted=true.",
  };
}

/**
 * Prospection sortante : exactement 5 accroches DISTINCTES.
 * @param opts.fromUserValidatedChat — textes déjà validés dans le chat
 * @param opts.riskAccepted — l'utilisateur a accepté un format hors Attention
 */
export function validateOutboundAbVariants(
  variants: Array<{ id?: string; message?: string }> | null | undefined,
  opts?: { fromUserValidatedChat?: boolean; riskAccepted?: boolean }
): string | null {
  const cleaned = (variants ?? [])
    .map((v, i) => ({
      id: v.id || `v${i + 1}`,
      message: String(v.message ?? "").trim(),
    }))
    .filter((v) => v.message.length > 0);

  if (cleaned.length !== 5) {
    return (
      `Prospection sortante : ab_variants doit contenir exactement 5 formulations ` +
      `(reçu : ${cleaned.length}). Quand l'utilisateur valide, repasse TOUTES les 5 formulations ` +
      `proposées dans le chat — pas seulement celle choisie pour initial_message. ` +
      `Format : [{id:"v1",message:"…"}, … {id:"v5",message:"…"}].`
    );
  }

  const skipSoft =
    Boolean(opts?.fromUserValidatedChat) || Boolean(opts?.riskAccepted);
  if (!skipSoft) {
    for (const v of cleaned) {
      if (!isValidAttentionOpener(v.message)) {
        return formatAttentionOpenerWarning(`ab_variants.${v.id}`, v.message);
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
