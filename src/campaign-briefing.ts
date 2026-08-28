/**
 * Garde-fous briefing campagne + détection simulation.
 * Complète les consignes de persona.ts (questions progressives, RDV, etc.).
 */
import type { AgentMessage } from "./db.js";
import { parseMemoryHints, type CampaignMemory } from "./campaign-memory.js";
import {
  applyPersistedBriefingState,
  type ThreadBriefingState,
} from "./thread-briefing-state.js";
import { buildSupportBriefingNudge, extractSupportThirdParty } from "./support-flow.js";
import {
  buildGroupsBriefingNudge,
  extractGroupNamesFromHistory,
  extractGroupPostMessage,
} from "./groups-flow.js";

const CAMPAIGN_INTENT_RE =
  /\b(prospect|prospection|prospecter|campagne|closer|closing|support\s*client|g[eè]re[rz]?\s*(mon\s+)?support|g[eè]re[rz]?\s+tout|tous\s+(mes\s+)?messages|compte\s+whatsapp|automatis(er|ation)\s+(mes\s+)?(r[eé]ponses|ventes)|keyword_sales|group_prospect|contact_prospect)\b/i;

/** L'utilisateur veut que l'IA gère tout le compte WhatsApp (tous les DM). */
const INBOUND_CATCH_ALL_RE =
  /\b(tous\s+(mes\s+)?messages|g[eè]re[rz]?\s+tout(\s+(mon\s+)?(compte|whatsapp|les\s+messages))?|compte\s+(whatsapp\s+)?entier|toute\s+la\s+bo[iî]te|toutes?\s+les?\s+(conversations|demandes|discussions)|r[eé]pond(?:re)?\s+[aà]\s+(tout|tous)|sans\s+(mot[- ]?cl[eé]|d[eé]clencheur)|pas\s+de\s+(mot[- ]?cl[eé]|d[eé]clencheur)|inbound_catch_all)\b/i;

export function wantsInboundCatchAll(history: AgentMessage[], userMessage: string): boolean {
  const users = [
    ...history.filter((m) => m.role === "user").map((m) => m.content),
    userMessage,
  ];
  for (let i = users.length - 1; i >= 0; i--) {
    const t = users[i] ?? "";
    if (
      /\b(juste|seulement|uniquement)\s+(ceux|celles|si)|ceux\s+qui\s+(disent|diront)|phrase[s]?\s+d[eé]clench/i.test(
        t
      )
    ) {
      return false;
    }
    if (INBOUND_CATCH_ALL_RE.test(t)) return true;
  }
  return false;
}

const SIMULATION_ACCEPT_RE =
  /\b(simulation|simule[rz]?|simuler|fais\s+(une\s+)?simu|on\s+simule|montre\s+(moi\s+)?(un\s+)?(aper[cç]u|exemple|fil))\b/i;

const SIMULATION_YES_RE =
  /^(oui|ouais|ok|okay|d'accord|dac|vas[- ]y|go|avec\s+plaisir|carr[eé]ment|volontiers|nickel|parfait)(\s|[!.]|$)/i;

const SIMULATION_DECLINE_RE =
  /^(non|nan|no|nop|passe|skip)([!.\s]|$)|pas\s+(besoin|envie|maintenant)|plus\s+tard|sans\s+(simu|simulation)|pas\s+(de\s+)?(simu|simulation)|ne\s+(veux|veut|veux)\s+pas.*(simu|tester|aper[cç]u)/i;

export function isCampaignIntent(text: string): boolean {
  return CAMPAIGN_INTENT_RE.test(text);
}

/** L'utilisateur accepte / demande une simulation. */
export function wantsCampaignSimulation(userMessage: string, history: AgentMessage[]): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (declinesCampaignSimulation(t, history)) return false;
  if (SIMULATION_ACCEPT_RE.test(t)) return true;
  if (/\b(aper[cç]u|exemple\s+de\s+(fil|conversation)|montre[- ]moi)\b/i.test(t)) return true;

  // « oui » juste après que l'agent a proposé une simulation
  if (!SIMULATION_YES_RE.test(t)) return false;
  for (let i = history.length - 1; i >= 0 && i >= history.length - 6; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    if (
      /simulation|simuler|aper[cç]u|fil de (discussion|conversation)|veux-tu (tester )?une?\s*\*?\*?simulation|simulation dans ce chat|simulation courte/i.test(
        m.content
      )
    ) {
      return true;
    }
    break;
  }
  return false;
}

/** L'utilisateur refuse la simulation proposée. */
export function declinesCampaignSimulation(
  userMessage: string,
  history: AgentMessage[]
): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (!SIMULATION_DECLINE_RE.test(t)) return false;
  // « non » générique : seulement juste après une offre de simulation
  if (/^(non|nan|no|nop)([!.\s]|$)/i.test(t) && !/\b(simu|simulation|aper[cç]u|tester)\b/i.test(t)) {
    for (let i = history.length - 1; i >= 0 && i >= history.length - 6; i--) {
      const m = history[i];
      if (m?.role !== "assistant") continue;
      if (
        /veux-tu (tester )?une?\s*\*?\*?simulation|tester une \*\*simulation\*\*|simulation sur le t[ée]l[ée]phone|avant le lancement/i.test(
          m.content
        )
      ) {
        return true;
      }
      break;
    }
    return false;
  }
  return true;
}

export type BriefingAssessment = {
  inCampaignFlow: boolean;
  questionsAsked: number;
  missing: string[];
  readyForDraft: boolean;
  /** Closing entrant / support : pas d'opener sortant → pas de 5 variantes. */
  isInboundClosing: boolean;
  /** Fil purpose=groupes : publish / group_broadcast — pas d'opener ni support. */
  isGroupsFlow: boolean;
  /** Support : gérer tous les messages privés (pas seulement des phrases déclencheurs). */
  inboundCatchAll: boolean;
  /** L'utilisateur a indiqué l'angle / le ton souhaité pour le 1er message (après question dédiée). */
  openerDirectionCollected: boolean;
  /** Une seule accroche a été proposée (avant les 5 variantes). */
  openerSingleProposed: boolean;
  /** L'utilisateur a validé (ou fourni) cette accroche unique. */
  openerSingleValidated: boolean;
  /** Les 5 variantes ont été proposées dans le chat. */
  openerVariantsProposed: boolean;
  /** L'agent a posé la question stickers (messages assistant uniquement). */
  stickersQuestionAsked: boolean;
  /** L'agent a posé la question notification tiers (messages assistant uniquement). */
  thirdPartyQuestionAsked: boolean;
  /** L'agent a posé la question mots-clés handoff humain. */
  handoffKeywordsQuestionAsked: boolean;
  /**
   * Closing entrant : pacing vagues géré en arrière-plan (défauts système).
   * Toujours true — on ne pose plus la question à l'utilisateur.
   */
  inboundPacingAsked: boolean;
};

