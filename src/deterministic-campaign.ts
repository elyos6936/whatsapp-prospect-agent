/**
 * Actions campagne sans LLM tool-loop : simulation + activation.
 * Évite les boucles MiniMax sur « simule » / « lance » / « active ».
 */
import type OpenAI from "openai";
import {
  getAgentThread,
  getAutomation,
  type AgentMessage,
} from "./db.js";
import { executeTool } from "./tools.js";
import { generateCampaignSimulationDirect } from "./campaign-simulation.js";
import {
  isExplicitActivationConfirm,
  recentAssistantAskedActivationConfirm,
  recentHistoryHasSimulation,
  userWantsExplicitResimulation,
} from "./simulation-gate.js";
import { wantsCampaignSimulation } from "./campaign-briefing.js";

function parseToolJson(raw: string): {
  ok: boolean;
  error?: string;
  message?: string;
  automationId?: number;
} {
  try {
    const parsed = JSON.parse(raw) as {
      success?: boolean;
      error?: string;
      message?: string;
      automationId?: number;
      id?: number;
    };
    if (parsed.error) return { ok: false, error: parsed.error };
    return {
      ok: Boolean(parsed.success || parsed.automationId || parsed.id || parsed.message),
      message: parsed.message,
      automationId: parsed.automationId ?? parsed.id,
    };
  } catch {
    if (/error|échec|impossible/i.test(raw)) return { ok: false, error: raw.slice(0, 240) };
    return { ok: /success|activ|lanc/i.test(raw), message: raw.slice(0, 400) };
  }
}

async function resolveThreadAutomationId(
  userId: number,
  threadId: number
): Promise<number | null> {
  const thread = await getAgentThread(userId, threadId);
  return thread?.automation_id ?? null;
}

/**
 * Simulation déterministe (génération directe, sans tool_choice LLM).
 */
export async function runDeterministicSimulation(opts: {
  userId: number;
  threadId: number;
  client: OpenAI;
  businessContext: string;
  history: AgentMessage[];
  userMessage: string;
}): Promise<string | null> {
  const { userId, threadId, client, businessContext, history, userMessage } = opts;
  const automationId = await resolveThreadAutomationId(userId, threadId);

  let approvedOpener: string | null = null;
  let campaignBrief: string | null = null;
  if (automationId) {
    const auto = await getAutomation(userId, automationId);
    approvedOpener = auto?.config.initialMessage?.trim() || null;
    if (auto) {
      const bits = [
        auto.config.conversationGuide ? `Guide :\n${auto.config.conversationGuide}` : "",
        auto.config.productName ? `Produit : ${auto.config.productName}` : "",
        auto.config.price ? `Prix : ${auto.config.price}` : "",
        auto.config.closingLink ? `Lien : ${auto.config.closingLink}` : "",
        auto.config.salesScript ? `Script : ${auto.config.salesScript}` : "",
      ].filter(Boolean);
      try {
        const { formatCampaignMemoryForWhatsApp, getLinkedMemoryForAutomation } =
          await import("./campaign-sync.js");
        const mem = await getLinkedMemoryForAutomation(userId, auto.id);
        if (mem) bits.push(formatCampaignMemoryForWhatsApp(mem));
      } catch {
        /* ignore */
      }
      campaignBrief = bits.join("\n\n") || null;
    }
  }

  const recentTranscript = history
    .slice(-16)
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n\n");

  const sim = await generateCampaignSimulationDirect(client, {
    businessContext,
    recentTranscript: `${recentTranscript}\n\nUser: ${userMessage}`,
    approvedOpener,
    campaignBrief,
  });
  if (!sim?.display?.trim()) return null;

  try {
    const { persistLivePlaybookForThread } = await import("./campaign-sync.js");
    await persistLivePlaybookForThread(userId, threadId, sim.turns);
  } catch (err) {
    console.warn("[deterministic] persist playbook:", err);
  }
  return sim.display.trim();
}

/**
 * Activation déterministe de la campagne du fil.
 */
export async function runDeterministicActivation(opts: {
  userId: number;
  threadId: number;
}): Promise<string | null> {
  const { userId, threadId } = opts;
  const automationId = await resolveThreadAutomationId(userId, threadId);
  if (!automationId) {
    return (
      "Aucune campagne n'est liée à ce fil. " +
      "Valide d'abord les accroches (oui) pour créer le brouillon, ou ouvre une automatisation existante."
    );
  }

  const raw = await executeTool(userId, threadId, "activate_automation", {
    automation_id: automationId,
  });
  const parsed = parseToolJson(raw);
  if (!parsed.ok) {
    return (
      parsed.error ||
      "Impossible d'activer la campagne pour le moment. Vérifie WhatsApp / la mémoire, puis réessaie « active »."
    );
  }
  return (
    parsed.message?.trim() ||
    `Campagne activée. Les envois démarrent selon ta fenêtre horaire — auto-reply ON.`
  );
}

/** Faut-il forcer une simulation sans LLM tool-loop ? */
export function shouldDeterministicSimulate(
  history: AgentMessage[],
  userMessage: string
): boolean {
  const hasSim = recentHistoryHasSimulation(history);
  if (userWantsExplicitResimulation(userMessage)) return true;
  if (!hasSim && wantsCampaignSimulation(userMessage, history)) return true;
  return false;
}

/** Faut-il forcer une activation sans LLM tool-loop ? */
export function shouldDeterministicActivate(
  history: AgentMessage[],
  userMessage: string
): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (/\b(pas maintenant|plus tard|attends|attendre)\b/i.test(t) && t.length < 48) {
    return false;
  }

  // Ordre explicite (« lancer », « active les campagnes »)
  if (/^(lance|lancer|active|activer|démarre|demarre|go)(\s|$|[!.])/i.test(t)) return true;
  if (
    /\b(active|activer|lance|lancer)\s+(les?\s+)?(campagnes?|automatisations?|maintenant)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Oui / vas-y après question d'activation post-simulation
  if (
    recentHistoryHasSimulation(history) &&
    recentAssistantAskedActivationConfirm(history) &&
    isExplicitActivationConfirm(userMessage)
  ) {
    return true;
  }
  return false;
}
