/**
 * Vague 4 — classification du tour avant hard-return du slot briefing.
 * 100 % déterministe / générique (aucun nom, numéro ou ID en dur).
 *
 * - advance_rail : réponse attendue au scénario → hard-return slot OK
 * - digression : aparté légitime → MiniMax répond, scénario en pause (pas de re-colle slot)
 * - parallel_action : intention autonome (ex. envoi one-shot) → MiniMax + outils,
 *   Vague 1 (high-stakes) reste le garde-fou d'exécution
 */
import type { AgentMessage } from "./db.js";
import { isBriefingSideTalk } from "./campaign-briefing.js";
import { isExplicitSendNow } from "./high-stakes-intent.js";

export type BriefingTurnKind = "advance_rail" | "digression" | "parallel_action";

export type ParallelActionType = "one_shot_send";

export type BriefingTurnClassification = {
  kind: BriefingTurnKind;
  /** true = ne pas forcer / re-coller la question de slot dans CE tour */
  pauseScenario: boolean;
  parallelAction: ParallelActionType | null;
};

const SEND_VERB_RE =
  /\b(envoie[rz]?|envois|envoies|envoyer|écris|ecris|écrire|ecrire|transmets|transmettre|message\s+à)\b/i;

/** Destinataire identifiable : E.164-like ou « à/au +digits ». */
const SEND_RECIPIENT_RE =
  /\+\d{8,15}\b|\b(?:à|a|au|pour)\s+\+?\d{8,15}\b|\b(?:à|a)\s+(?:lui|elle|leur)\b/i;

/** Contenu identifiable (guillemets, tiret, ou « message: … »). */
const SEND_CONTENT_RE =
  /[«"'][^»"']{1,500}[»"']|:\s*\S{2,}|[-–—]\s*\S{2,}|\bmessage\s*:\s*\S{2,}/i;

/**
 * Envoi one-shot autonome : verbe d'envoi + destinataire + contenu,
 * y compris texte entre guillemets (ne doit plus être avalé par le rail).
 * S'appuie aussi sur Vague 1 (`isExplicitSendNow`) pour rester aligné.
 */
export function isParallelOneShotSend(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || t.length > 500) return false;
  if (!SEND_VERB_RE.test(t)) return false;
  // Destinataire + contenu tous les deux présents → parallèle clair
  if (SEND_RECIPIENT_RE.test(t) && SEND_CONTENT_RE.test(t)) return true;
  // Sinon : laisser Vague 1 trancher (ex. « envoie maintenant : bonjour »)
  return isExplicitSendNow(t);
}

/**
 * Consigne système quand le scénario est en pause (digression / parallèle).
 * Pas de re-colle de la question slot dans la même réplique.
 */
export function buildScenarioPauseNudge(opts: {
  kind: Exclude<BriefingTurnKind, "advance_rail">;
  slotQuestion: string | null;
}): string {
  const resume =
    opts.slotQuestion != null
      ? `Le briefing reprendra au prochain message utile (question en attente : « ${opts.slotQuestion} »). ` +
        `INTERDIT de reposer cette question dans CE message.`
      : `Le scénario reprendra au prochain message utile. INTERDIT de forcer une question de checklist dans CE message.`;

  if (opts.kind === "parallel_action") {
    return (
      `## Scénario en pause — action parallèle\n` +
      `L'utilisateur demande une action autonome (souvent un envoi WhatsApp one-shot), ` +
      `pas la prochaine étape du briefing. Exécute SA demande si les outils le permettent ` +
      `(Vague 1 : envoi seulement si intention explicite). ${resume}`
    );
  }
  return (
    `## Scénario en pause — digression\n` +
    `L'utilisateur pose une question / aparté hors checklist. ` +
    `Réponds utilement en 1–5 phrases, sans poser d'autre question de briefing. ${resume}`
  );
}

/**
 * Classifie le tour AVANT tout hard-return de slot.
 * Ordre : parallèle → digression → rail (priorité n°1 : ne pas casser le nominal).
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

  if (isBriefingSideTalk(msg)) {
    return { kind: "digression", pauseScenario: true, parallelAction: null };
  }

  return { kind: "advance_rail", pauseScenario: false, parallelAction: null };
}