const OPENER_DIRECTION_ASK_RE =
  /\b(premier\s+message|premi[eè]re\s+(approche|accroche|phrase|ouverture|variante)|comment\s+(tu\s+veux|veux[- ]?tu)\s+(aborder|commencer|ouvrir)|abord(?:er|e)\s+(ces\s+)?prospects|quelle\s+approche|quel\s+angle|premier\s+contact|naturel\s+comme\s+premi[eè]re|premi[eè]re\s+fois\s+que\s+tu\s+[ée]cris|ton\s+(direct|formel|d[eé]contract[eé]?|myst[eè]re)|accroche|hook)\b/i;

const OPENER_VARIANTS_PROPOSED_RE =
  /\b((voici\s+)?(les\s+)?5\s+(pistes|variantes?|accroches|variations|options|propositions)|cinq\s+(pistes|variantes?|accroches|variations|options)|variantes?\s+(d['']accroche|propos[eé]es?)|voici\s+(mes\s+)?(pistes|variantes|accroches|variations))\b/i;

const OPENER_VARIANT_CHOICE_RE =
  /^\s*(?:(?:je\s+)?(?:prends?|choisis|valide|garde|pr[eé]f[eè]re)\s+(?:la\s+)?(?:variante\s+|option\s+|n[°o]?\s*)?)?([1-5])(?:\s*[-–).:]|\s*$)/i;

/** L'utilisateur délègue la rédaction de l'accroche à l'agent. */
const OPENER_DELEGATION_RE =
  /^\s*(propose([- ]?moi)?|propose\s+(des\s+)?(accroches?|variantes?|messages?)|comme\s+tu\s+veux|\u00e0\s+toi|fais\s+(toi[- ]?m[eê]me|comme\s+tu\s+veux|simple)|invente([- ]?moi)?|surprise|au\s+choix|libre\s+[aà]\s+toi)\s*[.!]?\s*$/i;

