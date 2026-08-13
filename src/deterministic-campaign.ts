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
  allowsActivateWithoutSimulation,
  isActivationNegation,
  isExplicitActivationConfirm,
  recentAssistantAskedActivationConfirm,
  recentHistoryHasSimulation,
  userWantsExplicitResimulation,
} from "./simulation-gate.js";
import {
  extractOpenerVariantsFromHistory,
  wantsCampaignSimulation,
  wantsInboundCatchAll,
} from "./campaign-briefing.js";
import { proposeShortAttentionOpener } from "./opener-frame.js";
import {
  extractUserDictatedOpenerFromHistory,
  generateOpenerVariants,
} from "./opener-intent.js";
import {
  extractSupportHandoffKeywords,
  extractSupportTriggerPhrases,
  extractSupportProductHint,
  extractSupportThirdParty,
  looksLikeThirdPartyPhoneReply,
  buildSupportConversationGuide,
  generateSupportSimulationDirect,
} from "./support-flow.js";
import { userFacingError } from "./user-facing.js";

export {
  runDeterministicGroupsDraft,
  runDeterministicGroupsDraftAndSim,
  shouldDeterministicGroupsDraft,
} from "./groups-flow.js";

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

/** Phrases déclencheurs citées (guillemets) pour Support — délègue au module isolé. */
export function extractTriggerPhrasesFromHistory(history: AgentMessage[]): string[] {
  return extractSupportTriggerPhrases(history);
}

function conversationBlob(history: AgentMessage[]): string {
  return history.map((m) => m.content).join("\n");
}

function extractHttpLink(history: AgentMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const hit = history[i]?.content.match(/https?:\/\/\S+/i);
    if (hit?.[0]) return hit[0].replace(/[),.;]+$/, "");
  }
  return null;
}

