import type { AutomationConfig } from "./db.js";

export type StopReason =
  | "dissatisfaction"
  | "unknown_question"
  | "escalation"
  | "not_interested"
  | "out_of_scope"
  | "skepticism"
  | "conversation_stall"
  | "off_topic";

const DISSATISFACTION_PATTERNS =
  /pas content|pas satisf|mecontent|insatisf|arnaque|escroc|hors de question|nul\b|mauvais service|inacceptable|scandale|vous abusez|laissez-moi tranquille|plus jamais|je me plains|tu me soules|vous me soules|tu me saoules|vous me saoules|casse[- ]?les[- ]?pieds|fais chier|fous[- ]?moi la paix|lache[- ]?moi|l[aâ]che[- ]?moi/i;

const ESCALATION_PATTERNS =
  /parler a un humain|parler a une personne|un responsable|votre patron|votre chef|appeler|telephone direct|numero direct|je veux parler (a|à|avec) (un |une )?(humain|personne|responsable)/i;

/**
 * Refus explicite (phrases longues).
 * Les « non » seuls sont gérés à part via le contexte (dernière question sortante).
 */
const NOT_INTERESTED_PATTERNS =
  /pas (du tout )?interesse|pas int[eé]ress[eée]?(\s|$|!|\.)|non merci|ca m.?interesse pas|cela m.?interesse pas|je (ne )?suis pas interesse|pas pour moi|pas besoin(\s|$)|je n.?ai pas besoin|fiche moi la paix|fichez-moi la paix|ne m.?ecri(s|ve|vez) plus|plus de message|j.?ai pas demande|je n.?ai pas demande|arrete(z)? (de )?(m.?ecri|me contacter)|stop (les? )?messages|non je (pense|crois) (que )?pas|je (ne )?(pense|crois) pas(\s|$|!|\.)|pas vraiment(\s|$|!|\.)|non pas vraiment|bof(\s|$|!|\.)|mouais/i;

/** « non » / « nan » seul (après une question / pitch — voir detectContextualRefusal). */
const BARE_NO_RE = /^\s*(non|nan|nn|nope)([!.…\s]*)$/i;

/** Dernier message sortant = question d'intérêt / poursuite / pitch oui-non. */
const OUTBOUND_YES_NO_OR_PITCH_RE =
  /\?|int[eé]ress|ouvert|on (en )?(parle|discute)|je (vous |te )?(explique|montre)|minutes?|secondes?|vous voyez|ca vous parle|partant|dispo|echange|échanger|gagner du temps|automatis|taches?|relances?|on continue|je peux/i;

/**
 * Clôture verbale déjà envoyée par l'agent (refus / au revoir).
 * Après ça, un « ok / okay / merci » doit rester silencieux.
 */
