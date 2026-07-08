import { getGreenApiCredentials, chatIdToDisplay, sendWhatsAppMessage, type GreenApiCredentials } from "./greenapi.js";
import {
  getAppSettings,
  saveWhatsAppMessage,
  whatsAppMessageExists,
  isAutoReplyEnabled,
  shouldAutoReplyContact,
  isContactBlocked,
  blockContact,
  touchIncomingContact,
} from "./db.js";
import {
  generateWhatsAppReply,
  getAdaptiveReplyDelay,
  getStopConfirmationReply,
  isPromptInjection,
  isStopRequest,
  nowFr,
} from "./whatsapp-reply.js";

interface ReceiveNotificationResponse {
  receiptId?: number;
  body?: {
    typeWebhook?: string;
    idMessage?: string;
    senderData?: {
      chatId?: string;
      sender?: string;
      senderName?: string;
      chatName?: string;
    };
    messageData?: {
      typeMessage?: string;
      textMessageData?: { textMessage?: string };
      extendedTextMessageData?: { text?: string };
    };
  };
}

function buildUrl(creds: GreenApiCredentials, method: string, suffix = ""): string {
  return `${creds.baseUrl}/waInstance${creds.idInstance}/${method}/${creds.apiToken}${suffix}`;
}

function extractText(body: NonNullable<ReceiveNotificationResponse["body"]>): string | null {
  const md = body.messageData;
  if (!md) return null;

  if (md.typeMessage === "textMessage" && md.textMessageData?.textMessage) {
    return md.textMessageData.textMessage;
  }
  if (md.extendedTextMessageData?.text) {
    return md.extendedTextMessageData.text;
  }
  return null;
}

function shouldProcess(body: ReceiveNotificationResponse["body"]): boolean {
  if (!body || body.typeWebhook !== "incomingMessageReceived") return false;

  const chatId = body.senderData?.chatId ?? "";
  if (chatId.endsWith("@g.us")) return false;

  const type = body.messageData?.typeMessage ?? "";
  if (type === "reactionMessage" || type === "deletedMessage") return false;

  return type === "textMessage" || type === "extendedTextMessage" || Boolean(extractText(body));
}

async function fetchNotification(
  creds: GreenApiCredentials
): Promise<ReceiveNotificationResponse | null> {
  const url = buildUrl(creds, "receiveNotification");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();

    if (!text || text === "null" || text === "{}") return null;

    let data: ReceiveNotificationResponse;
    try {
      data = JSON.parse(text) as ReceiveNotificationResponse;
    } catch {
      return null;
    }

    if (!data.receiptId || !data.body) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteNotification(creds: GreenApiCredentials, receiptId: number): Promise<void> {
  const url = buildUrl(creds, "deleteNotification", `/${receiptId}`);
  try {
    await fetch(url, { method: "DELETE" });
  } catch {
    /* best effort */
  }
}

const pendingReplies = new Set<string>();

/**
 * Conversations prospects = base SQLite (table messages).
 * On ne pollue plus le chat « Agent » avec chaque échange WhatsApp.
 */
async function handleAutoReply(chatId: string, senderName: string, text: string): Promise<void> {
  if (!shouldAutoReplyContact(chatId)) {
    const reason = isContactBlocked(chatId)
      ? "STOP"
      : !isAutoReplyEnabled()
        ? "auto globale OFF"
        : "auto contact OFF";
    console.log(`📩 ${senderName} (pas de réponse — ${reason}): ${text.slice(0, 40)}`);
    return;
  }

  if (isPromptInjection(text)) {
    console.warn(`⚠️ Injection détectée de ${senderName} — ignorée`);
    return;
  }

  if (pendingReplies.has(chatId)) return;
  pendingReplies.add(chatId);

  const delay = getAdaptiveReplyDelay(chatId);
  console.log(`⏳ Réponse auto à ${senderName} dans ${Math.round(delay / 1000)}s…`);

  await new Promise((r) => setTimeout(r, delay));

  try {
    let reply: string;

    if (isStopRequest(text)) {
      reply = getStopConfirmationReply();
      blockContact(chatId);
    } else {
      reply = await generateWhatsAppReply({ chatId, senderName, incomingText: text });
    }

    const sent = await sendWhatsAppMessage(chatId, reply);
    console.log(`✅ Réponse → ${senderName} à ${nowFr()} (${sent.idMessage})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Réponse auto échouée pour ${senderName}:`, msg);
  } finally {
    pendingReplies.delete(chatId);
  }
}

export async function pollOneNotification(): Promise<number> {
  const settings = getAppSettings();
  if (!settings.green_api_id_instance || !settings.green_api_token) return 0;

  const creds = getGreenApiCredentials();
  if (!creds) return 0;

  let processed = 0;
  const notification = await fetchNotification(creds);
  if (!notification?.receiptId || !notification.body) return 0;

  const { receiptId, body } = notification;

  if (shouldProcess(body)) {
    const text = extractText(body);
    if (text) {
      const chatId = body.senderData?.chatId ?? body.senderData?.sender ?? "inconnu";
      const greenApiId = body.idMessage ?? `receipt-${receiptId}`;
      const senderName = body.senderData?.senderName || chatIdToDisplay(chatId);

      if (!whatsAppMessageExists(greenApiId)) {
        saveWhatsAppMessage({
          contactPhone: chatId,
          direction: "entrant",
          body: text,
          greenApiId,
          senderName,
        });

        try {
          touchIncomingContact(chatId, senderName);
        } catch (err) {
          console.error("Erreur upsert contact:", err);
        }

        processed++;
        console.log(`📩 WhatsApp entrant de ${senderName}: ${text.slice(0, 60)}…`);

        void handleAutoReply(chatId, senderName, text);
      }
    }
  }

  await deleteNotification(creds, receiptId);
  return processed;
}

let polling = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startNotificationPoller(intervalMs = 3000): void {
  if (intervalHandle) return;

  console.log(`🔔 Polling messages entrants Green-API (toutes les ${intervalMs / 1000}s)`);
  console.log(`🤖 Réponses automatiques : ${isAutoReplyEnabled() ? "activées" : "désactivées"}`);
  console.log(`📦 Conversations prospects → SQLite (data/agent.db), pas le chat agent`);

  intervalHandle = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      for (let i = 0; i < 5; i++) {
        const n = await pollOneNotification();
        if (n === 0) break;
      }
    } catch (err) {
      console.error("Erreur polling Green-API:", err);
    } finally {
      polling = false;
    }
  }, intervalMs);
}

export function stopNotificationPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
