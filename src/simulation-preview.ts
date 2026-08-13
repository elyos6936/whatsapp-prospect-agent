/**
 * Simulation interactive (panneau droit) — AUCUN envoi WhatsApp.
 * Même cerveau que les réponses live (`generateWhatsAppReply` + contexte campagne/playbook)
 * + mêmes garde-fous d'arrêt (STOP / désintérêt / objectif atteint).
 */
import {
  getAgentThread,
  getAppSettings,
  getAutomation,
  type Automation,
  type AutomationConfig,
  type AppSettings,
} from "./db.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";
import {
  generateWhatsAppReply,
  getStopConfirmationReply,
  isStopRequest,
} from "./whatsapp-reply.js";
import {
  formatCampaignMemoryForWhatsApp,
  formatLivePlaybookForWhatsApp,
  getLinkedMemoryForAutomation,
  persistLivePlaybookForThread,
  previewHistoryToPlaybookTurns,
} from "./campaign-sync.js";
import {
  isCampaignObjectiveReached,
  wasVerballyClosed,
  isAffirmingPendingSendOffer,
  ensurePendingLinkInReply,
  alignOutboundVerbalClose,
} from "./lead-scoring.js";
import { fulfillOutboundPromises } from "./outbound-promise-guard.js";
import {
  getObjectiveReachedReply,
  getStopFarewellReply,
  shouldSilenceAfterFarewell,
  shouldStopConversation,
  stopReasonLabel,
  type StopReason,
} from "./stop-policy.js";
import { buildSupportConversationGuide } from "./support-flow.js";

export type SimPreviewTurn = {
  role: "you" | "prospect";
  text: string;
};

export type SimPreviewStopReason =
  | "max_turns"
  | "stop_keyword"
  | "objective_reached"
  | StopReason;

const MAX_TURNS = 20;

function toPolicyHistory(
  turns: SimPreviewTurn[]
): Array<{ direction: string; body: string }> {
  return turns.map((t) => ({
    direction: t.role === "you" ? "sortant" : "entrant",
    body: t.text,
  }));
}

function stopFeedback(reason: SimPreviewStopReason): string {
  if (reason === "max_turns") {
    return (
      "Fin de la simulation (max 20 messages).\n\n" +
      "Dis-moi ce qui va / ce qu'il faut changer (ton, accroche, CTA…), puis on recommence ici. Si c'est bon, valide dans le chat du milieu."
    );
  }
  if (reason === "stop_keyword") {
    return (
      "Simulation clôturée (comme en live) : le prospect a demandé d'arrêter.\n\n" +
      "Dis dans le chat ce qu'il faut ajuster, ou « c'est bon »."
    );
  }
  if (reason === "objective_reached") {
    return (
      "Simulation clôturée (comme en live) : objectif campagne atteint.\n\n" +
      "Dis dans le chat ce qu'il faut ajuster, ou « c'est bon »."
    );
  }
  return (
    `Simulation clôturée (comme en live) : ${stopReasonLabel(reason)}.\n\n` +
    "Dis dans le chat ce qu'il faut ajuster, ou « c'est bon »."
  );
}

export function extractOpenerFromPlan(plan: {
  nodes?: Array<{ kind?: string; label?: string; subtitle?: string }>;
}): string {
  const nodes = plan.nodes ?? [];
  const msg = nodes.find((n) => n.kind === "message" || /message|accroche|opener/i.test(n.label ?? ""));
  const text = (msg?.subtitle || msg?.label || "").trim();
  return text || "Bonjour ! Je me permets de vous écrire rapidement 🙂";
}