/** L'agent présente UNE accroche (pas encore la liste 1–5). */
const OPENER_SINGLE_PROPOSED_RE =
  /\b(voici\s+(mon\s+|une\s+|l['’])?(accroche|proposition|premier\s+message)|je\s+(te\s+)?propose\s+(cette|une)\s+(accroche|ouverture|approche|phrase)|proposition\s+d['’]accroche|une\s+(seule\s+)?accroche|accroche\s+(propos[eé]e|retenue)|premier\s+message\s+propos[eé])\b/i;

/** Validation courte de l'accroche / des 5 variantes (oui / ok / je valide…). */
const OPENER_SINGLE_VALIDATE_RE =
  /^\s*(oui|ouais|ok|okay|d['’]accord|dac|parfait|nickel|top|valide|valid[eé]|je\s+valide|c['’]est\s+bon|c\s+bon|vas[- ]?y|garde|j['’]aime|ça\s+me\s+va|ca\s+me\s+va|bonne|impeccable|go)\b/i;

/** Validation courte type « oui / ok / je valide » (accroches ou ensemble). */
export function isShortCampaignValidation(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 100) return false;
  if (/^(non|nan|no|nop|refuse|pas\s+d['’]?accord)\b/i.test(t)) return false;
  if (OPENER_SINGLE_VALIDATE_RE.test(t)) return true;
  // « Je valide » seul / « Oui, je valide » / « Ok je valide tout »
  if (/^(je\s+)?valide\b/i.test(t)) return true;
  return /\b(oui|ok|okay|d['’]accord|parfait|nickel)\b/i.test(t) &&
    /\b(valide|valid[eé]|bon|ensemble|tout|les\s+5|accroches?)\b/i.test(t);
}

function isSubstantiveUserReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (/^(oui|non|ok|ouais|non merci|peu importe|d'accord|vas[- ]y|nickel|parfait)$/i.test(t)) return false;
  return true;
}

/** Long texte type accroche WhatsApp (pas une liste de numéros / commande courte). */
export function looksLikeOpenerDraft(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  if (OPENER_VARIANT_CHOICE_RE.test(t)) return false;
  if (/^(oui|non|ok|ouais|maintenant|plus\s+tard|d'accord|vas[- ]y)([!.\s]|$)/i.test(t)) return false;
  const phones = t.match(/\+?\d[\d\s.-]{7,}\d/g) || [];
  if (phones.length >= 3) return false;
  return /[.!?…]|[a-zàâäéèêëïîôùûüç]{12,}/i.test(t);
}

/** Marqueur de liste (1. / 1) / 1\. / **1.** / A. / Variante 1 :). */
const OPENER_LIST_MARK = String.raw`(?:\*\*|__)?\s*(?:\\)?[.)：:\-]\s*`;
const OPENER_LABEL_MARK =
  String.raw`(?:variante|option|accroche)\s*(?:n[°o]?\s*)?`;

function countOpenerListMarks(content: string): number {
  let numbered = 0;
  for (let n = 1; n <= 5; n++) {
    if (
      new RegExp(
        `(?:^|\\n)\\s*(?:\\*\\*|__)?(?:${OPENER_LABEL_MARK})?${n}${OPENER_LIST_MARK}\\S`,
        "im"
      ).test(content)
    ) {
      numbered++;
    }
  }
  if (numbered >= 4) return numbered;
  let lettered = 0;
  for (const letter of ["A", "B", "C", "D", "E"]) {
    if (
      new RegExp(
        `(?:^|\\n)\\s*(?:\\*\\*|__)?(?:${OPENER_LABEL_MARK})?${letter}${OPENER_LIST_MARK}\\S`,
        "im"
      ).test(content)
    ) {
      lettered++;
    }
  }
  return Math.max(numbered, lettered);
}

/** Liste 1–5 ou A–E dans un message assistant (≥4 items). */
export function hasNumberedOpenerList(content: string): boolean {
  return countOpenerListMarks(content) >= 4;
}

function cleanExtractedOpener(raw: string | undefined): string | null {
  let text = raw
    ?.replace(/^["«“"'\s]+|["»”"'\s]+$/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 8) return null;
  // Liste de membres (nom + téléphone) ≠ accroches
  if (/(?:\+|00)\d[\d\s.\-]{7,}\d/.test(text) || /\b\d{10,15}\b/.test(text)) {
    return null;
  }
  return text.slice(0, 1200);
}

function extractOpenerItemsFromText(
  content: string
): Array<{ id: string; message: string }> {
  const fromNumbers: Array<{ id: string; message: string }> = [];
  for (let n = 1; n <= 5; n++) {
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:\\*\\*|__)?(?:${OPENER_LABEL_MARK})?${n}${OPENER_LIST_MARK}([\\s\\S]*?)(?=(?:\\n\\s*(?:\\*\\*|__)?(?:${OPENER_LABEL_MARK})?[1-5A-E]${OPENER_LIST_MARK})|\\n\\n|$)`,
      "im"
    );
    const text = cleanExtractedOpener(content.match(re)?.[1]);
    if (!text) continue;
    fromNumbers.push({ id: `v${n}`, message: text });
  }
  if (fromNumbers.length >= 4) return fromNumbers.slice(0, 5);

  const fromLetters: Array<{ id: string; message: string }> = [];
  for (const letter of ["A", "B", "C", "D", "E"] as const) {
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:\\*\\*|__)?(?:${OPENER_LABEL_MARK})?${letter}${OPENER_LIST_MARK}([\\s\\S]*?)(?=(?:\\n\\s*(?:\\*\\*|__)?(?:${OPENER_LABEL_MARK})?[A-E]${OPENER_LIST_MARK})|\\n\\n|$)`,
      "im"
    );
    const text = cleanExtractedOpener(content.match(re)?.[1]);
    if (!text) continue;
    fromLetters.push({
      id: `v${fromLetters.length + 1}`,
      message: text,
    });
  }
  if (fromLetters.length >= 4) return fromLetters.slice(0, 5);

  const bulletLines = content
    .split(/\n/)
    .map((l) => l.replace(/^[\s•\-–*]+/, "").trim())
    .filter((l) => l.length >= 8);
  if (bulletLines.length >= 4) {
    return bulletLines.slice(0, 5).map((message, i) => ({
      id: `v${i + 1}`,
      message: message.slice(0, 1200),
    }));
  }

  return fromLetters.slice(0, 5);
}

function padOpenerVariants(
  variants: Array<{ id: string; message: string }>
): Array<{ id: string; message: string }> | null {
  if (variants.length < 4) return null;
  while (variants.length < 5) {
    const last = variants[variants.length - 1]!;
    variants.push({
      id: `v${variants.length + 1}`,
      message: last.message,
    });
  }
  return variants.slice(0, 5);
}

/** Extrait les 5 textes d'accroche depuis le dernier message assistant qui les liste. */
export function extractOpenerVariantsFromHistory(
  history: AgentMessage[]
): Array<{ id: string; message: string }> | null {
  for (let i = history.length - 1; i >= 0 && i >= history.length - 24; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    if (!hasNumberedOpenerList(m.content) && !OPENER_VARIANTS_PROPOSED_RE.test(m.content)) {
      continue;
    }
    const padded = padOpenerVariants(extractOpenerItemsFromText(m.content));
    if (padded) return padded;
  }
  return null;
}

export function isOpenerDelegation(text: string): boolean {
  return OPENER_DELEGATION_RE.test(text.trim());
}

function lastAssistantMatchIndex(history: AgentMessage[], re: RegExp): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role === "assistant" && re.test(m.content)) return i;
  }
  return -1;
}

/** L'agent a posé la question sur le 1er message souhaité (obligatoire avant variantes). */
export function hasAgentAskedOpenerDirection(history: AgentMessage[]): boolean {
  return lastAssistantMatchIndex(history, OPENER_DIRECTION_ASK_RE) >= 0;
}

/** L'utilisateur a choisi une variante 1–5 (message courant ou récent après les variantes). */
export function hasUserChosenOpenerVariant(
  history: AgentMessage[],
  userMessage: string
): boolean {
  if (OPENER_VARIANT_CHOICE_RE.test(userMessage.trim())) return true;
  const recent = history.slice(-12);
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m?.role === "user" && OPENER_VARIANT_CHOICE_RE.test(m.content.trim())) return true;
  }
  return false;
}

/** L'utilisateur a répondu avec un angle / une idée (après question, ou volontairement). */
export function hasUserProvidedOpenerDirection(
  history: AgentMessage[],
  userMessage: string
): boolean {
  // Variantes déjà proposées ou choix 1–5 → l'angle est acquis
  if (hasProposedOpenerVariants(history)) return true;
  if (hasUserChosenOpenerVariant(history, userMessage)) return true;

  // Délégation explicite (« propose », « comme tu veux »…)
  if (isOpenerDelegation(userMessage)) return true;
  for (const m of history.slice(-16)) {
    if (m.role === "user" && isOpenerDelegation(m.content)) return true;
  }

  // Opener collé volontairement (sans attendre la question magique)
  if (looksLikeOpenerDraft(userMessage)) return true;
  for (const m of history.slice(-16)) {
    if (m.role === "user" && looksLikeOpenerDraft(m.content)) return true;
  }

  const askIdx = lastAssistantMatchIndex(history, OPENER_DIRECTION_ASK_RE);
  if (askIdx < 0) return false;

  for (let i = askIdx + 1; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "user" && isSubstantiveUserReply(m.content)) return true;
  }

  const usersAfterAsk = history.slice(askIdx + 1).filter((m) => m.role === "user").length;
  if (usersAfterAsk === 0 && isSubstantiveUserReply(userMessage)) return true;

  return false;
}

/** Les 5 variantes ont déjà été listées dans le fil. */
export function hasProposedOpenerVariants(history: AgentMessage[]): boolean {
  // « puis les 5 variantes » dans la question d'angle ≠ proposition réelle.
  return history
    .slice(-24)
    .some((m) => m.role === "assistant" && hasNumberedOpenerList(m.content));
}

function lastSingleOpenerAssistantIndex(history: AgentMessage[]): number {
  // Fenêtre courte : un vieux message du brief / simu ne doit pas compter comme accroche.
  const start = Math.max(0, history.length - 16);
  for (let i = history.length - 1; i >= start; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    if (hasNumberedOpenerList(m.content) || OPENER_VARIANTS_PROPOSED_RE.test(m.content)) {
      continue;
    }
    // Annonce explicite seulement (« Voici l'accroche… ») — pas une simple citation « … ».
    if (OPENER_SINGLE_PROPOSED_RE.test(m.content)) return i;
  }
  return -1;
}

/** Une accroche unique a déjà été proposée (ou les 5 variantes rendent cette étape moot). */
export function hasProposedSingleOpener(history: AgentMessage[]): boolean {
  if (hasProposedOpenerVariants(history)) return true;
  return lastSingleOpenerAssistantIndex(history) >= 0;
}

/**
 * Accroche unique validée : oui/ok après proposition, OU brouillon collé par l'utilisateur
 * (sa phrase = l'accroche), OU les 5 variantes déjà là.
 */
export function hasUserValidatedSingleOpener(
  history: AgentMessage[],
  userMessage: string
): boolean {
  if (hasProposedOpenerVariants(history)) return true;

  const isValidate = (t: string) =>
    OPENER_SINGLE_VALIDATE_RE.test(t.trim()) || looksLikeOpenerDraft(t);

  const singleIdx = lastSingleOpenerAssistantIndex(history);
  if (singleIdx >= 0) {
    if (isValidate(userMessage)) return true;
    for (let i = singleIdx + 1; i < history.length; i++) {
      const m = history[i];
      if (m?.role === "user" && isValidate(m.content)) return true;
    }
    return false;
  }

  // Pas encore de proposition agent : un long brouillon user = accroche fournie/validée.
  if (looksLikeOpenerDraft(userMessage)) return true;
  for (const m of history.slice(-16)) {
    if (m.role === "user" && looksLikeOpenerDraft(m.content)) return true;
  }
  return false;
}

/**
 * Stickers / tiers : ne regarder QUE les messages assistant.
 * Sinon un brief e-commerce (« mon livreur… WhatsApp ») matchait à tort
 * et sautait la question notification tiers.
 */
const STICKERS_ASK_RE =
  /\bstickers?\b.{0,120}\?(?:.|$)|veux.{0,40}\bstickers?\b|ajoute.{0,40}\bstickers?\b/i;

const THIRD_PARTY_ASK_RE =
  /\b(pr[eé]venir|notifier|pr[eé]vienne|notifie).{0,80}\b(tiers|quelqu.?un d.?autre|livreur|associ[eé]|commercial)\b|\b(tiers|livreur|associ[eé]|commercial).{0,80}\b(pr[eé]venir|notifier|automatiquement)\b|\bthird.party\b/i;

/** Question mots-clés → passer la main à l'humain (assistant uniquement). */
const HANDOFF_KEYWORDS_ASK_RE =
  /\b(passer\s+la\s+main|intervenir?\s+(en\s+)?humain|handoff|mots?\s*cl[eé]s?.{0,60}(stop|arr[eê]t|humain|passer)|arr[eê]ter?.{0,40}(conversation|r[eé]pondre).{0,40}humain|humain.{0,40}(mots?\s*cl[eé]|phrases?))\b/i;

/** Question pacing vagues / plage — assistant uniquement (closing entrant). */
const INBOUND_PACING_ASK_RE =
  /\b(vagues?|lots?)\b.{0,80}\b(50|r[eé]ponses?|entrants?)\b|\banti[- ]?blocage\b.{0,60}\bwhats?app\b|\bd[eé]lai.{0,40}(entre|vague|lot)\b|\bplage.{0,30}(envoi|horaire)\b.{0,40}\d{1,2}\s*h/i;

export function hasStickersQuestionAsked(history: AgentMessage[]): boolean {
  return history.some((m) => m.role === "assistant" && STICKERS_ASK_RE.test(m.content));
}

export function hasThirdPartyQuestionAsked(history: AgentMessage[]): boolean {
  return history.some((m) => m.role === "assistant" && THIRD_PARTY_ASK_RE.test(m.content));
}

export function hasHandoffKeywordsQuestionAsked(history: AgentMessage[]): boolean {
  return history.some((m) => m.role === "assistant" && HANDOFF_KEYWORDS_ASK_RE.test(m.content));
}

export function hasInboundPacingQuestionAsked(history: AgentMessage[]): boolean {
  return history.some((m) => m.role === "assistant" && INBOUND_PACING_ASK_RE.test(m.content));
}

/** Closing entrant / keyword_sales / support — le prospect écrit en premier. */
export function isInboundClosingFlow(
  history: AgentMessage[],
  userMessage: string,
  purpose?: "prospection" | "support" | "groupes" | null
): boolean {
  if (purpose === "support") return true;
  if (purpose === "prospection" || purpose === "groupes") return false;
  const blob = conversationBlob(history, userMessage);
  return /\b(keyword_sales|inbound_closing|closing\s+entrant|support\s*client|d[eé]clencheur|mot[- ]?cl[eé]|quand\s+(quelqu|un\s+prospect|un\s+client)\s+[eé]crit|r[eé]pond(?:re|s)?\s+(uniquement\s+)?quand)\b/i.test(
    blob
  );
}

function conversationBlob(history: AgentMessage[], userMessage: string): string {
  const recent = history.slice(-24);
  return [...recent.map((m) => m.content), userMessage].join("\n");
}

/** Uniquement ce que l'utilisateur a dit — jamais les questions inventées par l'assistant. */
function userConversationBlob(history: AgentMessage[], userMessage: string): string {
  return [
    ...history.filter((m) => m.role === "user").map((m) => m.content),
    userMessage,
  ].join("\n");
}

function userAnsweredAfterAsk(
  history: AgentMessage[],
  userMessage: string,
  askRe: RegExp
): boolean {
  const askIdx = lastAssistantMatchIndex(history, askRe);
  if (askIdx < 0) {
    return isSubstantiveUserReply(userMessage) && askRe.test(userMessage);
  }
  for (let i = askIdx + 1; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "user" && isSubstantiveUserReply(m.content)) return true;
  }
  return isSubstantiveUserReply(userMessage);
}

function countBriefingQuestions(
  history: AgentMessage[],
  purpose?: "prospection" | "support" | "groupes" | null
): number {
  let campaignStart = -1;
  if (purpose === "prospection" || purpose === "support" || purpose === "groupes") {
    campaignStart = 0;
  } else {
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "user" && isCampaignIntent(m.content)) {
      campaignStart = i;
      break;
      }
    }
  }
  if (campaignStart < 0) {
    // Intent dans le message courant seulement → 0 question encore
    return 0;
  }
  let n = 0;
  for (let i = campaignStart; i < history.length; i++) {
    const m = history[i];
    if (m?.role === "assistant" && m.content.includes("?")) n++;
  }
  return n;
}

