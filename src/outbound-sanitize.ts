/**
 * Placeholders type [prix], [lien], [Prénom] — jamais autorisés en message WhatsApp sortant.
 * Filet de sécurité anti-amateur : l'IA ne doit jamais envoyer de crochets aux prospects.
 */
const TEMPLATE_PLACEHOLDER_RE = /\[[^\]]{1,80}\]/;

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function hasTemplatePlaceholders(text: string): boolean {
  return TEMPLATE_PLACEHOLDER_RE.test(text);
}

/**
 * Si du texte entre crochets est détecté, on refuse d'envoyer tel quel
 * et on remplace par une phrase sûre (sans inventer de prix/lien).
 */
export function sanitizeOutboundWhatsAppText(text: string): string {
  const trimmed = text.trim();
  if (!hasTemplatePlaceholders(trimmed)) return trimmed;
  console.warn(
    `⚠️ Placeholder détecté dans un message sortant — remplacé. Brut: ${trimmed.slice(0, 160)}`
  );
  return "Je vous confirme le détail exact juste après.";
}

function normalizeUrlForCompare(url: string): string {
  return url
    .trim()
    .replace(/[),.;]+$/g, "")
    .toLowerCase()
    .replace(/\/$/, "");
}

function urlAllowed(candidate: string, allowedLink: string): boolean {
  const a = normalizeUrlForCompare(allowedLink);
  const c = normalizeUrlForCompare(candidate);
  if (!a || !c) return false;
  return c === a || c.startsWith(a) || a.startsWith(c);
}

/**
 * Filet dur : l'IA invente parfois https://example.com / faux liens boutique.
 * - Pas de closingLink campagne → aucune URL autorisée (remplace le message si besoin).
 * - closingLink présent → seules les URL qui matchent sont gardées ; les autres → lien réel.
 */
export function sanitizeInventedCampaignUrls(
  text: string,
  opts?: { allowedLink?: string | null; closingGoal?: string | null }
): string {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  const urls = raw.match(URL_IN_TEXT_RE);
  if (!urls?.length) return raw;

  const allowed = opts?.allowedLink?.trim() || "";
  const goal = (opts?.closingGoal || "").toLowerCase();

  const unauthorized = urls.filter((u) => !allowed || !urlAllowed(u, allowed));
  if (!unauthorized.length) return raw;

  console.warn(
    `⚠️ URL non autorisée dans réponse WhatsApp — filet. Brut: ${raw.slice(0, 160)}`
  );

  if (!allowed) {
    if (goal === "delivery") {
      return "Parfait. Indiquez-moi le lieu de livraison (quartier / ville), s'il vous plaît.";
    }
    if (goal === "payment") {
      return "Parfait. Je vous confirme le mode de paiement exact juste après.";
    }
    if (goal === "appointment") {
      return "Parfait. Quel jour et quelle heure vous arrangent pour le rendez-vous ?";
    }
    return "Parfait. Dites-moi comment vous préférez finaliser, et j'avance avec vous.";
  }

  // Lien campagne connu : remplace les faux URL par le vrai.
  let out = raw;
  for (const u of unauthorized) {
    out = out.split(u).join(allowed);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Majuscule en tête + retire artefacts (!, #…) — qualité WhatsApp. */
export function ensureLeadingCapital(text: string): string {
  let t = String(text ?? "")
    .replace(/^[\s!*#>\-–—]+/, "")
    .trim();
  if (!t) return "";
  return t.replace(/^[a-zàâäéèêëïîôùûüç]/, (c) => c.toUpperCase());
}

/** Liste les champs d'une config de campagne qui contiennent encore des crochets. */
export function findPlaceholderFields(
  fields: Array<{ label: string; value?: string | null }>
): string[] {
  return fields
    .filter((f) => f.value && hasTemplatePlaceholders(f.value))
    .map((f) => f.label);
}