export const AGENT_FAREWELL_RE =
  /je (ne )?(vous |te )?(d[eé]range|contacte|ecri(s|rai)?|embete) plus|bonne (journ[eé]e|continuation|soir[eé]e)|n['’]?h[eé]sitez pas.{0,60}recontact|je (m['’]?arr[eê]te|reste disponible si besoin)|passez une excellente|compris.? je (ne )?(vous |te )?d[eé]range|d['’]accord.? je (note|ne vous)/i;

/** Ack court après un adieu — pas une relance d'intérêt. */
const SHORT_POST_FAREWELL_ACK_RE =
  /^\s*(ok|okay|oui|ouais|merci|d['’]accord|dac|parfait|bonne journ[eé]e|bonne continuation|ok merci|merci (beaucoup|bien))([!.…\s]*)$/i;

const SKEPTICISM_SOFT_PATTERNS =
  /c.?est (toi|vous) qui (vient|venez|m.?a|m.?ont)|pourquoi tu m.?ecri|pourquoi vous m.?ecri|je (ne )?(te|vous) connais pas|c.?est quoi ce truc|bon c.?est toi qui|qui (etes|êtes)-vous|tu es qui|vous etes qui/i;

const SKEPTICISM_HOSTILE_PATTERNS =
  /spam|harcelement|harc[eè]lement|tu m.?enerve|vous m.?enerve|tu me soules|vous me soules|arrete(z)? (de m.?ecri|ca)|fiche(z)?[- ]?moi la paix/i;

const PRICE_QUESTION = /combien|prix|tarif|co[uû]t|fcfa|franc|budget|payer combien/i;
const DELIVERY_QUESTION = /livraison|livrer|adresse|ou est|delai de livraison|frais de port/i;
const PRODUCT_QUESTION = /c'est quoi|qu'est.ce que|detail|composition|ingredient|garantie|retour/i;

const OFF_TOPIC_PATTERNS =
  /\b(ecris|écris|redige|rédige|compose|genere|génère)\b[^?.!]*\b(poeme|poème|poesie|poésie|chanson|dissertation|redaction|rédaction|code|script|programme|essai|texte|paragraphe|lettre de motivation|cv)\b|\btradui(s|re|sez)\b|\btraduction\b|qui est le president|qui est le président|capitale (de|du|des)|combien font|combien fait|resou(s|dre)|résou(s|dre)|calcule[- ]?moi|raconte[- ]?(moi )?une (blague|histoire)|donne[- ]?moi (la )?recette|quelle (est l.?)?(heure|meteo|météo)|quel jour (on est|sommes)|es[- ]?tu (un|une|réel|reel|vrai|humain|robot|ia|intelligence artificielle|chatgpt|gpt|bot|machine)|t.?es (un|une) (robot|ia|bot|chatgpt|gpt)|\bchat ?gpt\b|\bgpt\b|\bllm\b|fais (mes|un) devoir|aide[- ]?moi (a|à|pour) (mes|le) devoir|resume[- ]?moi ce|résume[- ]?moi ce/i;

/** Le prospect dit clairement ne pas être le bon profil (sans forcément dire « pas intéressé »). */
const OUT_OF_SCOPE_EXPLICIT =
  /pas (mon|notre) (domaine|metier|univers|secteur|rayon)|ca (ne )?me concerne pas|cela (ne )?me concerne pas|je (ne )?(suis|fais) pas (dans |de )?(ca|cela|ce domaine|ce metier)|hors (de )?(ma|mon) (cible|secteur)|je (ne )?suis pas (la|le|votre|ton) (cible|profil|genre)|c.?est pas (pour|mon) (moi|metier|domaine|univers)|je (ne )?fais pas (de |du )?(design|motion|contenu|crea|marketing|pub|ads|informatique|digital)/i;

/** Déclaration de métier manuel / hors digital — utile si la campagne est créa / formation digitale. */
const OUT_OF_SCOPE_TRADE_CLAIM =
  /\bje (suis|fais|travaille comme|travaille en|bosse comme|bosse en)\b.{0,40}\b(mecanicien|plombier|electricien|macon|chauffeur|taxi|cultivateur|agriculteur|eleveur|boucher|couturier|menuisier|soudeur|carreleur|peintre en batiment|ferronnier|technicien auto|garagiste|agent de securite|vigile|aide.?soignant|infirmier|sage.?femme|militaire|gendarme|policier)\b/i;

/** Campagne orientée digital / création / formation en ligne (blob config). */
const DIGITAL_CREATIVE_CAMPAIGN =
  /motion|design|canva|miniatur|youtube|contenu|infopreneur|formation|no.?code|n8n|make\.com|automatisation|facebook|media buying|m[eé]dia buying|ebook|e-book|cr[eé]a(tif|tion)|marketing digital|ads|publicit/i;

const INTEREST_SIGNAL =
  /int[eé]ress|curieux|en savoir plus|dites-moi|comment|combien|prix|rdv|rendez-vous|appel|disponible|oui|ok|d'accord|formation|inscription|acheter|commander|lien|payer|commander/i;

/** Intérêt réel (hors « ok » / « oui » seuls) — pour exiger un 2e refus. */
const STRONG_INTEREST_SIGNAL =
  /int[eé]ress|curieux|en savoir plus|combien|prix|rdv|rendez-vous|appel|inscription|acheter|commander|lien|payer|disponible pour|je veux|partant|volontiers/i;

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

/** Dernier sortant = question / pitch oui-non → un « non » seul = refus. */
export function detectContextualRefusal(
  text: string,
  history?: Array<{ direction: string; body: string }>
): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const t = normalizeText(raw);

  // Soft refus même sans question précédente
  if (
    /^(non[,\s]+)?(je )?(pense|crois) (que )?pas\b/.test(t) ||
    /^(pas vraiment|non pas vraiment|bof|mouais)\b/.test(t)
  ) {
    return true;
  }

  if (!BARE_NO_RE.test(raw) && !BARE_NO_RE.test(t)) return false;
  if (!history?.length) return false;

  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.direction !== "sortant") continue;
    return OUTBOUND_YES_NO_OR_PITCH_RE.test(normalizeText(m.body));
  }
  return false;
}

