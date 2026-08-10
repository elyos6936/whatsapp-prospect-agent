import OpenAI from "openai";
import { config } from "./config.js";
import {
  createLlmClient,
  extractAssistantContent,
  llmChatExtras,
} from "./llm.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { getUserById } from "./users.js";
import {
  appendSupportMessage,
  getOrCreateActiveSupportTicket,
  listSupportMessages,
  updateSupportTicket,
  type SupportMessage,
  type SupportTicket,
} from "./support-store.js";
import {
  getConnectedOwnerId,
  normalizePhoneToChatId,
  sendWhatsAppMessage,
} from "./evolutionapi.js";

const GRACE_SYSTEM = `Tu es Grace, assistante support client de Klanvio (plateforme d'agent WhatsApp IA pour la prospection).
Tu réponds en français, ton clair, chaleureux et concis (2–6 phrases max sauf si une liste courte aide).

Base de connaissances Klanvio :
- Connexion WhatsApp perso via QR (comme WhatsApp Web) — le numéro reste celui du client.
- Anti-blocage : rythme d'envoi maîtrisé, refus des actions risquées, arrêt intelligent.
- L'IA ne répond pas à tout le monde : seulement aux prospects des campagnes ou aux messages-clés (e-commerce).
- Prospection : un contact, une liste, ou les membres d'un groupe ; plafonds journaliers / essai.
- Essai gratuit : 3 jours, 50 conversations à vie, 1 extraction de groupe WhatsApp / jour.
- Intégrations : Google Contacts, Sheets, Typeform, Calendly, Tally.
- Équipe & rôles : réservés à l'abonnement actif.
- Facturation : abonnement via Money Fusion ; contact support humain si problème de paiement.
- Contact email : contact@klanvio.com

Règles de décision :
- Si la question est banale / FAQ / usage simple de Klanvio → action "reply".
- Si c'est un bug bloquant, un remboursement, un litige facturation, une demande technique hors FAQ, une plainte, ou si tu n'es pas sûre → action "escalate".
- Demandes de feature : reply avec empathie + indique qu'un humain peut relayer ; escalate si le client insiste pour un suivi humain.

Tu DOIS répondre UNIQUEMENT avec un JSON valide (pas de markdown) de la forme :
{"action":"reply"|"escalate","message":"...","reason":"optionnel si escalate","subject":"titre court optionnel"}

Le champ "message" est TOUJOURS le texte montré à l'utilisateur.
- En cas d'escalate, message doit prévenir qu'un humain va répondre dans ce chat d'aide (pas sur WhatsApp).`;

export type SupportChatResult = {
  ticket: SupportTicket;
  messages: SupportMessage[];
  assistantMessage: SupportMessage;
  escalated: boolean;
};

function parseBotJson(raw: string): {
  action: "reply" | "escalate";
  message: string;
  reason?: string;
  subject?: string;
} | null {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const action = parsed.action === "escalate" ? "escalate" : "reply";
    const message = String(parsed.message ?? "").trim();
    if (!message) return null;
    return {
      action,
      message: message.slice(0, 4000),
      reason: parsed.reason != null ? String(parsed.reason).slice(0, 500) : undefined,
      subject: parsed.subject != null ? String(parsed.subject).slice(0, 120) : undefined,
    };
  } catch {
    return null;
  }
}

function absoluteUploadUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = config.publicUrl.replace(/\/$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

async function notifyHandoffWhatsApp(input: {
  ticket: SupportTicket;
  userLabel: string;
  userMessage: string;
  reason?: string;
}): Promise<void> {
  const opsUserId = config.supportWhatsAppUserId;
  const chatId = normalizePhoneToChatId(config.supportHandoffPhone);
  const inboxUrl = `${config.publicUrl.replace(/\/$/, "")}/support`;
  const body =
    `🛟 Support Klanvio — nouvelle demande #${input.ticket.id}\n` +
    `Client : ${input.userLabel}\n` +
    (input.ticket.client_phone ? `WA client : ${input.ticket.client_phone}\n` : "") +
    (input.reason ? `Motif : ${input.reason}\n` : "") +
    `\nDernier message :\n${input.userMessage.slice(0, 800)}\n\n` +
    `Inbox : ${inboxUrl}`;
  try {
    await sendWhatsAppMessage(opsUserId, chatId, body, {
      enableAutoReply: false,
      countsTowardQuota: false,
      bypassOutboundGates: true,
      outboundProfile: "auto_reply",
    });
  } catch (err) {
    console.error("[support] Échec notif handoff WhatsApp:", err);
  }
}

async function runGraceDecision(input: {
  history: SupportMessage[];
  userText: string;
  imageUrls: string[];
}): Promise<{ action: "reply" | "escalate"; message: string; reason?: string; subject?: string }> {
  const apiKey = config.envOpenAiKey;
  if (!apiKey) {
    return {
      action: "escalate",
      message:
        "Je transmets votre demande à un membre de l'équipe Klanvio. Un humain va vous répondre ici, dans ce chat d'aide.",
      reason: "llm_unavailable",
    };
  }

  const historyLines = input.history
    .slice(-16)
    .map((m) => {
      const who =
        m.role === "user" ? "Client" : m.role === "ops" ? "Support humain" : "Grace";
      const imgs = m.image_urls.length ? ` [images: ${m.image_urls.length}]` : "";
      return `${who}: ${m.content}${imgs}`;
    })
    .join("\n");

  const userBlock =
    input.userText +
    (input.imageUrls.length
      ? `\n[Le client a joint ${input.imageUrls.length} image(s) : ${input.imageUrls.map(absoluteUploadUrl).join(", ")}]`
      : "");

  try {
    const client = createLlmClient(apiKey);
    const completion = await callOpenAiWithRetry(() =>
      client.chat.completions.create({
        model: config.openaiModel,
        temperature: 1,
        max_tokens: 700,
        ...llmChatExtras({ enableThinking: false }),
        messages: [
          { role: "system", content: GRACE_SYSTEM },
          {
            role: "user",
            content:
              (historyLines ? `Historique:\n${historyLines}\n\n` : "") +
              `Nouveau message du client:\n${userBlock}`,
          },
        ],
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
    );

    const raw = extractAssistantContent(completion.choices[0]?.message);
    const parsed = parseBotJson(raw);
    if (parsed) return parsed;

    const fallback = raw.trim().slice(0, 2000);
    if (fallback) {
      return { action: "reply", message: fallback };
    }
  } catch (err) {
    console.error("[support] Grace LLM error:", err);
  }

  return {
    action: "escalate",
    message:
      "Je n'ai pas pu traiter cette demande automatiquement. Un humain de l'équipe Klanvio va vous répondre ici, dans ce chat d'aide.",
    reason: "llm_error",
  };
}

export async function handleSupportUserChat(
  userId: number,
  input: { message?: string; imageUrls?: string[]; ticketId?: number }
): Promise<SupportChatResult> {
  const text = String(input.message ?? "").trim();
  const imageUrls = (input.imageUrls ?? []).map(String).filter(Boolean).slice(0, 8);
  if (!text && imageUrls.length === 0) {
    throw new Error("Message ou image requis.");
  }

  let clientPhone: string | null = null;
  try {
    clientPhone = await getConnectedOwnerId(userId);
  } catch {
    clientPhone = null;
  }

  const ticket = await getOrCreateActiveSupportTicket(userId, {
    clientPhone,
    subject: text ? text.slice(0, 80) : "Support Klanvio",
  });

  const userContent = text || "(image jointe)";
  await appendSupportMessage({
    ticketId: ticket.id,
    role: "user",
    content: userContent,
    imageUrls,
  });

  const history = await listSupportMessages(ticket.id);
  const decision = await runGraceDecision({
    history: history.slice(0, -1),
    userText: userContent,
    imageUrls,
  });

  let escalated = decision.action === "escalate";
  let replyText = decision.message;

  if (escalated) {
    const updated = await updateSupportTicket(ticket.id, {
      status: "open",
      handoffReason: decision.reason ?? "escalated",
      summary: userContent.slice(0, 400),
      subject: decision.subject || ticket.subject,
      clientPhone: clientPhone ?? ticket.client_phone,
    });
    const user = await getUserById(userId);
    const userLabel =
      [user?.name, user?.email].filter(Boolean).join(" · ") || `user #${userId}`;
    await notifyHandoffWhatsApp({
      ticket: updated ?? ticket,
      userLabel,
      userMessage: userContent,
      reason: decision.reason,
    });
    if (!/humain|relais|équipe|chat d'aide|ici/i.test(replyText)) {
      replyText =
        replyText +
        "\n\nUn membre de l'équipe Klanvio va vous répondre ici, dans ce chat d'aide.";
    }
  } else if (ticket.status === "done") {
    await updateSupportTicket(ticket.id, { status: "pending" });
  }

  const assistantMessage = await appendSupportMessage({
    ticketId: ticket.id,
    role: "assistant",
    content: replyText,
  });

  const messages = await listSupportMessages(ticket.id);
  const { getSupportTicketById } = await import("./support-store.js");
  const fresh = (await getSupportTicketById(ticket.id)) ?? ticket;

  return {
    ticket: fresh,
    messages,
    assistantMessage,
    escalated,
  };
}

export async function sendOpsSupportReply(
  ticketId: number,
  message: string
): Promise<{ ticket: SupportTicket; message: SupportMessage }> {
  const text = message.trim();
  if (!text) throw new Error("Message requis.");

  const { getSupportTicketById } = await import("./support-store.js");
  const ticket = await getSupportTicketById(ticketId);
  if (!ticket) throw new Error("Ticket introuvable.");

  // Réponse humaine → uniquement dans la bulle d’aide (pas d’envoi WhatsApp client).
  const saved = await appendSupportMessage({
    ticketId: ticket.id,
    role: "ops",
    content: text,
  });

  const updated =
    (await updateSupportTicket(ticket.id, {
      status: ticket.status === "done" ? "open" : ticket.status === "pending" ? "open" : ticket.status,
      summary: text.slice(0, 400),
    })) ?? ticket;

  return { ticket: updated, message: saved };
}
