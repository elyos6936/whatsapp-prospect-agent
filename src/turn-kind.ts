/**
 * Vague 4.2 — pause-first (style Cursor).
 * Hard-return du slot SEULEMENT si le message avance clairement le rail.
 * Sinon digression / parallèle + scénario en pause (réponse intelligente).
 * 100 % déterministe / générique (aucun nom, numéro ou ID en dur).
 */
import type { AgentMessage } from "./db.js";
import {
  isBriefingSideTalk,
  isShortCampaignValidation,
} from "./campaign-briefing.js";
import {
  detectQuickGroupMembersIntent,
  isExplicitGroupOperation,
} from "./group-list-intent.js";
import {
  allowsManualSend,
  isExplicitSendNow,
  isFuzzySendAsk,
  isSendConfirmReply,
  recentAssistantAskedConversationCheck,
  resolveConversationCheckFromHistory,
} from "./high-stakes-intent.js";

export type BriefingTurnKind = "advance_rail" | "digression" | "parallel_action";

export type ParallelActionType = "one_shot_send" | "group_extract";

export type BriefingTurnClassification = {
  kind: BriefingTurnKind;
  /** true = ne pas forcer / re-coller la question de slot dans CE tour */
  pauseScenario: boolean;
  parallelAction: ParallelActionType | null;
};

/** Verbe d'extraction — évite « Les membres du groupe X » (réponse rail). */
const GROUP_EXTRACT_ACTION_RE =
  /\b(extrait|extraits|extraire|extraction|extract|liste|lister|donne(?:[- ]?moi)?|donner|montre|afficher|r[eé]cup[eè]re(?:r)?)\b/i;

/** Verbes d'action groupe (hors simple mention « membres du groupe »). */
const GROUP_ACTION_VERB_RE =
  /\b(extrait|extraire|liste|lister|envoie|envoyer|poste|publie|programme|ajoute|retire|cr[eé]e[rz]?|cr[eé]er|quitte|quitter|invite|rejoins|rejoindre|lien)\b/i;

/** Verbe OU nom d'envoi (ex. menu « Envoi d'un message direct… »). */
const SEND_VERB_RE =
  /\b(envoie[rz]?|envois|envoies|envoi|envoyer|écris|ecris|écrire|ecrire|transmets|transmettre|message\s+à|message\s+direct)\b/i;

const SEND_RECIPIENT_RE =
  /\+\d{8,15}\b|\b(?:à|a|au|pour)\s+\+?\d{8,15}\b|\b(?:à|a)\s+(?:lui|elle|leur)\b/i;

const SEND_CONTENT_RE =
  /[«"'][^»"']{1,500}[»"']|:\s*\S{2,}|[-–—]\s*\S{2,}|\bmessage\s*:\s*\S{2,}|\bmessage\s+direct\b[^+]{0,40}\b(?:à|a)\s+\S{2,}/i;

