/**
 * Simulation interactive (panneau droit) — AUCUN envoi WhatsApp.
 * Même cerveau que les réponses live (`generateWhatsAppReply` + contexte campagne/playbook).
 */
import {
  getAgentThread,
  getAppSettings,
  getAutomation,
  type Automation,
} from "./db.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";
import { generateWhatsAppReply } from "./whatsapp-reply.js";
import {
  formatCampaignMemoryForWhatsApp,
  formatLivePlaybookForWhatsApp,
  getLinkedMemoryForAutomation,
  persistLivePlaybookForThread,
  previewHistoryToPlaybookTurns,
} from "./campaign-sync.js";

export type SimPreviewTurn = {
  role: "you" | "prospect";
  text: string;
};

const MAX_TURNS = 20;

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
    `IDENTIQUES à ce que tu écrirais à un vrai prospect (même playbook, même ton).`,
    outbound
      ? `IMPORTANT : c'est une prospection SORTANTE — TU as initié avec le premier message. Si le prospect répond juste « salut / hello / ok », continue le fil que TU as ouvert ; ne parle pas comme s'il t'avait contacté.`
      : "",
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
      feedbackPrompt:
        "Fin de la simulation (max 20 messages).\n\nDis-moi ce qui va / ce qu'il faut changer (ton, accroche, CTA…), puis on recommence ici. Si c'est bon, valide dans le chat du milieu.",
    };
  }

  const threadId =
    input.threadId != null && Number.isFinite(input.threadId)
      ? Number(input.threadId)
      : null;

  let automationContext = "";
  let automationId: number | null = null;

  if (threadId != null) {
    const thread = await getAgentThread(userId, threadId);
    automationId = thread?.automation_id ?? null;
    if (automationId != null) {
      const auto = await getAutomation(userId, automationId);
      if (auto) {
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

  if (!automationContext) {
    const settings = await getAppSettings(userId);
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
    ]
      .filter(Boolean)
      .join("\n");
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
    feedbackPrompt: done
      ? "Fin de la simulation (max 20 messages). Dis dans le chat ce qu'il faut changer, ou « c'est bon »."
      : null,
  };
}