function buildSimCampaignContext(
  auto: Automation,
  extras: {
    memoryBlock?: string;
    playbookBlock?: string;
    guideOverride?: string;
    mode?: "outbound" | "inbound";
  }
): string {
  const cfg = auto.config;
  const guide = extras.guideOverride?.trim() || cfg.conversationGuide || "";
  const outbound = extras.mode !== "inbound";
  const mediaHint = cfg.mediaUrl
    ? `Photo / média produit disponible (sera envoyé en live si le client demande) : ${cfg.mediaUrl}`
    : "";
    const lines = [
    `=== CAMPAGNE (simulation = même cadre que le live) : « ${auto.name} » ===`,
    `Mode : ${outbound ? "prospection SORTANTE (tu as initié)" : "support / closing ENTRANT (le client a initié)"}`,
    outbound && cfg.initialMessage
      ? `Premier message (opener sortant) : « ${cfg.initialMessage} »`
      : "",
    !outbound && cfg.initialMessage
      ? `Réponse type / ton de référence (PAS un opener à coller) : « ${cfg.initialMessage} »`
      : "",
    !outbound
      ? buildSupportConversationGuide({
          catchAll: Boolean(cfg.inboundCatchAll),
          triggers: (cfg.triggerPhrases || cfg.keywords || []).map(String),
          handoffKeywords: cfg.handoffKeywords,
          productHint: cfg.productName,
          price: cfg.price,
          link: cfg.closingLink,
          closingGoal: cfg.closingGoal,
        })
      : "",
    guide ? `TON & APPROCHE :\n${guide}` : "",
    cfg.productName ? `Produit / offre : ${cfg.productName}` : "",
    cfg.price
      ? `Prix EXACT : ${cfg.price}`
      : `Prix : NON RENSEIGNÉ — si demandé, dis que tu confirmes juste après.`,
    cfg.closingLink
      ? `Lien (seul autorisé) : ${cfg.closingLink}`
      : `Lien : AUCUN — INTERDIT d'inventer une URL.`,
    cfg.salesScript ? `Argumentaire : ${cfg.salesScript}` : "",
    mediaHint,
    extras.memoryBlock ? `\n${extras.memoryBlock}` : "",
    extras.playbookBlock ? `\n${extras.playbookBlock}` : "",
    "",
    `Tu es en SIMULATION téléphone — 0 envoi réel — mais tes réponses doivent être`,
    `IDENTIQUES à ce que tu écrirais à un vrai ${outbound ? "prospect" : "client"} (même playbook, même ton).`,
    outbound
      ? `IMPORTANT SORTANT : TU as initié. Si le prospect répond « salut / hello / ok », INTERDIT de te présenter (nom + bio). Enchaîne 1 question concrète liée à la mission.`
      : [
          `IMPORTANT ENTRANT (support) : LE CLIENT a écrit en premier. Tu gères le compte / la boutique.`,
          `La mémoire liée peut parler de prospection — IGNORE toute consigne de cold outreach / accroche / qualification « secteur » / « type de tâche ».`,
          `INTERDIT : « Bonjour, c'est X, je vous contacte… », inventer https://example.com ou tout faux lien.`,
          `Si le client montre de l'intérêt : remercie + prix/produit + next step (souvent lieu de livraison).`,
          `Si « ok / okay / 1 » : traite la réponse puis demande le lieu de livraison si pas encore donné — PAS un lien inventé.`,
          `Si le client demande une photo et qu'un média est en config : confirme que tu l'envoies (en simu : dis-le en texte).`,
        ].join(" "),
    `ARRÊT (identique au live) : refus d'intérêt → clôture. Objectif atteint (lien réel livré / handoff livreur / preuve paiement + ack) → courte confirmation puis stop. Ne répète jamais une question déjà posée.`,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function replyInSimulationPreview(
  userId: number,
  input: {
    opener: string;
    history: SimPreviewTurn[];
    prospectMessage: string;
    guide?: string;
    offer?: string;
    mode?: "outbound" | "inbound";
    /** Fil agent — pour charger campagne + persister le playbook. */
    threadId?: number | null;
  }
): Promise<{
  reply: string;
  history: SimPreviewTurn[];
  done: boolean;
  feedbackPrompt: string | null;
  stopReason?: SimPreviewStopReason | null;
}> {
  const prospectMessage = String(input.prospectMessage ?? "").trim();
  if (!prospectMessage) {
    throw new Error("Message prospect requis.");
  }

  const mode = input.mode === "inbound" ? "inbound" : "outbound";
  const opener =
    sanitizeOutboundWhatsAppText(String(input.opener ?? "").trim()) ||
    (mode === "outbound"
      ? "Bonjour ! Je me permets de vous écrire rapidement 🙂"
      : "");

  let history: SimPreviewTurn[] = Array.isArray(input.history) ? [...input.history] : [];
  if (history.length === 0 && mode === "outbound" && opener) {
    history.push({ role: "you", text: opener });
  }
  history.push({ role: "prospect", text: prospectMessage });

  if (history.length >= MAX_TURNS) {
    return {
      reply: "",
      history: history.slice(0, MAX_TURNS),
      done: true,
      stopReason: "max_turns",
      feedbackPrompt: stopFeedback("max_turns"),
    };
  }

  const threadId =
    input.threadId != null && Number.isFinite(input.threadId)
      ? Number(input.threadId)
      : null;

  let automationContext = "";
  let campaignConfig: AutomationConfig | undefined;
  let settings: AppSettings | null = null;

  if (threadId != null) {
    const thread = await getAgentThread(userId, threadId);
    const automationId = thread?.automation_id ?? null;
    if (automationId != null) {
      const auto = await getAutomation(userId, automationId);
      if (auto) {
        campaignConfig = auto.config;
        let memoryBlock = "";
        try {
          const mem = await getLinkedMemoryForAutomation(userId, automationId);
          if (mem) memoryBlock = formatCampaignMemoryForWhatsApp(mem);
        } catch {
          /* ignore */
        }
        let playbookBlock = "";
        const pb = auto.config.livePlaybook;
        if (pb?.turns?.length) {
          playbookBlock = formatLivePlaybookForWhatsApp(pb, {
            inbound: mode === "inbound",
          });
        }
        automationContext = buildSimCampaignContext(auto, {
          memoryBlock,
          playbookBlock,
          guideOverride: input.guide,
          mode,
        });
      }
    }
  }

  if (!settings) {
    settings = await getAppSettings(userId);
  }

  if (!automationContext) {
    const offer = input.offer?.trim() || settings.business_offer || "";
    const price = settings.business_price || "";
    const guide = input.guide?.trim() || "";
    automationContext = [
      "=== SIMULATION (cadre générique) ===",
      offer ? `Offre : ${offer}` : "",
      price ? `Prix : ${price}` : "",
      guide ? `Guide :\n${guide}` : "",
      "Reste dans ce cadre. 0 envoi WhatsApp réel.",
      mode === "outbound"
        ? "SORTANT : tu as initié — si réponse « salut/hello », continue ton fil (ne parle pas comme s'il t'avait contacté)."
        : "ENTRANT : le client a initié — accueille / aide, PAS d'intro « je vous contacte pour… ».",
      "ARRÊT (identique au live) : refus / STOP / objectif atteint → clôture.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Même ordre que runAutoReply (live) — avant le LLM.
  const priorPolicyHistory = toPolicyHistory(history.slice(0, -1));
  const business = {
    offer: settings.business_offer,
    price: settings.business_price,
    ownerName: settings.business_owner_name,
  };

  const finishClosed = async (
    replyText: string,
    reason: SimPreviewStopReason
  ): Promise<{
    reply: string;
    history: SimPreviewTurn[];
    done: boolean;
    feedbackPrompt: string | null;
    stopReason: SimPreviewStopReason;
  }> => {
    const reply = sanitizeOutboundWhatsAppText(replyText);
    if (reply) history.push({ role: "you", text: reply });
    if (threadId != null && history.length >= 2) {
      try {
        const turns = previewHistoryToPlaybookTurns(history);
        if (turns.length >= 2) {
          await persistLivePlaybookForThread(userId, threadId, turns, {
            // Support : ne pas écraser l'opener campagne avec la 1ʳᵉ réponse agent.
            syncOpener: mode === "outbound" && history.some((h) => h.role === "you"),
          });
        }
      } catch (err) {
        console.warn("[simulation-preview] persist playbook:", err);
      }
    }
    return {
      reply,
      history,
      done: true,
      stopReason: reason,
      feedbackPrompt: stopFeedback(reason),
    };
  };

  if (isStopRequest(prospectMessage)) {
    return finishClosed(getStopConfirmationReply(), "stop_keyword");
  }

  const softStop = shouldStopConversation(
    prospectMessage,
    business,
    campaignConfig,
    priorPolicyHistory
  );
  const actionableStop =
    softStop && softStop !== "unknown_question" ? softStop : null;
  if (actionableStop) {
    if (shouldSilenceAfterFarewell(prospectMessage, priorPolicyHistory)) {
      return finishClosed("", actionableStop);
    }
    return finishClosed(getStopFarewellReply(actionableStop), actionableStop);
  }

  if (isCampaignObjectiveReached(prospectMessage, priorPolicyHistory, campaignConfig)) {
    if (wasVerballyClosed(priorPolicyHistory)) {
      return finishClosed("", "objective_reached");
    }
    return finishClosed(getObjectiveReachedReply(), "objective_reached");
  }

  // Historique factice pour le formatage du prompt live (même moteur).
  const syntheticChatId = `sim-preview-${userId}-${threadId ?? "x"}@s.whatsapp.net`;
  const transcriptHint = history
    .slice(0, -1)
    .map((t) => `${t.role === "you" ? "Toi" : mode === "inbound" ? "Client" : "Prospect"}: ${t.text}`)
    .join("\n");

  const enrichedContext =
    automationContext +
    (transcriptHint
      ? `\n\n=== HISTORIQUE SIMULATION (à respecter comme un vrai fil) ===\n${transcriptHint}`
      : "");

  let reply = "";
  try {
    const affirmingLink = isAffirmingPendingSendOffer(
      prospectMessage,
      priorPolicyHistory
    );
    reply = await generateWhatsAppReply(userId, {
      chatId: syntheticChatId,
      senderName: mode === "inbound" ? "Client" : "Prospect",
      incomingText: prospectMessage,
      automationContext: enrichedContext,
      allowEmojis: false,
      automationId: null,
      // Inbound : dès le 1er message client, pas de mode « salutation opener sortant ».
      forceOngoing: mode === "inbound" || history.length > 1,
      conversationMode: mode,
      closingLink: campaignConfig?.closingLink,
      closingGoal: campaignConfig?.closingGoal,
      configuredPrice: campaignConfig?.price || settings.business_price,
      forceDeliverPendingLink: affirmingLink,
      toneSources: [
        campaignConfig?.initialMessage,
        campaignConfig?.conversationGuide,
        campaignConfig?.livePlaybook?.openerSnapshot,
        ...history.filter((h) => h.role === "you").map((h) => h.text),
      ],
      knownLinkSources: [
        campaignConfig?.initialMessage,
        campaignConfig?.conversationGuide,
        campaignConfig?.closingLink,
        ...(campaignConfig?.abVariants?.map((v) => v.message) ?? []),
      ],
    });
    reply = ensurePendingLinkInReply(
      reply,
      campaignConfig?.closingLink,
      prospectMessage,
      priorPolicyHistory
    );
    {
      const { sanitizeInventedCampaignUrls } = await import("./outbound-sanitize.js");
      reply = sanitizeInventedCampaignUrls(reply, {
        allowedLink: campaignConfig?.closingLink,
        closingGoal: campaignConfig?.closingGoal,
        knownLinkSources: [
          campaignConfig?.initialMessage,
          campaignConfig?.conversationGuide,
          campaignConfig?.closingLink,
          ...(campaignConfig?.abVariants?.map((v) => v.message) ?? []),
        ],
      });
    }
    reply = alignOutboundVerbalClose(
      reply,
      prospectMessage,
      priorPolicyHistory,
      campaignConfig
    ).reply;
    {
      const promised = fulfillOutboundPromises(reply, {
        closingLink: campaignConfig?.closingLink,
        hasMedia: !!campaignConfig?.mediaUrl,
      });
      if (promised.appendLink) {
        console.warn("[simulation] promise-link-fulfilled");
      }
      if (promised.strippedLinkPromise) {
        console.warn("[simulation] promise-link-stripped");
      }
      if (promised.strippedMediaPromise) {
        console.warn("[simulation] promise-media-stripped");
      }
      reply = promised.reply;
    }
  } catch {
    reply =
      mode === "inbound"
        ? "Bonjour ! Dites-moi ce dont vous avez besoin."
        : "Merci pour votre message. Vous pouvez m'en dire un peu plus ?";
  }

  reply = sanitizeOutboundWhatsAppText(reply);
  if (!reply) {
    reply =
      mode === "inbound"
        ? "Bonjour ! Dites-moi ce dont vous avez besoin."
        : "Merci pour votre message. Vous pouvez m'en dire un peu plus ?";
  }

  history.push({ role: "you", text: reply });

  // Synchronise le playbook campagne = ce qui a été testé sur le téléphone.
  if (threadId != null && history.length >= 2) {
    try {
      const turns = previewHistoryToPlaybookTurns(history);
      if (turns.length >= 2) {
        await persistLivePlaybookForThread(userId, threadId, turns, {
          syncOpener: mode === "outbound" && history.some((h) => h.role === "you"),
        });
      }
    } catch (err) {
      console.warn("[simulation-preview] persist playbook:", err);
    }
  }

  const done = history.length >= MAX_TURNS;
  return {
    reply,
    history,
    done,
    stopReason: done ? "max_turns" : null,
    feedbackPrompt: done ? stopFeedback("max_turns") : null,
  };
}