/**
 * Estime ce qui manque encore pour un brief exploitable
 * (tous produits / services / support).
 * @param purpose — intention du fil (prospection | support) ; null = heuristique chat.
 * @param memory — mémoire active : saute identité / stickers / fenêtre si renseignés.
 */
export function assessCampaignBriefing(
  history: AgentMessage[],
  userMessage: string,
  purpose?: "prospection" | "support" | "groupes" | null,
  memory?: CampaignMemory | null,
  persisted?: ThreadBriefingState | null,
): BriefingAssessment {
  const purposeForced =
    purpose === "prospection" || purpose === "support" || purpose === "groupes";
  const inFlow =
    purposeForced ||
    isCampaignIntent(userMessage) ||
    history.slice(-16).some((m) => m.role === "user" && isCampaignIntent(m.content)) ||
    history.slice(-10).some(
      (m) =>
        m.role === "assistant" &&
        /offre|approche|relance|d[eé]clencheur|simulation|campagne|prix|cible/i.test(m.content) &&
        m.content.includes("?")
    );

  if (!inFlow) {
    return {
      inCampaignFlow: false,
      questionsAsked: 0,
      missing: [],
      readyForDraft: false,
      isInboundClosing: false,
      isGroupsFlow: false,
      inboundCatchAll: false,
      openerDirectionCollected: false,
      openerSingleProposed: false,
      openerSingleValidated: false,
      openerVariantsProposed: false,
      stickersQuestionAsked: false,
      thirdPartyQuestionAsked: false,
      handoffKeywordsQuestionAsked: false,
      inboundPacingAsked: true,
    };
  }

  const questionsAsked = countBriefingQuestions(history, purpose);

  // Fil Groupes : module isolé (pas d'opener / stickers / handoff prospection).
  if (purpose === "groupes") {
    const post = extractGroupPostMessage(history);
    const groups = extractGroupNamesFromHistory(history);
    const missing: string[] = [];
    if (!post) missing.push("message à publier");
    if (!groups.length) missing.push("groupe(s) admin");
    return {
      inCampaignFlow: true,
      questionsAsked,
      missing,
      readyForDraft: Boolean(post && groups.length),
      isInboundClosing: false,
      isGroupsFlow: true,
      inboundCatchAll: false,
      openerDirectionCollected: true,
      openerSingleProposed: true,
      openerSingleValidated: true,
      openerVariantsProposed: true,
      stickersQuestionAsked: true,
      thirdPartyQuestionAsked: true,
      handoffKeywordsQuestionAsked: true,
      inboundPacingAsked: true,
    };
  }

  const userBlob = userConversationBlob(history, userMessage);

  const missing: string[] = [];
  const inbound = isInboundClosingFlow(history, userMessage, purpose);
  const catchAll = inbound && wantsInboundCatchAll(history, userMessage);
  const memText = (memory?.instructions ?? "").trim();
  const memHints = memory ? parseMemoryHints(memText || memory.instructions || "") : null;
  const memoryCoversIdentity =
    Boolean(memory?.ownerName?.trim()) || Boolean(memHints?.coversIdentity);
  const memoryCoversWindow =
    Boolean(memHints?.coversWindow) ||
    (memory != null &&
      Number.isFinite(memory.sendWindowStart) &&
      Number.isFinite(memory.sendWindowEnd));
  const memoryCoversOffer = Boolean(memHints?.coversOffer);
  const memoryCoversPrice = Boolean(memHints?.coversPrice);
  const memoryCoversGoal = Boolean(memHints?.coversGoal);
  const memoryCoversLink = Boolean(memHints?.coversLink);
  const memoryCoversTarget = Boolean(memHints?.coversTarget);

  const hasOffer =
    memoryCoversOffer ||
    (/\b(offre|produit|service|formation|coaching|je\s+(vends|propose|offre)|automatisation|saas|agence|cr[eè]me|baskets?)\b/i.test(
      userBlob
    ) &&
      userBlob.length > 20);
  if (!hasOffer) missing.push("offre / produit ou service précis");

  const hasTarget =
    memoryCoversTarget ||
    /\b(cible|prospect|audience|client[e]?s?|groupe|membres|contact|qui\s+(je|on)\s+|s'adresse|qui\s+[eé]crit|d[eé]clencheur|tous\s+(mes\s+)?messages|compte|ceux\s+qui)\b/i.test(
      userBlob
    );
  if (!inbound && !hasTarget) {
    missing.push("cible (qui contacter / qui écrit)");
  }

  if (inbound && !catchAll) {
    const hasTrigger =
      /d[eé]clencheur|mot[- ]?cl[eé]|phrase\s+exacte|ceux\s+qui\s+(disent|diront)|«[^»]{3,}»|"[^"]{3,}"/i.test(
        userBlob
      );
    if (!hasTrigger) missing.push("phrase(s) déclencheur exacte(s) — ou confirmer « tous les messages »");
  }

  const wantsRdv =
    /\b(rendez[- ]?vous|rdv|booking|r[eé]serv|calendly|cal\.com|prise\s+de\s+rdv)\b/i.test(userBlob);
  const wantsDelivery =
    /\b(livraison|adresse\s+de\s+livraison|paiement\s+[àa]\s+la\s+livraison|pointure)\b/i.test(
      userBlob
    );
  const wantsPay =
    /\b(paiement|payer|wave|orange\s*money|moov|lien\s+de\s+paiement|checkout)\b/i.test(userBlob) &&
    !wantsDelivery;
  const wantsLink = /\b(envoyer\s+un\s+lien|lien\s+vers|url)\b/i.test(userBlob) || wantsPay;

  const hasHttpLink = memoryCoversLink || /https?:\/\/\S+/i.test(userBlob);
  if (wantsRdv && !hasHttpLink) {
    missing.push("lien de réservation RDV (URL réelle Calendly / Google / autre)");
  } else if (wantsLink && !hasHttpLink && !wantsRdv && !wantsDelivery) {
    missing.push("URL concrète à envoyer au prospect");
  }

  const hasPrice =
    memoryCoversPrice || /\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)|\bprix\b.{0,40}\d/i.test(userBlob);
  const isSale =
    (/\b(vendre|vente|acheter|prix|tarif|fcfa|commander|paiement)\b/i.test(userBlob) ||
      memoryCoversPrice) &&
    !wantsRdv;
  if (isSale && !hasPrice) missing.push("prix exact (chiffre en FCFA)");

  const hasGoal =
    memoryCoversGoal ||
    wantsDelivery ||
    /\b(objectif|rdv|rendez[- ]?vous|vente|paiement|livraison|inscription|d[eé]mo|closing|support)\b/i.test(
      userBlob
    );
  if (!hasGoal) missing.push("objectif final concret (RDV, vente, lien, livraison…)");

  if (!inbound) {
    const hasLaunch =
      /\b(\d{1,2}\s*h|\d{1,2}:\d{2}|matin|soir|apr[eè]s-midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|aujourd.?hui|maintenant|imm[eé]diat|lancer\s+(à|a|maintenant)|d[eé]marr|lance\s+maintenant)\b/i.test(
        userBlob
      );
    if (memoryCoversWindow) {
      if (!hasLaunch) {
        missing.push("jour/heure de lancement de la campagne");
      }
    } else {
      const hasSchedule =
        hasLaunch || /\b(cr[eé]neau|horaire|fen[eê]tre)\b/i.test(userBlob);
      if (!hasSchedule) {
        missing.push("horaires d'envoi (fenêtre) et jour/heure de lancement de la campagne");
      }
    }
  }

  if (!memoryCoversIdentity) {
    const IDENTITY_ASK_RE =
      /\bcomment.{0,80}pr[eé]sent|\bqui [eê]tes[- ]vous\b|\bpr[eé]nom\b|\bowner_name\b|\bbusiness_owner\b/i;
    const hasIdentity =
      /\b(je m.?appelle|je suis|pr[eé]sente[- ]moi|appelle[- ]moi)\b/i.test(userBlob) ||
      userAnsweredAfterAsk(history, userMessage, IDENTITY_ASK_RE);
    if (!hasIdentity) {
      missing.push(
        inbound
          ? "présentation face aux clients (prénom/nom + formule si on demande « qui êtes-vous ? »)"
          : "présentation face aux prospects (prénom/nom + formule si on demande « qui êtes-vous ? »)"
      );
    }
  }

  // Prêt = les slots requis sont remplis (mémoire ou réponses user). Plus de quota « 6 questions ».
  const criticalMissing = missing.filter(
    (m) =>
      m.includes("lien de réservation") ||
      m.includes("URL") ||
      m.includes("prix") ||
      m.includes("déclencheur") ||
      m.includes("offre") ||
      m.includes("objectif") ||
      m.includes("cible") ||
      m.includes("horaires") ||
      m.includes("lancement") ||
      m.includes("présentation")
  );
  const readyForDraft = applyPersistedBriefingState(criticalMissing, persisted).length === 0;
  const stickersQuestionAsked =
    Boolean(persisted?.stickersAnswered) ||
    /\b(stickers?|autocollants?)\s*:\s*(oui|non)/i.test(memText) ||
    hasStickersQuestionAsked(history);
  const thirdPartyQuestionAsked = hasThirdPartyQuestionAsked(history);
  const handoffKeywordsQuestionAsked = hasHandoffKeywordsQuestionAsked(history);
  const openerVariantsProposed = inbound ? true : hasProposedOpenerVariants(history);
  const openerSingleValidated = inbound
    ? true
    : openerVariantsProposed || hasUserValidatedSingleOpener(history, userMessage);
  const openerSingleProposed = inbound
    ? true
    : openerVariantsProposed ||
      hasProposedSingleOpener(history) ||
      // Brouillon collé par l'user = déjà « proposé » (c'est le sien)
      openerSingleValidated;
  const openerDirectionCollected = inbound
    ? true
    : openerVariantsProposed ||
      openerSingleProposed ||
      hasUserProvidedOpenerDirection(history, userMessage);
  const inboundPacingAsked = true;

  return {
    inCampaignFlow: true,
    questionsAsked,
    missing: applyPersistedBriefingState(missing, persisted),
    readyForDraft,
    isInboundClosing: inbound,
    isGroupsFlow: false,
    inboundCatchAll: catchAll,
    openerDirectionCollected,
    openerSingleProposed,
    openerSingleValidated,
    openerVariantsProposed,
    stickersQuestionAsked,
    thirdPartyQuestionAsked,
    handoffKeywordsQuestionAsked,
    inboundPacingAsked,
  };
}

