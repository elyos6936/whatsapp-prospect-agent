import type { AutomationConfig } from "./db.js";

export type StopReason =
  | "dissatisfaction"
  | "unknown_question"
  | "escalation"
  | "not_interested"
  | "skepticism"
  | "conversation_stall"
  | "off_topic";

const DISSATISFACTION_PATTERNS =
  /pas content|pas satisf|mecontent|insatisf|arnaque|escroc|hors de question|nul\b|mauvais service|inacceptable|scandale|vous abusez|laissez-moi tranquille|plus jamais|je me plains/i;

const ESCALATION_PATTERNS =
  /parler a un humain|parler a une personne|un responsable|votre patron|votre chef|appeler|telephone direct|numero direct|je veux parler (a|à|avec) (un |une )?(humain|personne|responsable)/i;

/** Refus clair uniquement — pas les « non » ambigus ni le scepticisme de curiosité. */
const NOT_INTERESTED_PATTERNS =
  /pas (du tout )?interesse|pas int[eé]ress[eée]?(\s|$|!|\.)|non merci|ca m.?interesse pas|cela m.?interesse pas|je (ne )?suis pas interesse|pas pour moi|pas besoin(\s|$)|je n.?ai pas besoin|fiche moi la paix|fichez-moi la paix|ne m.?ecri(s|ve|vez) plus|plus de message|j.?ai pas demande|je n.?ai pas demande|arrete(z)? (de )?(m.?ecri|me contacter)|stop (les? )?messages/i;

const SKEPTICISM_SOFT_PATTERNS =
  /c.?est (toi|vous) qui (vient|venez|m.?a|m.?ont)|pourquoi tu m.?ecri|pourquoi vous m.?ecri|je (ne )?(te|vous) connais pas|c.?est quoi ce truc|bon c.?est toi qui|qui (etes|êtes)-vous|tu es qui|vous etes qui/i;

const SKEPTICISM_HOSTILE_PATTERNS =
  /spam|harcelement|harc[eè]lement|tu m.?enerve|vous m.?enerve|arrete(z)? (de m.?ecri|ca)|fiche(z)?[- ]?moi la paix/i;

const PRICE_QUESTION = /combien|prix|tarif|co[uû]t|fcfa|franc|budget|payer combien/i;
const DELIVERY_QUESTION = /livraison|livrer|adresse|ou est|delai de livraison|frais de port/i;
const PRODUCT_QUESTION = /c'est quoi|qu'est.ce que|detail|composition|ingredient|garantie|retour/i;

const OFF_TOPIC_PATTERNS =
  /\b(ecris|écris|redige|rédige|compose|genere|génère)\b[^?.!]*\b(poeme|poème|poesie|poésie|chanson|dissertation|redaction|rédaction|code|script|programme|essai|texte|paragraphe|lettre de motivation|cv)\b|\btradui(s|re|sez)\b|\btraduction\b|qui est le president|qui est le président|capitale (de|du|des)|combien font|combien fait|resou(s|dre)|résou(s|dre)|calcule[- ]?moi|raconte[- ]?(moi )?une (blague|histoire)|donne[- ]?moi (la )?recette|quelle (est l.?)?(heure|meteo|météo)|quel jour (on est|sommes)|es[- ]?tu (un|une|réel|reel|vrai|humain|robot|ia|intelligence artificielle|chatgpt|gpt|bot|machine)|t.?es (un|une) (robot|ia|bot|chatgpt|gpt)|\bchat ?gpt\b|\bgpt\b|\bllm\b|fais (mes|un) devoir|aide[- ]?moi (a|à|pour) (mes|le) devoir|resume[- ]?moi ce|résume[- ]?moi ce/i;

const INTEREST_SIGNAL =
  /int[eé]ress|curieux|en savoir plus|dites-moi|comment|combien|prix|rdv|rendez-vous|appel|disponible|oui|ok|d'accord|formation|inscription|acheter|commander|lien|payer|commander/i;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ");
}

export function detectDissatisfaction(text: string): boolean {
  return DISSATISFACTION_PATTERNS.test(normalizeText(text));
}

export function detectEscalationRequest(text: string): boolean {
  return ESCALATION_PATTERNS.test(normalizeText(text));
}

export function detectNotInterested(text: string): boolean {
  return NOT_INTERESTED_PATTERNS.test(normalizeText(text));
}

export function detectSkepticism(text: string): boolean {
  const t = normalizeText(text);
  return SKEPTICISM_SOFT_PATTERNS.test(t) || SKEPTICISM_HOSTILE_PATTERNS.test(t);
}

function detectHostileSkepticism(text: string): boolean {
  return SKEPTICISM_HOSTILE_PATTERNS.test(normalizeText(text));
}

/** Message hors-sujet / usage détourné du bot. */
export function detectOffTopic(text: string): boolean {
  return OFF_TOPIC_PATTERNS.test(text.normalize("NFD").replace(/\p{M}/gu, ""));
}

export function detectUnknownQuestion(
  text: string,
  business: { offer?: string | null; price?: string | null; ownerName?: string | null },
  campaignConfig?: AutomationConfig
): boolean {
  const t = text.toLowerCase();

  if (PRICE_QUESTION.test(t)) {
    const hasPrice = Boolean(business.price?.trim() || campaignConfig?.price?.trim());
    if (!hasPrice) return true;
  }

  if (DELIVERY_QUESTION.test(t)) {
    const goal = campaignConfig?.closingGoal;
    const guide = campaignConfig?.conversationGuide ?? "";
    if (goal !== "delivery" && !/livraison|adresse|expedition/i.test(guide)) {
      return true;
    }
  }

  if (PRODUCT_QUESTION.test(t) && !business.offer?.trim() && !campaignConfig?.productName?.trim()) {
    return true;
  }

  return false;
}