/** L'agent a déjà dit au revoir / clôturé le fil. */
export function detectAgentFarewell(body: string): boolean {
  return AGENT_FAREWELL_RE.test(normalizeText(body));
}

/**
 * Après un adieu agent, un ack court (« ok », « okay ») ne doit PAS relancer :
 * on arrête (silence côté runtime si adieu déjà envoyé).
 */
export function shouldSilenceAfterFarewell(
  text: string,
  history?: Array<{ direction: string; body: string }>
): boolean {
  if (!history?.length) return false;
  if (!SHORT_POST_FAREWELL_ACK_RE.test(text.trim())) return false;
  const recentOut = history.filter((m) => m.direction === "sortant").slice(-4);
  return recentOut.some((m) => detectAgentFarewell(m.body));
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

/**
 * Prospect clairement hors profil de la campagne (ex. « je suis mécanicien » sur une offre motion design).
 * Distinct du refus explicite et du hors-sujet (poème / code…).
 */
export function detectOutOfScope(
  text: string,
  campaignConfig?: AutomationConfig
): boolean {
  const t = normalizeText(text);
  if (!t || t.length < 4) return false;
  if (OUT_OF_SCOPE_EXPLICIT.test(t)) return true;

  const campaignBlob = normalizeText(
    [
      campaignConfig?.productName,
      campaignConfig?.conversationGuide,
      campaignConfig?.salesScript,
      campaignConfig?.initialMessage,
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (!campaignBlob || !DIGITAL_CREATIVE_CAMPAIGN.test(campaignBlob)) return false;
  return OUT_OF_SCOPE_TRADE_CLAIM.test(t);
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
 *
 * Ordre critique : refus / désintérêt AVANT le court-circuit « intérêt / question »,
 * sinon « je ne suis pas intéressé » matchait INTEREST_SIGNAL et ne s'arrêtait jamais.
 */
export function shouldStopConversation(
  text: string,
  business: { offer?: string | null; price?: string | null; ownerName?: string | null },
  campaignConfig?: AutomationConfig,
  history?: Array<{ direction: string; body: string }>
): StopReason | null {
  if (detectOffTopic(text)) return "off_topic";

  // Adieu déjà envoyé + ack court → coupe (évite relance après « Bonne journée »).
  if (shouldSilenceAfterFarewell(text, history)) {
    return "not_interested";
  }

  if (detectNotInterested(text) || detectContextualRefusal(text, history)) {
    const prior = history
      ? history.filter(
          (m) =>
            m.direction === "entrant" &&
            (detectNotInterested(m.body) || detectContextualRefusal(m.body, history))
        ).length
      : 0;
    // Si intérêt FORT antérieur (pas un simple « ok »), exige un 2e refus.
    const hadStrongInterestBefore =
      history?.some(
        (m) =>
          m.direction === "entrant" &&
          STRONG_INTEREST_SIGNAL.test(normalizeText(m.body)) &&
          !detectNotInterested(m.body) &&
          !detectContextualRefusal(m.body, history)
      ) ?? false;
    if (hadStrongInterestBefore && prior < 1) return null;
    return "not_interested";
  }

  // Hors profil ciblé (ex. métier incompatible) — même arrêt technique qu'un refus.
  if (detectOutOfScope(text, campaignConfig)) {
    return "out_of_scope";
  }

  // Question ou signal d'intérêt → poursuivre (sauf hors-sujet / refus déjà gérés).
  // IMPORTANT : ne pas traiter « ok » / « okay » seuls comme intérêt s'ils suivent un adieu
  // (déjà géré ci-dessus). Un ok isolé hors adieu reste de l'intérêt léger.
  if (looksLikeQuestion(text) || hasInterestSignal(text)) {
    return null;
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
      // Première hostilité nette (« tu me soules ») : coupe aussi (prod screenshots).
      if (/soule|saoule|fais chier|casse.?les.?pieds/i.test(normalizeText(text))) {
        return "skepticism";
      }
    }
    if (detectConversationStall(history, text)) {
      return "conversation_stall";
    }
  }

  // Opt-in uniquement (défaut false à la création). Même si activé, le runtime
  // ne coupe plus la conversation — voir notifications.ts (réponse IA / handoff).
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
    case "out_of_scope":
      return "prospect hors cible / hors profil";
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
    case "out_of_scope":
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

/** Confirmation courte après détection d'objectif atteint — plus de réponses ensuite sur ce fil campagne. */
export function getObjectiveReachedReply(): string {
  return "Parfait, merci ! C'est noté de mon côté. Bonne continuation 🙂";
}