const NEW_CAMPAIGN_IN_THREAD_RE =
  /\b(nouvelle|autre|deuxi[eè]me|2e|second|encore\s+une|une\s+autre|relance\s+une\s+autre)\s+(campagne|automatisation|prospection|s[eé]quence)\b/i;

/** Bloque une 2e campagne dans un fil qui en a déjà une. */
export function buildThreadCampaignBlockNudge(
  automationId: number | null,
  userMessage: string
): string | null {
  if (!automationId) return null;
  if (!isCampaignIntent(userMessage) && !NEW_CAMPAIGN_IN_THREAD_RE.test(userMessage)) return null;
  if (NEW_CAMPAIGN_IN_THREAD_RE.test(userMessage)) {
    return (
      `## BLOCAGE TECHNIQUE — fil occupé\n` +
      `Ce fil gère déjà l'automatisation #${automationId}. INTERDIT d'appeler create_automation sans automation_id.\n` +
      `Explique à l'utilisateur qu'il doit cliquer « Nouvelle automatisation » dans la barre latérale pour créer une autre campagne.\n` +
      `Pour modifier la campagne actuelle → update_automation_config ou create_automation avec automation_id=${automationId}.`
    );
  }
  return null;
}

/** Exige une mémoire liée au fil avant toute conversation produit / campagne. */
export function buildMissingMemoryNudge(
  hasLinkedMemory: boolean,
  _userMessage: string,
  _history: AgentMessage[],
  _purpose?: "prospection" | "support" | "groupes" | null
): string | null {
  if (hasLinkedMemory) return null;
  return (
    `## BLOCAGE — mémoire non connectée à ce fil\n` +
    `Aucune mémoire n'est liée à CETTE automatisation. INTERDIT d'appeler create_automation / update_automation_config / activer une campagne.\n` +
    `INTERDIT de continuer le briefing produit comme si c'était OK.\n` +
    `Dis clairement à l'utilisateur (une phrase + instruction) : clique sur le bouton **Mémoire** en haut du chat pour choisir ou créer une mémoire, puis reconnecte-toi ici.\n` +
    `Ne renvoie PAS vers « Réglages → Mémoire » comme étape principale — le bouton du chat est le bon chemin.\n` +
    `Une seule question / consigne : brancher la mémoire. Puis attends.`
  );
}

