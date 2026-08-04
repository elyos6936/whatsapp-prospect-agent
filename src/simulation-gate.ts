/**
 * Décisions pures autour de la simulation (sans LLM / DB).
 * Source de vérité pour agent.ts + tests.
 */
import type { AgentMessage } from "./db.js";
import { declinesCampaignSimulation, wantsCampaignSimulation } from "./campaign-briefing.js";

/** Retire fences code / plan pour ne pas confondre JSON avec un fil de simu. */
function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ");
}

/** Vrai contenu de simulation (fil Toi → / Prospect → ou fence téléphone). */
export function hasSimulationThread(text: string): boolean {
  // Fence dédiée au téléphone — ne pas stripper avant ce test
  if (/```klanvio-sim\b/i.test(text)) return true;
  const cleaned = stripCodeFences(text);
  const arrowTurns = (cleaned.match(/→/g) || []).length;
  if (arrowTurns >= 2) return true;
  if (
    /(^|\n)\s*(toi|moi)\s*→/im.test(cleaned) &&
    /(^|\n)\s*\S{2,}\s*→/im.test(cleaned)
  ) {
    return true;
  }
  // Format colon (Toi: / Prospect:)
  if (
    /(^|\n)\s*(toi|moi)\s*:/im.test(cleaned) &&
    /(^|\n)\s*(prospect|prospect\s*\d+)\s*:/im.test(cleaned)
  ) {
    return true;
  }
  // Guillemets français seulement (jamais " ASCII du JSON planDisplay).
  const quotes = cleaned.match(/«[^»\n]{8,}»/g);
  // Au moins 2 répliques « … » ET un marqueur de fil (Toi/Prospect/Simulation).
  if (quotes && quotes.length >= 2) {
    return /\b(toi|prospect|simulation)\b/i.test(cleaned);
  }
  return false;
}

const SIMULATION_ADJUSTMENT_FOOTER =
  /Qu'est-ce que tu veux (ajuster|changer)|ce qui te convient|simulation courte|Dis-moi concrètement/i;

export function recentHistoryHasSimulation(history: AgentMessage[]): boolean {
  for (let i = history.length - 1; i >= 0 && i >= history.length - 8; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    // Offre de simu / planDisplay ≠ fil déjà montré
    if (/veux-tu tester une?\s*\*?\*?simulation/i.test(m.content) && !hasSimulationThread(m.content)) {
      continue;
    }
    if (hasSimulationThread(m.content) || SIMULATION_ADJUSTMENT_FOOTER.test(stripCodeFences(m.content))) {
      return true;
    }
  }
  return false;
}

export function isSimulationApproval(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (
    /\b(modifie|change|ajuste|autre|recommence|refais|retire|enlève|enleve|moins|plus court|plus long)\b/i.test(
      t
    )
  ) {
    return false;
  }
  return (
    /^(c'est bon|c bon|cest bon|ok\.?|parfait\.?|nickel\.?|top\.?|validé\.?|validé|ca me va|ça me va|good|yes|oui\.?)(\s|$|pour|,)/i.test(
      t
    ) ||
    /\b(c'est bon pour moi|ca me convient|ça me convient|rien à changer|pas de changement|comme ça|comme ca)\b/i.test(
      t
    )
  );
}

export function isExplicitActivationConfirm(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\b(non|pas maintenant|plus tard|attends|attendre)\b/i.test(t)) return false;
  return (
    /^(oui\.?|ok\.?|yes\.?|vas-?y\.?|go\.?)(\s|$)/i.test(t) ||
    /\b(lance|lancer|active|activer|active[rz]?|démarre|demarre|go)\b/i.test(t)
  );
}

export function recentAssistantAskedActivationConfirm(history: AgentMessage[]): boolean {
  for (let i = history.length - 1; i >= 0 && i >= history.length - 8; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    if (
      /veux-tu activer|voulez-vous activer|activer.*maintenant|je (l[’'])?active|tu veux que je l[’']active|autres? modifi|modifications? à faire|je lance|lancer (la )?(campagne|automatisation)/i.test(
        m.content
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Demande EXPLICITE de refaire / revoir la simulation dans le chat.
 * Seul cas où on régénère un fil après une simu déjà affichée.
 */
export function userWantsExplicitResimulation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /\b(recommence|refais|re[- ]?(fais|lance|simule)|nouvelle simulation|encore (une )?(simu|simulation)|montre[- ]?(moi )?(à nouveau|encore)|autre (aper[cç]u|simulation)|re[- ]?simule)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(simulation|simule[rz]?|simuler|fais\s+(une\s+)?simu|montre\s+(moi\s+)?(un\s+)?(aper[cç]u|exemple|fil))\b/i.test(
      t
    ) &&
    !/^(oui|ouais|ok|okay|d'accord|dac)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Modif de campagne (ton, accroche…) SANS redemander une simulation. */
export function userWantsSilentCampaignTweak(text: string): boolean {
  if (userWantsExplicitResimulation(text)) return false;
  return /\b(?:modifie|change|ajuste|ton|accroche|message|relance|variante|plus court|plus long|moins agressif|moins direct|retire|enl[eè]ve|ajoute|remplace|plut[oô]t|adouci|plus poli|(?:vouvoi|vouvoy|tutoi|tutoy)\w*)\b/i.test(
    text
  );
}

/** Question / préoccupation après simu — répondre sans re-simuler. */
export function userAsksFollowUpAboutCampaign(text: string): boolean {
  if (userWantsExplicitResimulation(text)) return false;
  const t = text.trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  return /\b(pourquoi|comment|c['’]est quoi|explique|clarifie|inquiet|pr[eé]occup|pas s[uû]r|je comprends pas|ça veut dire)\b/i.test(
    t
  );
}

export function shouldBlockDuplicateSimulation(
  history: AgentMessage[],
  userMessage: string
): boolean {
  if (!recentHistoryHasSimulation(history)) return false;
  if (userWantsExplicitResimulation(userMessage)) return false;
  return true;
}

export type SimulationTurnMode =
  | "force_sim"
  | "decline_sim"
  | "silent_tweak"
  | "activation_confirm"
  | "activation_nudge"
  | "none";

/**
 * Mode de tour agent après un message utilisateur (miroir de agent.ts).
 */
export function resolveSimulationTurnMode(
  history: AgentMessage[],
  userMessage: string
): SimulationTurnMode {
  if (declinesCampaignSimulation(userMessage, history)) return "decline_sim";

  const hasSimAlready = recentHistoryHasSimulation(history);
  const wantsSim = wantsCampaignSimulation(userMessage, history);
  const forceSim =
    (!hasSimAlready && wantsSim) ||
    (hasSimAlready && userWantsExplicitResimulation(userMessage));
  if (forceSim) return "force_sim";

  const silentTweakAfterSim =
    hasSimAlready &&
    !isSimulationApproval(userMessage) &&
    !(
      recentAssistantAskedActivationConfirm(history) &&
      isExplicitActivationConfirm(userMessage)
    ) &&
    (userWantsSilentCampaignTweak(userMessage) ||
      userAsksFollowUpAboutCampaign(userMessage));
  if (silentTweakAfterSim) return "silent_tweak";

  if (
    hasSimAlready &&
    recentAssistantAskedActivationConfirm(history) &&
    isExplicitActivationConfirm(userMessage)
  ) {
    return "activation_confirm";
  }
  if (isSimulationApproval(userMessage) && hasSimAlready) {
    return "activation_nudge";
  }
  return "none";
}

/** Heuristique : réponse assistant = révélation brouillon / fil de simulation (chat). */
export function shouldAutoOpenSimulationPanel(assistantReply: string): boolean {
  const isSimThread = (assistantReply.match(/→/g) || []).length >= 2;
  const isDraftReveal =
    /brouillon|simulation dans ce chat|est prêt|veux-tu tester une \*\*simulation\*\*|ouvre la \*\*simulation\*\*/i.test(
      assistantReply,
    );
  return isSimThread || isDraftReveal;
}
