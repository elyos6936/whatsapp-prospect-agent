/**
 * Actions campagne SANS MiniMax tool-loop :
 * - brouillon + simulation (Claude pour générer le fil)
 * - activation
 * MiniMax = dialogue uniquement.
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
import {
  extractOpenerVariantsFromHistory,
  wantsCampaignSimulation,
} from "./campaign-briefing.js";

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

/** Numéros / contacts cités par l'utilisateur dans le fil (pour contact_prospect). */
export function extractProspectContactsFromHistory(history: AgentMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const phoneRe = /(?:\+|00)?\d[\d\s.\-]{7,}\d/g;
  for (const m of history) {
    if (m.role !== "user") continue;
    const hits = m.content.match(phoneRe) || [];
    for (const raw of hits) {
      const compact = raw.replace(/[\s.\-]/g, "");
      const digits = compact.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) continue;
      if (seen.has(digits)) continue;
      seen.add(digits);
      found.push(compact.startsWith("+") || compact.startsWith("00") ? compact : `+${digits}`);
    }
  }
  return found;
}

/** Nom de groupe mentionné (ex. « prospecter le groupe Automax »). */
export function extractProspectGroupQueryFromHistory(history: AgentMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role !== "user") continue;
    const hit =
      /\b(?:groupe|group)\s+[«"]?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 .'-]{1,60})/i.exec(m.content) ||
      /\bprospect(?:er|e)?\s+(?:le\s+)?groupe\s+[«"]?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 .'-]{1,60})/i.exec(
        m.content
      );
    if (hit?.[1]) {
      const name = hit[1].replace(/[»"].*$/, "").trim();
      if (name.length >= 2) return name;
    }
  }
  return null;
}

/**
 * Brouillon + simulation à partir des 5 variantes du chat (pas d'args MiniMax).
 */
export async function runDeterministicDraftAndSim(opts: {
  userId: number;
  threadId: number;
  client: OpenAI;
  businessContext: string;
  history: AgentMessage[];
  userMessage: string;
  purpose?: string | null;
  threadTitle?: string | null;
  existingAutomationId?: number | null;
}): Promise<string | null> {
  const {
    userId,
    threadId,
    client,
    businessContext,
    history,
    userMessage,
    purpose,
    threadTitle,
    existingAutomationId,
  } = opts;

  const variants = extractOpenerVariantsFromHistory(history);
  if (!variants || variants.length !== 5) {
    console.warn("[deterministic] extractOpenerVariantsFromHistory → null/insuffisant");
    return null;
  }

  let contacts = extractProspectContactsFromHistory(history);
  const groupQuery = extractProspectGroupQueryFromHistory(history);

  // Réutiliser contacts / groupe déjà sur le brouillon du fil
  if (existingAutomationId) {
    const existing = await getAutomation(userId, existingAutomationId);
    if (existing?.config.contactTargets?.length && contacts.length === 0) {
      contacts = existing.config.contactTargets
        .map((t) => t.label || t.id)
        .filter(Boolean) as string[];
    }
  }

  const wantsGroup =
    purpose === "groupes" ||
    Boolean(groupQuery) ||
    (contacts.length === 0 && purpose !== "prospection");

  let autoType: string;
  const draftArgs: Record<string, unknown> = {
    name: threadTitle?.trim() || "Campagne",
    status: "draft",
    initial_message: variants[0]!.message,
    ab_variants: variants,
    ab_variants_from_chat: true,
    personalize_messages: false,
    stickers_enabled: false,
    ...(existingAutomationId ? { automation_id: existingAutomationId } : {}),
  };

  if (contacts.length > 0 && !groupQuery) {
    autoType = "contact_prospect";
    draftArgs.type = autoType;
    draftArgs.contacts = contacts;
  } else if (groupQuery || purpose === "groupes") {
    // Prospection membres de groupe (pas broadcast)
    autoType = "group_prospect";
    draftArgs.type = autoType;
    if (groupQuery) draftArgs.group_id = groupQuery;
  } else if (wantsGroup) {
    autoType = "group_broadcast";
    draftArgs.type = autoType;
  } else {
    // contact_prospect sans contacts → message clair
    return (
      "J'ai les 5 accroches, mais il me manque les contacts à prospecter. " +
      "Envoie le(s) numéro(s) (ex. +229…) ou le nom du groupe, puis redis « je valide »."
    );
  }

  const draftRaw = await executeTool(userId, threadId, "create_automation", draftArgs);

  const draft = parseToolJson(draftRaw);
  if (!draft.ok) {
    console.warn("[deterministic] draft error:", draft.error || draftRaw.slice(0, 240));
    return (
      draft.error ||
      "Impossible d'enregistrer le brouillon avec les 5 accroches. Réessaie « oui »."
    );
  }

  const freshThread = await getAgentThread(userId, threadId);
  let approvedOpener = variants[0]!.message;
  let campaignBrief: string | null = null;
  if (freshThread?.automation_id) {
    const auto = await getAutomation(userId, freshThread.automation_id);
    approvedOpener = auto?.config.initialMessage?.trim() || approvedOpener;
    if (auto) {
      const bits = [
        auto.config.conversationGuide ? `Guide :\n${auto.config.conversationGuide}` : "",
        auto.config.productName ? `Produit : ${auto.config.productName}` : "",
        auto.config.price ? `Prix : ${auto.config.price}` : "",
        auto.config.closingLink ? `Lien : ${auto.config.closingLink}` : "",
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

  if (sim?.display?.trim() && /```klanvio-sim\b/i.test(sim.display)) {
    try {
      const { persistLivePlaybookForThread } = await import("./campaign-sync.js");
      await persistLivePlaybookForThread(userId, threadId, sim.turns);
    } catch (err) {
      console.warn("[deterministic] persist playbook:", err);
    }
    return (
      `Parfait — les 5 accroches sont enregistrées en brouillon.\n\n` + sim.display.trim()
    );
  }

  return (
    "Parfait — les 5 accroches sont enregistrées en brouillon. " +
    "Dis « simule » pour l'aperçu sur le téléphone à droite, ou « active » pour lancer."
  );
}

/**
 * Simulation déterministe (génération Claude / filet — sans tool_choice MiniMax).
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

  if (!approvedOpener) {
    const variants = extractOpenerVariantsFromHistory(history);
    approvedOpener = variants?.[0]?.message ?? null;
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

  if (/^(lance|lancer|active|activer|démarre|demarre|go)(\s|$|[!.])/i.test(t)) return true;
  if (
    /\b(active|activer|lance|lancer)\s+(les?\s+)?(campagnes?|automatisations?|maintenant)\b/i.test(
      t
    )
  ) {
    return true;
  }

  if (
    recentHistoryHasSimulation(history) &&
    recentAssistantAskedActivationConfirm(history) &&
    isExplicitActivationConfirm(userMessage)
  ) {
    return true;
  }
  return false;
}

/** Outils « puissance » — jamais via args MiniMax bruts. */
export const POWER_CAMPAIGN_TOOLS = new Set([
  "create_automation",
  "show_campaign_simulation",
  "activate_automation",
]);