const LAUNCH_ANSWER_RE =
  /^(maintenant|tout\s+de\s+suite|imm[eé]diatement|demain|aujourd['’]hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\s*h)/i;

const EXPLICIT_RESUME_RE =
  /^(continue|continues|on\s+continue|reprends?|on\s+reprend|reprenons|vas[- ]?y|go)\b/i;

/**
 * Tokens courts qui AVANCENT le rail (whitelist).
 * Tout le reste → LLM (pause-first). Pas de liste de digressions à maintenir.
 */
const RAIL_SHORT_TOKEN_RE =
  /^(oui|ouais|ouai|yes|yep|non|nan|no|nop|ok|okay|dac|d['’]?accord|valide|parfait|nickel|top|bonne?|imp[eé]ccable|exact|exactement|carr[eé]|impec)$/i;

/**
 * Envoi one-shot autonome : verbe + destinataire + contenu (ou Vague 1 explicite).
 */
export function isParallelOneShotSend(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || t.length > 500) return false;
  if (!SEND_VERB_RE.test(t)) return false;
  if (SEND_RECIPIENT_RE.test(t)) {
    if (SEND_CONTENT_RE.test(t)) return true;
    if (/\bmessage\s+direct\b/i.test(t)) return true;
  }
  return isExplicitSendNow(t);
}

/**
 * Extraction contacts/membres : verbe d'extraction + intent membres.
 */
export function isParallelGroupExtract(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || t.length > 240) return false;
  if (!GROUP_EXTRACT_ACTION_RE.test(t)) return false;
  return detectQuickGroupMembersIntent(t) != null;
}

/**
 * Opération groupe explicite avec verbe d'action (pas audience rail).
 */
function isParallelGroupOp(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || t.length > 240) return false;
  if (!GROUP_ACTION_VERB_RE.test(t)) return false;
  return isExplicitGroupOperation(t);
}

function isPhoneOnly(msg: string): boolean {
  return /^[\d+\s.\-()]{8,}$/.test(msg.trim());
}

/** Dernier assistant a demandé un numéro / cible / tiers (GAP-013). */
export function recentAssistantAskedForPhoneOrTarget(history: AgentMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === "assistant");
  if (!last?.content) return false;
  return /num[eé]ro|t[eé]l[eé]phone|\+229|quel\s+\*{0,2}num|tiers|livreur|cible|contacter|prospects?\s+[àa]\s+contacter/i.test(
    last.content,
  );
}

function isNumberedOpenerList(msg: string): boolean {
  return /(?:^|\n)\s*1\s*[.)]\s*\S/.test(msg) && /(?:^|\n)\s*2\s*[.)]\s*\S/.test(msg);
}