function countNotInterestedInbound(history: Array<{ direction: string; body: string }>): number {
  return history.filter((m) => m.direction === "entrant" && detectNotInterested(m.body)).length;
}

function countHostileInbound(history: Array<{ direction: string; body: string }>): number {
  return history.filter((m) => m.direction === "entrant" && detectHostileSkepticism(m.body)).length;
}

function hasInterestSignal(text: string): boolean {
  return INTEREST_SIGNAL.test(normalizeText(text));
}

/** Une question du prospect = engagement → jamais un motif d'arrêt. */
function looksLikeQuestion(text: string): boolean {
  const t = normalizeText(text);
  return (
    text.includes("?") ||
    /\b(comment|combien|quand|ou|pourquoi|quel|quelle|est-ce|c est quoi|qu est|vous faites|tu fais|ca marche|ca coute|possible|disponib)\b/.test(
      t
    )
  );
}

/**
 * Échange qui tourne vraiment en rond — très conservateur.
 * On ne coupe JAMAIS un prospect qui pose des questions ou montre de l'intérêt.
 */
export function detectConversationStall(
  history: Array<{ direction: string; body: string }>,
  currentText: string
): boolean {
  const outbound = history.filter((m) => m.direction === "sortant").length;
  const inbound = history.filter((m) => m.direction === "entrant");
  if (outbound < 6 || inbound.length < 5) return false;

  const recent = [...inbound.slice(-4), { direction: "entrant", body: currentText }];
  if (recent.some((m) => looksLikeQuestion(m.body) || hasInterestSignal(m.body))) return false;

  const hostile =
    countHostileInbound(history) + (detectHostileSkepticism(currentText) ? 1 : 0);
  return hostile >= 3;
}

/**
 * Décide si la conversation doit être ARRÊTÉE définitivement.
 * Règle d'or : après le 1er message de campagne, on CONTINUE sauf refus clair /
 * hostilité répétée / hors-sujet évident. Le scepticisme d'identité se gère en réponse.
 */
export function shouldStopConversation(
  text: string,
  business: { offer?: string | null; price?: string | null; ownerName?: string | null },
  campaignConfig?: AutomationConfig,
  history?: Array<{ direction: string; body: string }>
): StopReason | null {
  // Question ou signal d'intérêt → toujours poursuivre (même si wording ambigu).
  if (looksLikeQuestion(text) || hasInterestSignal(text)) {
    // Sauf hors-sujet flagrant (poème, code…) qui n'est pas une vraie question métier
    if (!detectOffTopic(text)) return null;
  }

  if (detectOffTopic(text)) return "off_topic";

  if (detectNotInterested(text)) {
    const prior = history ? countNotInterestedInbound(history) : 0;
    // Premier refus net : on coupe. (Le message courant compte ; prior = messages passés.)
    // Si le « refus » est soft et qu'ils ont déjà montré de l'intérêt avant, exige 2 refus.
    const hadInterestBefore =
      history?.some((m) => m.direction === "entrant" && hasInterestSignal(m.body)) ?? false;
    if (hadInterestBefore && prior < 1) return null;
    return "not_interested";
  }

  if (campaignConfig?.stopOnDissatisfaction !== false && detectDissatisfaction(text)) {
    return "dissatisfaction";
  }

  if (detectEscalationRequest(text)) return "escalation";

  // Scepticisme soft (« c'est toi ? », « je ne te connais pas ») → JAMAIS d'arrêt :
  // l'IA doit répondre et poursuivre. Hostilité répétée uniquement.
  if (history?.length) {
    if (detectHostileSkepticism(text)) {
      const priorHostile = countHostileInbound(history);
      if (priorHostile >= 1) return "skepticism";
    }
    if (detectConversationStall(history, text)) {
      return "conversation_stall";
    }
  }

  if (
    campaignConfig?.stopOnUnknownQuestion === true &&
    detectUnknownQuestion(text, business, campaignConfig)
  ) {
    return "unknown_question";
  }

  return null;
}

export function stopReasonLabel(reason: StopReason): string {
  switch (reason) {
    case "dissatisfaction":
      return "mécontentement du prospect";
    case "unknown_question":
      return "question sans réponse disponible";
    case "escalation":
      return "demande de contact humain";
    case "not_interested":
      return "prospect non intéressé";
    case "skepticism":
      return "prospect hostile / agressif";
    case "conversation_stall":
      return "échange sans progression (pas d'intérêt)";
    case "off_topic":
      return "message hors-sujet / usage détourné";
  }
}

export function getStopFarewellReply(reason: StopReason): string {
  switch (reason) {
    case "not_interested":
    case "skepticism":
    case "conversation_stall":
      return "Compris, je ne vous dérange plus. Bonne continuation ! 🙂";
    case "dissatisfaction":
      return "Désolé pour le dérangement. Je m'arrête là. Bonne journée.";
    case "escalation":
      return "Je comprends, je transmets à mon responsable. Merci.";
    case "unknown_question":
      return "Je n'ai pas l'info sous la main pour répondre précisément. Mon responsable reviendra vers vous. Merci !";
    case "off_topic":
      return "Je réponds uniquement au sujet de mon message initial. Bonne journée ! 🙂";
  }
}