function extractPriceHint(history: AgentMessage[]): string | null {
  const blob = conversationBlob(history);
  const hit = blob.match(/\b(\d[\d\s.,]{1,12}\s*(?:fcfa|f|€|euros?))\b/i);
  return hit?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function wantsMemberDmProspect(history: AgentMessage[], purpose?: string | null): boolean {
  if (purpose === "groupes") return false;
  const blob = conversationBlob(history);
  return /\b(membres?|prospect(?:er|e)?\s+(?:les\s+)?membres|dm\s+(aux\s+)?membres|contacter\s+les\s+membres)\b/i.test(
    blob
  );
}

function shortOpenerNote(variants: Array<{ message: string }>): string {
  const long = variants.find((v) => v.message.length > 200);
  if (!long) return "";
  const short = proposeShortAttentionOpener(long.message);
  if (!short) return "";
  return (
    `\n\n_(Accroche longue acceptée. Version courte proposée : « ${short} » — dis « utilise la courte » si tu préfères.)_`
  );
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

  // Sécurité : fil Groupes ne doit jamais passer par les 5 accroches / sim.
  if (purpose === "groupes") {
    const { runDeterministicGroupsDraft } = await import("./groups-flow.js");
    return runDeterministicGroupsDraft({
      userId,
      threadId,
      history,
      threadTitle,
      existingAutomationId,
    });
  }

  let variants = extractOpenerVariantsFromHistory(history);
  if (!variants || variants.length !== 5) {
    const base = extractUserDictatedOpenerFromHistory(history, userMessage);
    if (base) {
      const generated = generateOpenerVariants(base);
      if (generated.length === 5) {
        variants = generated.map((message, i) => ({ id: `v${i + 1}`, message }));
      }
    }
  }
  if (!variants || variants.length !== 5) {
    console.warn("[deterministic] extractOpenerVariantsFromHistory → null/insuffisant");
    return (
      "Je n'ai pas encore les **5 accroches** dans le fil. " +
      "Donne le premier message que tu veux (ex. « Juste un 'Bonjour comment ça va ?' »), " +
      "je te propose les 5 variantes, puis dis « je valide »."
    );
  }

  let contacts = extractProspectContactsFromHistory(history);
  const groupQuery = extractProspectGroupQueryFromHistory(history);
  const memberDm = wantsMemberDmProspect(history, purpose);

  // Réutiliser contacts / groupe déjà sur le brouillon du fil
  if (existingAutomationId) {
    const existing = await getAutomation(userId, existingAutomationId);
    if (existing?.config.contactTargets?.length && contacts.length === 0) {
      contacts = existing.config.contactTargets
        .map((t) => t.label || t.id)
        .filter(Boolean) as string[];
    }
  }

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

  if (contacts.length > 0 && !groupQuery && purpose !== "groupes") {
    autoType = "contact_prospect";
    draftArgs.type = autoType;
    draftArgs.contacts = contacts;
  } else if (purpose === "groupes" || (groupQuery && !memberDm && purpose !== "prospection")) {
    // Fil Groupes = poster DANS le groupe (choix produit 5-B)
    autoType = "group_broadcast";
    draftArgs.type = autoType;
    if (groupQuery) {
      draftArgs.group_ids = [groupQuery];
    } else {
      return (
        "Fil **Groupes** : j'ai les accroches, mais il me manque le(s) groupe(s) où poster. " +
        "Donne le nom du groupe (où tu es admin), puis redis « je valide »."
      );
    }
  } else if (groupQuery || memberDm) {
    autoType = "group_prospect";
    draftArgs.type = autoType;
    if (groupQuery) draftArgs.group_id = groupQuery;
  } else {
    return (
      "J'ai les 5 accroches, mais il me manque les contacts à prospecter. " +
      "Envoie le(s) numéro(s) (ex. +229…) ou le nom du groupe, puis redis « je valide »."
    );
  }

  const draftRaw = await executeTool(userId, threadId, "create_automation", draftArgs);

  const draft = parseToolJson(draftRaw);
  if (!draft.ok) {
    console.warn("[deterministic] draft error:", draft.error || draftRaw.slice(0, 240));
    return userFacingError(
      draft.error ||
        "Impossible d'enregistrer le brouillon avec les 5 accroches. Réessaie « oui ».",
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

  const openerNote = shortOpenerNote(variants);

  if (sim?.display?.trim() && /```klanvio-sim\b/i.test(sim.display)) {
    try {
      const { persistLivePlaybookForThread } = await import("./campaign-sync.js");
      await persistLivePlaybookForThread(userId, threadId, sim.turns);
    } catch (err) {
      console.warn("[deterministic] persist playbook:", err);
    }
    return (
      `Parfait — les 5 accroches sont enregistrées en brouillon.${openerNote}\n\n` +
      sim.display.trim()
    );
  }

  return (
    `Parfait — les 5 accroches sont enregistrées en brouillon.${openerNote} ` +
    "Dis « simule » pour l'aperçu sur le téléphone à droite, ou « active » pour lancer " +
    "(ou « lance sans simulation » pour activer sans aperçu)."
  );
}

/**
 * Support / keyword_sales : brouillon + sim déterministes (pas MiniMax).
 */
export async function runDeterministicSupportDraftAndSim(opts: {
  userId: number;
  threadId: number;
  client: OpenAI;
  businessContext: string;
  history: AgentMessage[];
  userMessage: string;
  threadTitle?: string | null;
  existingAutomationId?: number | null;
  inboundCatchAll?: boolean;
}): Promise<string | null> {
  const {
    userId,
    threadId,
    client,
    businessContext,
    history,
    userMessage,
    threadTitle,
    existingAutomationId,
    inboundCatchAll,
  } = opts;

  const catchAll =
    inboundCatchAll === true || wantsInboundCatchAll(history, userMessage);
  const triggers = catchAll ? [] : extractSupportTriggerPhrases(history);
  if (!catchAll && triggers.length === 0) {
    return (
      "Pour le Support, il me faut soit des **phrases déclencheurs** exactes (entre guillemets ou listées), " +
      "soit la confirmation « **tous les messages** » (compte entier). " +
      "Précise ça, puis redis « crée le brouillon » / « je valide »."
    );
  }

  const handoffKeywords = extractSupportHandoffKeywords(history);
  const thirdParty = extractSupportThirdParty(history, userMessage);
  if (thirdParty.asked && !thirdParty.declined && !thirdParty.accepted) {
    return (
      "Tu veux qu'on prévienne un tiers (livreur, associé…) à chaque conversion ? " +
      "Réponds **oui** (avec son numéro WhatsApp) ou **non**, puis redis « je valide »."
    );
  }
  if (thirdParty.accepted && !thirdParty.phone) {
    return (
      "Pour prévenir le livreur / le tiers à chaque conversion, il me faut son **numéro WhatsApp**. " +
      "Envoie-le (ex. +229…), puis redis « je valide »."
    );
  }
  const link = extractHttpLink(history);
  let price = extractPriceHint(history);
  if (!price) {
    try {
      const { getAppSettings } = await import("./db.js");
      const { getLinkedCampaignMemory } = await import("./campaign-memory.js");
      const s = await getAppSettings(userId);
      price = (s.business_price || "").trim() || null;
      if (!price) {
        const mem = await getLinkedCampaignMemory(userId, threadId);
        if (mem?.instructions) {
          const hit =
            mem.instructions.match(
              /(?:prix|tarif|montant)\s*[:=]?\s*([^\n.]{0,40}?\b\d[\d\s.,]{1,12}\s*(?:fcfa|f\b|€|euros?)?)/i,
            )?.[1] ||
            mem.instructions.match(/\b(\d[\d\s.,]{2,12}\s*(?:fcfa|f\b|€|euros?))\b/i)?.[1];
          const cleaned = hit?.replace(/\s+/g, " ").trim();
          if (cleaned && !/\[indiquer/i.test(cleaned)) price = cleaned.slice(0, 80);
        }
      }
    } catch {
      /* ignore */
    }
  }
  const productHint = extractSupportProductHint(history);
  const historyBlob = history.map((m) => m.content).join("\n");
  const closingGoal: "payment" | "delivery" | "link" | "appointment" = link
    ? "link"
    : /rdv|rendez[- ]?vous|calendly/i.test(historyBlob)
      ? "appointment"
      : /paiement|payer|orange money|moov|mtn/i.test(historyBlob)
        ? "payment"
        : "delivery";
  const supportGuide = buildSupportConversationGuide({
    catchAll,
    triggers,
    handoffKeywords,
    productHint,
    price,
    link,
    closingGoal,
  });
  const draftArgs: Record<string, unknown> = {
    name: threadTitle?.trim() || "Support client",
    type: "keyword_sales",
    status: "draft",
    mode: "inbound_closing",
    inbound_catch_all: catchAll,
    trigger_phrases: triggers,
    handoff_keywords: handoffKeywords,
    stickers_enabled: false,
    conversation_guide: supportGuide,
    closing_goal: closingGoal,
    ...(productHint ? { product_name: productHint } : {}),
    ...(link ? { closing_link: link } : {}),
    ...(price ? { price } : {}),
    ...(thirdParty.declined
      ? { third_party_notification_enabled: false }
      : thirdParty.accepted && thirdParty.phone
        ? {
            third_party_notification_enabled: true,
            third_party_phone: thirdParty.phone,
            ...(thirdParty.role ? { third_party_role: thirdParty.role } : {}),
          }
        : {}),
    ...(existingAutomationId ? { automation_id: existingAutomationId } : {}),
  };

  const draftRaw = await executeTool(userId, threadId, "create_automation", draftArgs);
  const draft = parseToolJson(draftRaw);
  if (!draft.ok) {
    console.warn("[deterministic] support draft error:", draft.error || draftRaw.slice(0, 240));
    return userFacingError(
      draft.error ||
        "Impossible d'enregistrer le brouillon Support. Réessaie « crée le brouillon ».",
    );
  }

  const recentTranscript = history
    .slice(-16)
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n\n");

  const sim = await generateSupportSimulationDirect(client, {
    businessContext,
    recentTranscript: `${recentTranscript}\n\nUser: ${userMessage}`,
    triggerPhrases: triggers,
    catchAll,
    campaignBrief: supportGuide,
  });

  if (sim?.display?.trim() && /```klanvio-sim\b/i.test(sim.display)) {
    try {
      const { persistLivePlaybookForThread } = await import("./campaign-sync.js");
      await persistLivePlaybookForThread(userId, threadId, sim.turns);
    } catch (err) {
      console.warn("[deterministic] support persist playbook:", err);
    }
    return (
      `Parfait — brouillon Support enregistré` +
      (catchAll ? " (tous les messages privés)." : ` (déclencheurs : ${triggers.slice(0, 3).join(", ")}).`) +
      `\n\n` +
      sim.display.trim()
    );
  }

  return (
    "Parfait — brouillon Support enregistré. " +
    "Dis « simule » pour l'aperçu téléphone (le client écrit en premier), « active » après sim, " +
    "ou « lance sans simulation » pour activer sans aperçu."
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
  let isSupportCampaign = false;
  let supportTriggers: string[] = [];
  let supportCatchAll = false;

  if (automationId) {
    const auto = await getAutomation(userId, automationId);
    approvedOpener = auto?.config.initialMessage?.trim() || null;
    isSupportCampaign =
      auto?.type === "keyword_sales" || auto?.config.mode === "inbound_closing";
    // Groupes : pas de simulation téléphone
    if (
      auto?.type === "group_broadcast" ||
      auto?.config.mode === "group_broadcast"
    ) {
      return (
        "Sur le fil **Groupes**, il n'y a pas de simulation téléphone. " +
        "Dis **« active »** pour lancer la diffusion, ou utilise send/schedule pour un envoi ponctuel."
      );
    }
    supportCatchAll = Boolean(auto?.config.inboundCatchAll);
    supportTriggers = (auto?.config.triggerPhrases || auto?.config.keywords || [])
      .map((p) => String(p).trim())
      .filter(Boolean);
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

  const thread = await getAgentThread(userId, threadId);
  if (thread?.purpose === "groupes") {
    return (
      "Sur le fil **Groupes**, pas de simulation. " +
      "Envoi ponctuel → send/schedule. Diffusion multi-jours → « je valide » puis **« active »**."
    );
  }

  if (!approvedOpener && !isSupportCampaign) {
    const variants = extractOpenerVariantsFromHistory(history);
    approvedOpener = variants?.[0]?.message ?? null;
  }

  if (!approvedOpener && !automationId && !isSupportCampaign) {
    return (
      "Pas encore de brouillon lié à ce fil. " +
      "Valide d'abord les accroches (« je valide ») ou crée le brouillon Support, " +
      "puis redis « simule »."
    );
  }

  if (isSupportCampaign) {
    // Support / inbound : sim dédiée (client d'abord)
    const recentTranscript = history
      .slice(-16)
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n\n");
    const auto = automationId ? await getAutomation(userId, automationId) : null;
    const supportGuide =
      auto?.config.conversationGuide?.trim() ||
      buildSupportConversationGuide({
        catchAll: supportCatchAll,
        triggers: supportTriggers.length
          ? supportTriggers
          : extractSupportTriggerPhrases(history),
        handoffKeywords: extractSupportHandoffKeywords(history),
        productHint: auto?.config.productName,
        price: auto?.config.price,
        link: auto?.config.closingLink,
        closingGoal: auto?.config.closingGoal,
      });
    const sim = await generateSupportSimulationDirect(client, {
      businessContext,
      recentTranscript: `${recentTranscript}\n\nUser: ${userMessage}`,
      campaignBrief: [supportGuide, campaignBrief].filter(Boolean).join("\n\n"),
      triggerPhrases: supportTriggers.length
        ? supportTriggers
        : extractSupportTriggerPhrases(history),
      catchAll: supportCatchAll,
    });
    if (!sim?.display?.trim()) return null;
    try {
      const { persistLivePlaybookForThread } = await import("./campaign-sync.js");
      await persistLivePlaybookForThread(userId, threadId, sim.turns);
    } catch (err) {
      console.warn("[deterministic] persist support playbook:", err);
    }
    return sim.display.trim();
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
  history?: AgentMessage[];
  userMessage?: string;
}): Promise<string | null> {
  const { userId, threadId, history = [], userMessage = "" } = opts;

  if (userMessage && isActivationNegation(userMessage)) {
    return (
      "D'accord — **je n'active pas**. " +
      "Quand tu seras prêt : « active » (après sim), ou clairement « lance sans simulation »."
    );
  }

  const automationId = await resolveThreadAutomationId(userId, threadId);
  if (!automationId) {
    const thread = await getAgentThread(userId, threadId);
    if (thread?.purpose === "support") {
      return (
        "Aucune campagne Support n'est liée à ce fil. " +
        "Termine le brief puis dis « crée le brouillon » / « je valide », ensuite « active »."
      );
    }
    if (thread?.purpose === "groupes") {
      return (
        "Aucune diffusion groupes n'est liée à ce fil. " +
        "Pour un envoi ponctuel : send/schedule. Pour une campagne multi-jours : « je valide » après message + groupes, puis « active »."
      );
    }
    return (
      "Aucune campagne n'est liée à ce fil. " +
      "Valide d'abord les accroches (oui) pour créer le brouillon, ou ouvre une automatisation existante."
    );
  }

  const hasSim = recentHistoryHasSimulation(history);
  const skipSim = allowsActivateWithoutSimulation(userMessage);
  let simValidatedOnConfig = false;
  let isGroupBroadcast = false;
  try {
    const auto = await getAutomation(userId, automationId);
    simValidatedOnConfig = Boolean(auto?.config.simulationValidatedAt);
    isGroupBroadcast =
      auto?.type === "group_broadcast" || auto?.config.mode === "group_broadcast";
  } catch {
    /* ignore */
  }

  // Diffusion groupes : pas de téléphone / sim — on active directement.
  if (!isGroupBroadcast && !hasSim && !skipSim && !simValidatedOnConfig) {
    return (
      "Pour activer, il faut d'abord une **simulation** sur le téléphone (`simule`), " +
      "ou écrire clairement **« lance sans simulation »**."
    );
  }

  const raw = await executeTool(userId, threadId, "activate_automation", {
    automation_id: automationId,
    ...(!isGroupBroadcast && skipSim ? { allow_without_simulation: true } : {}),
    ...(isGroupBroadcast ? { allow_without_simulation: true } : {}),
  });
  const parsed = parseToolJson(raw);
  if (!parsed.ok) {
    return userFacingError(
      parsed.error ||
        "Impossible d'activer la campagne pour le moment. Vérifie WhatsApp / la mémoire, puis réessaie « active ».",
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

/** Intent d'activation (hors négation) — le garde-fou sim est dans runDeterministicActivation. */
export function shouldDeterministicActivate(
  history: AgentMessage[],
  userMessage: string
): boolean {
  const t = userMessage.trim();
  if (!t) return false;
  if (isActivationNegation(t)) return false;

  if (allowsActivateWithoutSimulation(t)) return true;

  if (/^(lance|lancer|active|activer|démarre|demarre|go)(\s|$|[!.])/i.test(t)) return true;
  if (
    /\b(active|activer|lance|lancer)\s+(?:(?:le[s]?|la|l[''])\s+)?(campagnes?|automatisations?|maintenant)\b/i.test(
      t,
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

/** Validation courte Support → brouillon déterministe. */
export function shouldDeterministicSupportDraft(
  userMessage: string,
  opts: { readyForDraft: boolean; stickersOk: boolean; thirdPartyOk: boolean; handoffOk: boolean }
): boolean {
  if (!opts.readyForDraft || !opts.stickersOk || !opts.thirdPartyOk || !opts.handoffOk) {
    return false;
  }
  const t = userMessage.trim();
  if (!t || t.length > 120) return false;
  if (isActivationNegation(t)) return false;
  if (
    /^(oui|ouais|ok|okay|d['’]accord|dac|parfait|valide|je\s+valide|c['’]est\s+bon|vas[- ]?y|go)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (looksLikeThirdPartyPhoneReply(t)) return true;
  return /\b(cr[eé]e|cr[eé]er|brouillon|valide|lance\s+le\s+brouillon)\b/i.test(t);
}

/** Outils « puissance » — jamais via args MiniMax bruts. */
export const POWER_CAMPAIGN_TOOLS = new Set([
  "create_automation",
  "show_campaign_simulation",
  "activate_automation",
]);
