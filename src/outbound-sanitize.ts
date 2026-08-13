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

/** Retire les URL listées et recolle proprement (« le lien : » orphelin, doubles espaces…). */
function stripUrls(text: string, urls: string[]): string {
  let out = text;
  for (const u of urls) {
    out = out.split(u).join(" ");
  }
  return out
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?…])/g, "$1")
    .replace(/\s*[:;]\s*(?=$|\n)/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Reste qui ne fait qu'annoncer un lien retiré (CTA orphelin). */
function isOrphanedLinkCta(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(lien|url|clique[rz]?|finalis\w*|command[ezr]\w*|payer|paiement)\b/i.test(t)) {
    return false;
  }
  // Info concrète (prix, produit, lieu) → on garde le reste, on n'écrase pas.
  if (
    /\b(\d[\d\s.]{1,}\s*(fcfa|f\b|€|euros?)|quartier|ville|livr|taille|couleur|dispo)/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

/** Reste-t-il une phrase exploitable après retrait de l'URL ? */
function hasUsableSentence(text: string): boolean {
  if (text.length < 15 || !/[a-zàâäéèêëïîôùûüç]/i.test(text)) return false;
  if (isOrphanedLinkCta(text)) return false;
  return true;
}

/**
 * Filet dur : l'IA invente parfois https://example.com / faux liens boutique.
 * - closingLink présent → les URL qui ne matchent pas sont remplacées par le lien réel.
 * - Sinon → l'URL inventée est retirée et le reste du message est conservé.
 *   Écraser tout le message figeait la réponse, qui se répétait alors à chaque tour.
 * Les liens déjà présents dans la campagne (guide, accroche, mémoire) sont légitimes :
 * `knownLinkSources` évite de censurer un lien que l'utilisateur a lui-même fourni.
 */
export function sanitizeInventedCampaignUrls(
  text: string,
  opts?: {
    allowedLink?: string | null;
    closingGoal?: string | null;
    knownLinkSources?: Array<string | null | undefined>;
  }
): string {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  const urls = raw.match(URL_IN_TEXT_RE);
  if (!urls?.length) return raw;

  const allowed = opts?.allowedLink?.trim() || "";
  const goal = (opts?.closingGoal || "").toLowerCase();

  const whitelist = [allowed];
  for (const source of opts?.knownLinkSources ?? []) {
    const found = String(source ?? "").match(URL_IN_TEXT_RE);
    if (found) whitelist.push(...found);
  }
  const knownLinks = whitelist.map((l) => l.trim()).filter(Boolean);

  const unauthorized = urls.filter(
    (u) => !knownLinks.some((link) => urlAllowed(u, link))
  );
  if (!unauthorized.length) return raw;

  console.warn(
    `⚠️ URL non autorisée dans réponse WhatsApp — filet. Brut: ${raw.slice(0, 160)}`
  );

  // Lien campagne connu : remplace les faux URL par le vrai.
  if (allowed) {
    let out = raw;
    for (const u of unauthorized) {
      out = out.split(u).join(allowed);
    }
    return out.replace(/\s{2,}/g, " ").trim();
  }

  const stripped = stripUrls(raw, unauthorized);
  if (hasUsableSentence(stripped)) return stripped;

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
