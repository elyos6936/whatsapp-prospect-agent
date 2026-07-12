import type { AutomationConfig } from "./db.js";

export type StopReason =
  | "dissatisfaction"
  | "unknown_question"
  | "escalation"
  | "not_interested"
  | "skepticism"
  | "conversation_stall";

const DISSATISFACTION_PATTERNS =
  /pas content|pas satisf|mecontent|insatisf|arnaque|escroc|hors de question|nul\b|mauvais service|inacceptable|scandale|vous abusez|laissez-moi tranquille|plus jamais|je me plains/i;

const ESCALATION_PATTERNS =
  /parler a un humain|parler a une personne|un responsable|votre patron|votre chef|appeler|telephone direct|numero direct|je veux parler/i;

const NOT_INTERESTED_PATTERNS =
  /pas interesse|pas int[eé]ress|non merci|ca m.?interesse pas|je ne suis pas interesse|pas pour moi|pas besoin|je n.?ai pas besoin|occupe|je suis occupe|fiche moi la paix|fichez-moi la paix|laisse moi|laissez-moi|ne m.?ecri(s|ve|vez) plus|plus de message|j.?ai pas demande|je n.?ai pas demande/i;

const SKEPTICISM_STOP_PATTERNS =
  /c.?est (toi|vous) qui (vient|venez|m.?a|m.?ont)|pourquoi tu m.?ecri|pourquoi vous m.?ecri|je (ne )?(te|vous) connais pas|spam|harcelement|harc[eè]lement|tu m.?enerve|vous m.?enerve|arrete(z)? (de m.?ecri|ca)|c.?est quoi ce truc|bon c.?est toi qui/i;

const PRICE_QUESTION = /combien|prix|tarif|co[uû]t|fcfa|franc|budget|payer combien/i;
const DELIVERY_QUESTION = /livraison|livrer|adresse|ou est|delai de livraison|frais de port/i;
const PRODUCT_QUESTION = /c'est quoi|qu'est.ce que|detail|composition|ingredient|garantie|retour/i;

const INTEREST_SIGNAL =
  /int[eé]ress|curieux|en savoir plus|dites-moi|comment|combien|prix|rdv|rendez-vous|appel|disponible|oui|ok|d'accord|formation|inscription|acheter|commander/i;

export function detectDissatisfaction(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return DISSATISFACTION_PATTERNS.test(t);
}

export function detectEscalationRequest(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return ESCALATION_PATTERNS.test(t);
}

export function detectNotInterested(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ");
  return NOT_INTERESTED_PATTERNS.test(t);
}

export function detectSkepticism(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ");
  return SKEPTICISM_STOP_PATTERNS.test(t);
}

/** Détecte une question dont la réponse n'est pas dans le contexte business/campagne. */
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

function countIdentityQuestions(history: Array<{ direction: string; body: string }>): number {
  return history.filter(
    (m) =>
      m.direction === "entrant" &&
      /qui (etes|êtes)-vous|c.?est qui|votre nom|ton nom|tu es qui|vous etes qui/i.test(m.body)
  ).length;
}

function countSkepticalInbound(history: Array<{ direction: string; body: string }>): number {
  return history.filter((m) => m.direction === "entrant" && detectSkepticism(m.body)).length;
}

function hasInterestSignal(text: string): boolean {
  return INTEREST_SIGNAL.test(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
  );
}

/**
 * Détecte un échange qui tourne en rond : plusieurs messages sortants,
 * prospect sceptique ou froid, aucun signal d'intérêt.
 */
export function detectConversationStall(
  history: Array<{ direction: string; body: string }>,
  currentText: string
): boolean {
  const outbound = history.filter((m) => m.direction === "sortant").length;
  const inbound = history.filter((m) => m.direction === "entrant");
  if (outbound < 2 || inbound.length < 2) return false;

  const recentInbound = [...inbound.slice(-3), { direction: "entrant", body: currentText }];
  const anyInterest = recentInbound.some((m) => hasInterestSignal(m.body));
  if (anyInterest) return false;

  const skepticalCount = countSkepticalInbound(history) + (detectSkepticism(currentText) ? 1 : 0);
  if (skepticalCount >= 2) return true;

  // 3+ réponses sortantes sans aucun signal d'intérêt du prospect.
  if (outbound >= 3 && !anyInterest) return true;

  return false;
}

export function shouldStopConversation(
  text: string,
  business: { offer?: string | null; price?: string | null; ownerName?: string | null },
  campaignConfig?: AutomationConfig,
  history?: Array<{ direction: string; body: string }>
): StopReason | null {
  if (detectNotInterested(text)) return "not_interested";

  if (campaignConfig?.stopOnDissatisfaction !== false && detectDissatisfaction(text)) {
    return "dissatisfaction";
  }

  if (detectEscalationRequest(text)) return "escalation";

  if (history?.length) {
    // Frustration après qu'on se soit déjà présenté (ex. « c'est toi qui m'écrit »).
    const hadIdentityQuestion = countIdentityQuestions(history) >= 1;
    const hadOutboundIntro = history.some((m) => m.direction === "sortant");
    if (hadIdentityQuestion && hadOutboundIntro && detectSkepticism(text)) {
      return "skepticism";
    }
    if (detectConversationStall(history, text)) {
      return "conversation_stall";
    }
  }

  if (campaignConfig?.stopOnUnknownQuestion !== false && detectUnknownQuestion(text, business, campaignConfig)) {
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
      return "prospect sceptique / méfiant";
    case "conversation_stall":
      return "échange sans progression (pas d'intérêt)";
  }
}

/** Message de clôture courte quand on arrête la prospection. */
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
  }
}
