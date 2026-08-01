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
} from "./lead-scoring.js";
import {
  getObjectiveReachedReply,
  getStopFarewellReply,
  shouldStopConversation,
  stopReasonLabel,
  type StopReason,
} from "./stop-policy.js";

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
  const lines = [
    `=== CAMPAGNE (simulation = même cadre que le live) : « ${auto.name} » ===`,
    cfg.initialMessage
      ? `Premier message : « ${cfg.initialMessage} »`
      : "",
    guide ? `TON & APPROCHE :\n${guide}` : "",
    cfg.productName ? `Produit / offre : ${cfg.productName}` : "",
    cfg.price
      ? `Prix EXACT : ${cfg.price}`
      : `Prix : NON RENSEIGNÉ — si demandé, dis que tu confirmes juste après.`,
    cfg.closingLink ? `Lien : ${cfg.closingLink}` : "",
    cfg.salesScript ? `Argumentaire : ${cfg.salesScript}` : "",
    extras.memoryBlock ? `\n${extras.memoryBlock}` : "",
    extras.playbookBlock ? `\n${extras.playbookBlock}` : "",
    "",
    `Tu es en SIMULATION téléphone — 0 envoi réel — mais tes réponses doivent être`,
    `IDENTIQUES au live (même playbook, même ton, même pacing).`,
    `Identité (« c'est qui ? ») → prénom business + pourquoi on écrit EN UN SOUFFLE (pas nom seul).`,
    `Accusé minimal (« ok » / « okay ») → pas de pitch immédiat : question concrète OU détail nouveau.`,
    outbound
      ? `IMPORTANT SORTANT : TU as initié. Si le prospect répond « salut / hello / ok », NE RECOPIE PAS le prochain tour du playbook (souvent une fausse intro « ravi d'échanger »). Continue ton accroche avec 1 question concrète.`
      : "",
    `ARRÊT (identique au live) : refus clair / STOP → clôture. Objectif atteint (lien/prix/RDV + ack) → courte confirmation puis stop — pas de question supplémentaire.`,
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
          playbookBlock = formatLivePlaybookForWhatsApp(pb);
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
        : "",
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
            syncOpener: history.some((h) => h.role === "you"),
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
    .map((t) => `${t.role === "you" ? "Toi" : "Prospect"}: ${t.text}`)
    .join("\n");

  const enrichedContext =
    automationContext +
    (transcriptHint
      ? `\n\n=== HISTORIQUE SIMULATION (à respecter comme un vrai fil) ===\n${transcriptHint}`
      : "");

  let reply = "";
  try {
    reply = await generateWhatsAppReply(userId, {
      chatId: syntheticChatId,
      senderName: "Prospect",
      incomingText: prospectMessage,
      automationContext: enrichedContext,
      allowEmojis: false,
      automationId: null,
      forceOngoing: history.length > 1,
    });
  } catch {
    reply = "Merci pour votre message. Vous pouvez m'en dire un peu plus ?";
  }

  reply = sanitizeOutboundWhatsAppText(reply);
  if (!reply) {
    reply = "Merci pour votre message. Vous pouvez m'en dire un peu plus ?";
  }

  history.push({ role: "you", text: reply });

  // Synchronise le playbook campagne = ce qui a été testé sur le téléphone.
  if (threadId != null && history.length >= 2) {
    try {
      const turns = previewHistoryToPlaybookTurns(history);
      if (turns.length >= 2) {
        await persistLivePlaybookForThread(userId, threadId, turns, {
          syncOpener: history.some((h) => h.role === "you"),
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