function isQuotedOpenerOnly(msg: string): boolean {
  return /^[«"'][\s\S]{8,}[»"']\s*$/u.test(msg.trim());
}

function isSoftGreeting(msg: string): boolean {
  return /^(salut|hello|bonjour|bonsoir|hey|coucou|hi)\s*[!.]?$/i.test(msg.trim());
}

/**
 * Digression locale — délégué à isBriefingSideTalk (? / apartés déjà connus).
 * Le gros du pause-first est dans looksLikeRailAdvance (défaut = pas rail).
 */
export function isLocalDigression(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (looksLikeSlotConfirmation(t)) return false;
  if (isShortCampaignValidation(t)) return false;
  if (LAUNCH_ANSWER_RE.test(t)) return false;
  if (EXPLICIT_RESUME_RE.test(t)) return false;
  if (isSoftGreeting(t)) return false;
  if (RAIL_SHORT_TOKEN_RE.test(t)) return false;
  return isBriefingSideTalk(t);
}

function looksLikeSlotConfirmation(msg: string): boolean {
  return (
    /\b(fcfa|xof|€|\d[\d\s.,]{2,}\s*(?:fcfa|xof|€|francs?))\b/i.test(msg) ||
    /\b(demain|aujourd['’]hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\s*h|\d{1,2}:\d{2})\b/i.test(msg)
  );
}

/**
 * Hard-return OK seulement si le message est une réponse checklist nette.
 * Sinon digression / parallèle → LLM décide (comme Cursor).
 */
export function looksLikeRailAdvance(userMessage: string, history: AgentMessage[] = []): boolean {
  const t = userMessage.trim();
  if (!t) return false;

  if (history.length && resolveConversationCheckFromHistory(userMessage, history)) {
    return false;
  }

  if (isParallelOneShotSend(t) || isParallelGroupExtract(t) || isParallelGroupOp(t)) {
    return false;
  }
  if (isLocalDigression(t)) return false;

  if (isShortCampaignValidation(t)) return true;
  if (LAUNCH_ANSWER_RE.test(t)) return true;
  if (EXPLICIT_RESUME_RE.test(t)) return true;
  if (isPhoneOnly(t)) return true;
  if (isNumberedOpenerList(t)) return true;
  if (isQuotedOpenerOnly(t)) return true;
  if (isSoftGreeting(t)) return true;
  if (RAIL_SHORT_TOKEN_RE.test(t)) return true;

  // Questions → digression sauf confirmation prix/heure
  if (/\?/.test(t)) return looksLikeSlotConfirmation(t);

  // Phrase libre / n'importe quoi → LLM (pas de liste de mots à maintenir)
  return false;
}

/**
 * Consigne système : répondre pleinement ; soft resume ; INTERDIT de re-colle forcée.
 */
export function buildScenarioPauseNudge(opts: {
  kind: Exclude<BriefingTurnKind, "advance_rail">;
  slotQuestion: string | null;
}): string {
  const resume =
    opts.slotQuestion != null
      ? `Quand l'utilisateur voudra reprendre le briefing, une seule phrase soft suffit ` +
        `(ex. « quand tu veux on reprend : ${opts.slotQuestion} »). ` +
        `INTERDIT de reposer cette question comme question principale / hard-return dans CE message.`
      : `Le scénario reprendra au prochain message utile. INTERDIT de forcer une question de checklist dans CE message.`;

  if (opts.kind === "parallel_action") {
    return (
      `## Scénario en pause — action parallèle\n` +
      `L'utilisateur demande une action autonome (envoi, extraction de contacts, op groupe, etc.), ` +
      `pas la prochaine étape du briefing. Exécute SA demande si les outils le permettent ` +
      `(Vague 1 : envoi seulement si intention explicite). Réponds clairement au résultat. ${resume}`
    );
  }
  return (
    `## Scénario en pause — digression\n` +
    `L'utilisateur pose une question / aparté / demande hors checklist. ` +
    `Réponds utilement et intelligemment en 1–8 phrases (comme un assistant compétent), ` +
    `sans coller la prochaine question de briefing. ${resume}`
  );
}

/**
 * Classifie le tour AVANT tout hard-return de slot.
 * Ordre pause-first : send-confirm (history) → parallèle → digression / !railAdvance → rail.
 */
export function classifyBriefingTurn(opts: {
  userMessage: string;
  history?: AgentMessage[];
  inCampaignFlow: boolean;
}): BriefingTurnClassification {
  const msg = opts.userMessage.trim();
  if (!opts.inCampaignFlow || !msg) {
    return { kind: "advance_rail", pauseScenario: false, parallelAction: null };
  }

  const hist = opts.history ?? [];

  // GAP-021 / GAP-011 : « oui » après « Je lui envoie … ? » → pause parallèle, pas hard-return briefing
  if (
    allowsManualSend(hist, msg) &&
    isSendConfirmReply(msg) &&
    !isExplicitSendNow(msg) &&
    !recentAssistantAskedConversationCheck(hist)
  ) {
    return {
      kind: "parallel_action",
      pauseScenario: true,
      parallelAction: "one_shot_send",
    };
  }

  // GAP-028 : « oui » après « vérifier sa conversation ? » → pas le slot lancement
  if (
    recentAssistantAskedConversationCheck(hist) &&
    isSendConfirmReply(msg) &&
    !isExplicitSendNow(msg)
  ) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  if (isParallelOneShotSend(msg)) {
    return {
      kind: "parallel_action",
      pauseScenario: true,
      parallelAction: "one_shot_send",
    };
  }

  if (isParallelGroupExtract(msg) || isParallelGroupOp(msg)) {
    return {
      kind: "parallel_action",
      pauseScenario: true,
      parallelAction: "group_extract",
    };
  }

  // Soft greeting mid-campagne : digression (ne vole pas le slot)
  if (isSoftGreeting(msg)) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  // GAP-022 : envoi flou → pause (nudge confirm), pas hard-return briefing
  if (isFuzzySendAsk(msg)) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  // GAP-013 : numéro seul n'avance le rail que si l'assistant vient de le demander
  if (isPhoneOnly(msg) && !recentAssistantAskedForPhoneOrTarget(hist)) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  if (isLocalDigression(msg) || !looksLikeRailAdvance(msg, hist)) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  return { kind: "advance_rail", pauseScenario: false, parallelAction: null };
}
