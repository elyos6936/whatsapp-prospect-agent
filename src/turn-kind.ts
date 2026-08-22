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
import { isExplicitSendNow } from "./high-stakes-intent.js";

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
  /\b(extrait|extraire|liste|lister|envoie|envoyer|poste|publie|programme|ajoute|retire|crée|creer|quitte|quitter|invite|rejoins|rejoindre|lien)\b/i;

const SEND_VERB_RE =
  /\b(envoie[rz]?|envois|envoies|envoyer|écris|ecris|écrire|ecrire|transmets|transmettre|message\s+à)\b/i;

const SEND_RECIPIENT_RE =
  /\+\d{8,15}\b|\b(?:à|a|au|pour)\s+\+?\d{8,15}\b|\b(?:à|a)\s+(?:lui|elle|leur)\b/i;

const SEND_CONTENT_RE =
  /[«"'][^»"']{1,500}[»"']|:\s*\S{2,}|[-–—]\s*\S{2,}|\bmessage\s*:\s*\S{2,}/i;

const LAUNCH_ANSWER_RE =
  /^(maintenant|tout\s+de\s+suite|imm[eé]diatement|demain|aujourd['’]hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\s*h)/i;

const EXPLICIT_RESUME_RE =
  /^(continue|continues|on\s+continue|reprends?|on\s+reprend|reprenons|vas[- ]?y|go)\b/i;

/** Digressions élargies (turn-kind only — ne touche pas campaign-briefing gates). */
const EXTRA_DIGRESSION_RE =
  /\b(merci|plus\s+tard|stats?|statistiques?|roi|chiffres?|rapport|pause|arr[eê]te|arr[eê]ter|stop|laisse\s+tomber|je\s+reviens|autre\s+chose|hors\s+sujet|aide[- ]?moi|comment\s+faire|c['’]est\s+combien|combien\s+(?:ça|ca)\s+co[uû]te)\b/i;

/**
 * Envoi one-shot autonome : verbe + destinataire + contenu (ou Vague 1 explicite).
 */
export function isParallelOneShotSend(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || t.length > 500) return false;
  if (!SEND_VERB_RE.test(t)) return false;
  if (SEND_RECIPIENT_RE.test(t) && SEND_CONTENT_RE.test(t)) return true;
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
 * Digression locale (élargie) — sans modifier campaign-briefing.ts.
 */
export function isLocalDigression(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (isBriefingSideTalk(t)) return true;
  if (isShortCampaignValidation(t)) return false;
  if (LAUNCH_ANSWER_RE.test(t)) return false;
  if (EXPLICIT_RESUME_RE.test(t)) return false;
  if (isSoftGreeting(t)) return false;
  if (EXTRA_DIGRESSION_RE.test(t)) return true;
  return false;
}

/**
 * Avance clairement le rail → hard-return OK.
 * Sinon on préfère digression / parallèle (pause-first).
 */
export function looksLikeRailAdvance(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;

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

  // Typos / monotoken de reprise (ex. « prospescts », « oui »)
  if (/^[a-zàâäéèêëïîôùûüç0-9]{2,20}$/i.test(t) && !EXTRA_DIGRESSION_RE.test(t)) {
    return true;
  }

  // Questions à l'agent → digression (les accroches 1–5 / guillemets sont déjà acceptées)
  if (/\?/.test(t)) return false;

  // Remplissage de slot libre : substantiel, pas action parallèle, pas digression
  if (
    t.length >= 12 &&
    !SEND_VERB_RE.test(t) &&
    !GROUP_EXTRACT_ACTION_RE.test(t) &&
    !GROUP_ACTION_VERB_RE.test(t) &&
    !EXTRA_DIGRESSION_RE.test(t)
  ) {
    return true;
  }

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
 * Ordre pause-first : parallèle → digression / !railAdvance → rail.
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

  if (isLocalDigression(msg) || !looksLikeRailAdvance(msg)) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  return { kind: "advance_rail", pauseScenario: false, parallelAction: null };
}