export function buildBriefingNudge(
  assessment: BriefingAssessment,
  history: AgentMessage[],
  userMessage: string
): string | null {
  if (!assessment.inCampaignFlow) return null;

  // Support = module isolé (jamais le chemin opener / 5 variantes).
  if (assessment.isInboundClosing) {
    return buildSupportBriefingNudge(assessment, history, userMessage);
  }

  // Groupes = publish / group_broadcast (jamais opener prospection).
  if (assessment.isGroupsFlow) {
    return buildGroupsBriefingNudge(assessment, history, userMessage);
  }

  if (assessment.readyForDraft) {
    if (!assessment.stickersQuestionAsked) {
      return (
        "Briefing campagne : éléments essentiels réunis (≥6 questions). " +
        "Pose UNE question — « Tu veux que j'ajoute des stickers dans les conversations avec les prospects ? (oui/non) » — puis ARRÊTE-TOI. " +
        "INTERDIT : résumer + proposer des variantes / brouillon dans le même message."
      );
    }

    if (!assessment.openerDirectionCollected && !hasAgentAskedOpenerDirection(history)) {
      return (
        "Briefing campagne : avant toute accroche, pose UNE question sur le **premier message** souhaité — " +
        "ex. « Comment tu veux aborder le premier contact ? (ton direct, question ouverte, mystère, formel…) — donne-moi une idée ou une phrase type. » " +
        "Puis ARRÊTE-TOI et attends sa réponse. " +
        "**INTERDIT ABSOLU** : lister 5 variantes, proposer des accroches en rafale, ou mélanger récap + accroches dans ce message. " +
        "INTERDIT aussi de poser notif tiers / handoff (remboursement, plainte…) — ça concerne le **support**, pas la prospection."
      );
    }

    if (!assessment.openerDirectionCollected) {
      return (
        "Tu as demandé le premier message — **ATTENDS** la réponse de l'utilisateur (angle, ton, exemple). " +
        "INTERDIT : proposer une accroche, des variantes, create_automation, ou simulation tant qu'il n'a pas donné son idée."
      );
    }

    // Étape 1 : UNE seule accroche (pas encore les 5)
    if (!assessment.openerSingleProposed) {
      const delegated =
        isOpenerDelegation(userMessage) ||
        history.slice(-8).some((m) => m.role === "user" && isOpenerDelegation(m.content));
      return (
        (delegated
          ? "L'utilisateur t'a délégué l'accroche (« propose » / « comme tu veux »). "
          : "L'utilisateur a indiqué son angle pour le 1er message. ") +
        "Propose maintenant **UNE seule accroche** A.I.D.A. Attention (format recommandé : 1-2 phrases, ton d'adressage de la mémoire, SANS prix/lien/pitch)" +
        (delegated
          ? " — inventée à partir de la **mémoire / offre**"
          : ", alignée sur **SA** direction") +
        ". S'il colle un texte avec prix/lien/pitch → préviens des risques, ne bloque pas. " +
        "**INTERDIT** de lister 5 variantes dans ce message. Attends sa validation / correction."
      );
    }

    if (!assessment.openerSingleValidated) {
      return (
        "Tu as proposé **une** accroche — **ATTENDS** la validation de l'utilisateur (oui / ok / valide, ou une version corrigée). " +
        "S'il refuse ou ajuste → reformule **UNE** nouvelle accroche, puis re-attends. " +
        "INTERDIT : 5 variantes, create_automation, simulation tant qu'il n'a pas validé cette accroche."
      );
    }

    // Étape 2 : après validation → montrer les 5 variantes SEULEMENT (pas encore brouillon/sim)
    if (!assessment.openerVariantsProposed) {
      return (
        "L'accroche unique est **validée**. Propose maintenant **exactement 5 variantes** dérivées de cette accroche " +
        "(liste numérotée 1–5, même intention, formulations distinctes — Attention seulement, SANS prix/lien/pitch). " +
        "Explique en une phrase que le **premier message réel** sera **l'une de ces 5** (rotation). " +
        "Demande un OK sur l'ensemble (« oui » / « c'est bon »). " +
        "**INTERDIT** dans ce message : create_automation, simulation, téléphone, activer. " +
        "Attends la validation des 5 avant toute suite."
      );
    }

    // Étape 3 : 5 validées → brouillon + simulation téléphone (puis validation sim → lancement)
    return (
      "Les 5 variantes ont été proposées et l'utilisateur les valide. " +
      "ORDRE STRICT : (1) create_automation draft avec initial_message = accroche validée (ou v1) " +
      "ET ab_variants = les **5 textes complets** (jamais un seul). personalize_messages=false. " +
      "(2) Immédiatement après : show_campaign_simulation (6-7 tours) pour le **téléphone à droite** " +
      "(fence ```klanvio-sim obligatoire). " +
      "(3) Demande validation de la sim — INTERDIT d'activer tant qu'il n'a pas validé la simulation. " +
      "Utilise tool_calls natif — INTERDIT DSML / invoke dans le texte. " +
      "(handoff_keywords=[] ; third_party_notification_enabled=false en prospection)."
    );
  }

  const next = assessment.missing[0] ?? "un détail concret encore flou";
  if (next.includes("offre")) {
    return (
      `Briefing campagne : l'offre n'est pas dans la mémoire ni dans le fil. ` +
      `Pose UNE question OUVERTE (« Qu'est-ce que tu proposes concrètement ? »). ` +
      `N'affirme JAMAIS l'offre du profil business — elle peut être obsolète.`
    );
  }
  if (next.includes("présentation")) {
    return (
      `Briefing campagne : identité absente de la mémoire. ` +
      `Pose UNE seule question : comment tu dois te présenter si un prospect demande « qui êtes-vous ? » ` +
      `(prénom/nom + formule courte). Enregistre via save_business_profile. INTERDIT d'inventer un nom.`
    );
  }
  return (
    `## Briefing campagne — checklist (ne pas inventer d'autres questions)\n` +
    `Éléments encore manquants : ${
      assessment.missing.length ? assessment.missing.join(" ; ") : "à creuser"
    }.\n` +
    `Prochaine étape : pose **UNIQUEMENT** la question sur « ${next} », puis ARRÊTE-TOI.\n` +
    `INTERDIT : questions créatives hors checklist (pointure, lien de paiement, secteur…), ` +
    `create_automation, activate_automation, show_campaign_simulation.\n` +
    `Ce qui est déjà dans la MÉMOIRE ne se redemande pas.`
  );
}

