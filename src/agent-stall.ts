/**
 * Vague 2 / point 10 — filet D quand le routeur ne matche pas.
 * Générique : aucun nom, numéro ou ID de contact.
 */
import type { AgentMessage } from "./db.js";

export const ROUTER_STALL_CLARIFY =
  "Je n'ai pas bien accroché l'action. Tu veux : proposer l'accroche, créer le brouillon, simuler, ou autre chose ? Une phrase suffit.";

const ROUTER_STALL_MARK = "Je n'ai pas bien accroché l'action";

/** MiniMax paraphrase souvent le filet — il faut aussi reconnaître ces formes. */
const ROUTER_STALL_PARAPHRASE_RE =
  /n['’]ai pas bien accroch[eé] l['’]action|ne (peux|peut) (effectuer l['’]instruction|charger l['’]action)|proposer les accroches.{0,100}(brouillon|simuler)|m[eé]moire ne contient pas l['’]opener/i;

const ROUTER_TOOL_ERROR_RE =
  /INTERDIT de cr[eé]er le brouillon|Trop t[oô]t pour la simulation|Briefing incomplet|Brouillon non cr[eé][eé]|Action g[eé]r[eé]e c[oô]t[eé] serveur|Pas de simulation sur le fil Groupes|Simulation indisponible|Pas encore de brouillon/i;

const ROUTER_STALL_THRESHOLD = 2;

function normalizeFingerprint(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9 ?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dernière question d'un message assistant (ou le message entier s'il n'y a pas de ?). */
export function lastQuestionFingerprint(text: string): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const parts = t.split(/(?<=[?？])/);
  const withQ = [...parts].reverse().find((p) => /[?？]/.test(p));
  const raw = (withQ ?? t).trim();
  return normalizeFingerprint(raw)
    .replace(/^(ok|okay|oui|ouais|d accord|dac|parfait|compris|note)\s+/i, "")
    .slice(0, 72);
}

export function alreadyAskedRouterStallClarify(history: AgentMessage[]): boolean {
  return history
    .slice(-8)
    .some(
      (m) =>
        m.role === "assistant" &&
        (m.content.includes(ROUTER_STALL_MARK) || ROUTER_STALL_PARAPHRASE_RE.test(m.content)),
    );
}

export function isRouterStallToolError(payload: string): boolean {
  return ROUTER_TOOL_ERROR_RE.test(String(payload ?? ""));
}

export function countRouterStallToolErrors(
  toolMessages: Array<{ role?: string; content?: unknown }>
): number {
  return toolMessages.filter(
    (m) => m.role === "tool" && isRouterStallToolError(String(m.content ?? ""))
  ).length;
}

export function shouldStopAfterRouterBlocks(blockedCount: number): boolean {
  return blockedCount >= ROUTER_STALL_THRESHOLD;
}

/**
 * Même question assistant répétée 2 tours, aucun chemin D n'a tiré.
 * Ne se déclenche que dans un fil campagne (briefing / prospection / support / groupes).
 */
export function detectCrossTurnRouterStall(opts: {
  history: AgentMessage[];
  userMessage: string;
  inCampaignFlow: boolean;
}): boolean {
  if (!opts.inCampaignFlow) return false;
  if (alreadyAskedRouterStallClarify(opts.history)) return false;

  const latest = String(opts.userMessage ?? "").trim();
  // Réponse de brief / « oui c'est bon » = l'utilisateur avance, ce n'est pas un stall.
  if (latest.length > 80) return false;
  if (
    /^(oui|ouais|ok|okay|d['’]accord|dac|je\s+valide|c['’]est\s+bon|valide)\b/i.test(
      latest,
    )
  ) {
    return false;
  }

  const users = [
    ...opts.history.filter((m) => m.role === "user").slice(-1),
    { content: opts.userMessage },
  ];
  if (users.length < 2 || !String(users[0]?.content ?? "").trim()) return false;

  const assistants = opts.history.filter((m) => m.role === "assistant").slice(-2);
  if (assistants.length < 2) return false;

  const a = lastQuestionFingerprint(assistants[0].content);
  const b = lastQuestionFingerprint(assistants[1].content);
  if (!a || !b || a.length < 16) return false;
  return a === b;
}