const LAUNCH_ANSWER_RE =
  /^(maintenant|tout\s+de\s+suite|imm[eé]diatement|demain|aujourd['’]hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\s*h)/i;

/**
 * Aparté / modif — MiniMax peut répondre.
 * Vague 4 : les guillemets ne disqualifient plus l'aparté (un envoi « … » est
 * classé en action parallèle en amont). Reprise du slot = tour suivant, pas
 * re-colle forcée ici (voir turn-kind.ts + agent.ts).
 */
export function isBriefingSideTalk(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (isShortCampaignValidation(t)) return false;
  if (LAUNCH_ANSWER_RE.test(t)) return false;
  if (/^(oui|ouais|non|nan|ok|okay|d['’]accord|dac|valide|je\s+valide)\b/i.test(t)) {
    return false;
  }
  if (/^[\d+\s.\-()]{8,}$/.test(t)) return false;
  if (/\b(cr[eé]e(?:r)?\s+le\s+brouillon|je\s+valide|simule|active|lance)\b/i.test(t)) {
    return false;
  }
  // Liste numérotée d'accroches = réponse rail, pas digression
  if (/(?:^|\n)\s*1\s*[.)]\s*\S/.test(t) && /(?:^|\n)\s*2\s*[.)]\s*\S/.test(t)) {
    return false;
  }
  // Accroche collée seule (message = une citation) = réponse rail, même avec « ? » dedans
  if (/^[«"'][\s\S]{8,}[»"']\s*$/u.test(t)) return false;
  if (/\?/.test(t)) return true;
  if (
    /\b(pourquoi|c['’]est\s+quoi|c['’]est\s+combien|ça\s+veut\s+dire|ca\s+veut\s+dire|comment\s+[çc]a\s+marche|comment\s+ça\s+fonctionne|explique|j['’]ai\s+une\s+question|une\s+question|attends|enl[eè]ve|modifie|change\s+(le|la|l['’])|d['’]abord|avant\s+de|autre\s+chose|hors\s+sujet|je\s+comprends\s+pas|j['’]ai\s+pas\s+compris)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

export const BRIEFING_Q_SCOPE =
  "Tu veux des **phrases déclencheurs** exactes (ex. « je suis intéressé »), ou que je gère **tous les messages privés** du compte ?";
export const BRIEFING_Q_THIRD_PARTY =
  "Quand un client convertit, tu veux qu'on prévienne automatiquement un tiers (livreur, associé, commercial) sur WhatsApp ? (oui/non)";
export const BRIEFING_Q_THIRD_PHONE =
  "À quel **numéro WhatsApp** prévenir ce tiers (ex. +229…) et quel rôle (livreur, associé…) ?";
export const BRIEFING_Q_HANDOFF =
  "Y a-t-il des mots ou phrases pour lesquels je dois arrêter et te passer la main (ex. remboursement, plainte) ? Liste-les ou dis **non**.";
export const BRIEFING_Q_LAUNCH =
  "Tu veux que je lance la prospection à quel moment exactement ? (maintenant, demain matin, lundi 9h…)";
export const BRIEFING_Q_OPENER =
  "Comment tu veux aborder le premier contact ? (ton direct, question ouverte, mystère, formel…) — donne-moi une idée ou une phrase type.";
export const BRIEFING_Q_SUPPORT_VALIDATE =
  "J'ai tout pour le Support. Dis **« je valide »** pour créer le brouillon — la simulation s'affiche ensuite sur le téléphone.";

/**
 * Prochaine question uniforme (neuro-symbolique). Null = laisser MiniMax (opener / aparté / prêt).
 */
export function nextCanonicalBriefingQuestion(
  assessment: BriefingAssessment,
  history: AgentMessage[],
  userMessage: string
): string | null {
  if (!assessment.inCampaignFlow) return null;
  if (assessment.isGroupsFlow) return null;

  if (assessment.isInboundClosing) {
    const next = assessment.missing[0];
    if (next?.includes("déclencheur") || next?.includes("tous les messages")) {
      return BRIEFING_Q_SCOPE;
    }
    if (next?.includes("offre")) {
      return "Quel produit / service dois-je défendre dans les réponses clients ?";
    }
    if (next?.includes("présentation")) {
      return "Comment te présenter si un client demande « qui êtes-vous ? » (prénom + formule courte).";
    }
    if (next?.includes("objectif")) {
      return "Quel objectif quand le client est prêt (livraison / paiement / RDV / lien) ?";
    }
    if (next?.includes("prix")) {
      return "Quel est le prix exact (chiffre + FCFA) ?";
    }
    if (next?.includes("URL") || next?.includes("lien de réservation")) {
      return "Colle le **lien** à envoyer (URL complète Calendly / paiement / page).";
    }
    if (!assessment.readyForDraft) {
      return `Il me manque encore : ${next ?? "un détail concret"}.`;
    }
    if (!assessment.stickersQuestionAsked) {
      return "Tu veux des stickers dans les réponses aux clients ? (oui/non)";
    }
    if (!assessment.thirdPartyQuestionAsked) {
      return BRIEFING_Q_THIRD_PARTY;
    }
    const tp = extractSupportThirdParty(history, userMessage);
    if (tp.asked && !tp.declined && tp.accepted && !tp.phone) {
      return BRIEFING_Q_THIRD_PHONE;
    }
    if (!assessment.handoffKeywordsQuestionAsked) {
      return BRIEFING_Q_HANDOFF;
    }
    if (/\b(je\s+valide|cr[eé]e(?:r)?\s+le\s+brouillon)\b/i.test(userMessage)) {
      return null;
    }
    return BRIEFING_Q_SUPPORT_VALIDATE;
  }

  const next = assessment.missing[0];
  if (next?.includes("offre")) return "Qu'est-ce que tu proposes concrètement (produit / service) ?";
  if (next?.includes("cible")) {
    return "Qui veux-tu contacter concrètement ? (numéro, liste de contacts, ou nom exact du groupe WhatsApp)";
  }
  if (next?.includes("objectif")) {
    return "Quel est l'objectif final de cette campagne (RDV, vente, lien, simple échange…) ?";
  }
  if (next?.includes("prix")) return "Quel est le prix exact (chiffre + FCFA) ?";
  if (next?.includes("lien de réservation") || next?.includes("URL")) {
    return "Colle le **lien** à envoyer aux prospects (URL complète).";
  }
  if (next?.includes("horaires") || next?.includes("lancement")) return BRIEFING_Q_LAUNCH;
  if (next?.includes("présentation")) {
    return "Comment te présenter si un prospect demande « qui êtes-vous ? » (prénom/nom + formule courte).";
  }
  if (!assessment.readyForDraft && next) {
    return `Il me manque encore : ${next}.`;
  }

  if (!assessment.readyForDraft) return null;

  if (!assessment.stickersQuestionAsked) {
    return "Tu veux que j'ajoute des stickers dans les conversations avec les prospects ? (oui/non)";
  }
  if (!assessment.openerDirectionCollected && !hasAgentAskedOpenerDirection(history)) {
    return BRIEFING_Q_OPENER;
  }
  if (!assessment.openerDirectionCollected) return null;
  if (!assessment.openerSingleProposed) return null;
  if (!assessment.openerSingleValidated) return null;
  if (!assessment.openerVariantsProposed) return null;
  return null;
}

/** Texte qui évoque un RDV sans lien HTTP. */
export function needsAppointmentLink(config: {
  closingGoal?: string | null;
  conversationGuide?: string | null;
  initialMessage?: string | null;
  closingLink?: string | null;
  productName?: string | null;
}): boolean {
  if (config.closingLink?.trim()) return false;
  if (config.closingGoal === "appointment") return true;
  const blob = [config.conversationGuide, config.initialMessage, config.productName]
    .filter(Boolean)
    .join(" ");
  return /\b(rendez[- ]?vous|rdv|booking|r[eé]serv|calendly|cal\.com)\b/i.test(blob);
}
