import type { FastifyInstance } from "fastify";
import {
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
  getRecentIncomingMessages,
  getWhatsAppMessageStats,
  listAllIncomingMessages,
} from "./db.js";
import {
  ALLOWED_GREEN_API_METHODS,
  findGreenApiMethod,
  GREEN_API_CATEGORIES,
  GREEN_API_METHODS,
} from "./greenapi-catalog.js";
import {
  callGreenApi,
  chatIdToDisplay,
  getChatHistory,
  getLastIncomingMessages,
  getGreenApiCredentials,
  GreenApiError,
  listPersonalContacts,
  listWhatsAppGroups,
  sendWhatsAppMessage,
  sendWhatsAppTextStatus,
  testGreenApiConnection,
} from "./greenapi.js";
import { getWhatsappPollHealth } from "./notifications.js";

function extractMessageText(m: Record<string, unknown>): string {
  const text =
    (typeof m.textMessage === "string" && m.textMessage) ||
    (typeof m.body === "string" && m.body) ||
    (m.extendedTextMessageData as { text?: string } | undefined)?.text ||
    (m.extendedTextMessage as { text?: string } | undefined)?.text ||
    "";
  if (text) return text;
  const type = String(m.typeMessage || m.type || "message");
  return `[${type}]`;
}

export async function registerGreenApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/greenapi/catalog", async () => ({
    categories: GREEN_API_CATEGORIES,
    methods: GREEN_API_METHODS,
  }));

  app.get("/api/greenapi/dashboard", async (_request, reply) => {
    if (!getGreenApiCredentials()) {
      return reply.status(400).send({ error: "Green-API non configuré." });
    }
    const stats = getWhatsAppMessageStats();
    let instance = { connected: false, state: "unknown", message: "" };
    try {
      instance = await testGreenApiConnection();
    } catch (err) {
      instance.message = err instanceof Error ? err.message : String(err);
    }

    let chatsCount = 0;
    let contactsCount = 0;
    let groupsCount = 0;
    try {
      const chats = (await callGreenApi("getChats", { query: { count: "200" } })) as unknown[];
      chatsCount = Array.isArray(chats) ? chats.length : 0;
    } catch {
      /* ignore */
    }
    try {
      const contacts = await listPersonalContacts(200);
      contactsCount = contacts.length;
      const groups = await listWhatsAppGroups();
      groupsCount = groups.length;
    } catch {
      /* ignore */
    }

    let greenIncoming = 0;
    try {
      const last = await getLastIncomingMessages();
      greenIncoming = last.length;
    } catch {
      /* ignore */
    }

    return {
      instance,
      poll: getWhatsappPollHealth(),
      stats: {
        ...stats,
        chatsCount,
        contactsCount,
        groupsCount,
        greenIncomingQueue: greenIncoming,
        outboundToday: countOutboundToday(),
        outboundLimit: DAILY_OUTBOUND_LIMIT,
      },
    };
  });

  app.get<{
    Querystring: { limit?: string; today?: string };
  }>("/api/greenapi/inbox/local", async (request) => {
    const limit = Number(request.query.limit || 100);
    const todayOnly = request.query.today === "1";
    if (todayOnly) {
      const rows = getRecentIncomingMessages(limit);
      return { messages: rows, source: "local" };
    }
    return { messages: listAllIncomingMessages(limit), source: "local" };
  });

  app.get("/api/greenapi/inbox/green", async (_request, reply) => {
    if (!getGreenApiCredentials()) {
      return reply.status(400).send({ error: "Green-API non configuré." });
    }
    const raw = await getLastIncomingMessages();
    const messages = raw.map((m) => ({
      idMessage: m.idMessage,
      chatId: m.chatId,
      display: chatIdToDisplay(m.chatId),
      senderName: m.senderName || m.senderContactName || "",
      senderId: m.senderId || "",
      typeMessage: m.typeMessage,
      text: extractMessageText(m as unknown as Record<string, unknown>),
      timestamp: m.timestamp,
    }));
    return { messages, source: "green-api" };
  });

  app.get<{ Querystring: { count?: string } }>("/api/greenapi/chats", async (request, reply) => {
    if (!getGreenApiCredentials()) {
      return reply.status(400).send({ error: "Green-API non configuré." });
    }
    const count = String(request.query.count || "100");
    const chats = await callGreenApi("getChats", { query: { count } });
    return { chats };
  });

  app.get<{ Querystring: { count?: string } }>("/api/greenapi/contacts", async (request, reply) => {
    if (!getGreenApiCredentials()) {
      return reply.status(400).send({ error: "Green-API non configuré." });
    }
    const count = String(request.query.count || "100");
    const contacts = await callGreenApi("getContacts", {
      query: { group: "false", count },
    });
    return { contacts };
  });

  app.get("/api/greenapi/groups", async (_request, reply) => {
    if (!getGreenApiCredentials()) {
      return reply.status(400).send({ error: "Green-API non configuré." });
    }
    const groups = await listWhatsAppGroups();
    return { groups };
  });

  app.get<{
    Querystring: { chatId?: string; recipient?: string; count?: string };
  }>("/api/greenapi/chat-history", async (request, reply) => {
    const chatId = request.query.chatId || request.query.recipient;
    if (!chatId) return reply.status(400).send({ error: "chatId requis." });
    const count = Number(request.query.count || 50);
    const history = await getChatHistory(chatId, count);
    return history;
  });

  app.post<{
    Body: { chatId?: string; message?: string; recipient?: string };
  }>("/api/greenapi/send-message", async (request, reply) => {
    const chatId = request.body?.chatId || request.body?.recipient;
    const message = request.body?.message?.trim();
    if (!chatId || !message) {
      return reply.status(400).send({ error: "chatId et message requis." });
    }
    try {
      const result = await sendWhatsAppMessage(chatId, message);
      return { ok: true, ...result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/api/greenapi/send-status", async (request, reply) => {
    const body = request.body || {};
    const message = String(body.message ?? "").trim();
    if (!message) return reply.status(400).send({ error: "message requis." });
    try {
      const result = await sendWhatsAppTextStatus(message, {
        backgroundColor: body.backgroundColor ? String(body.backgroundColor) : undefined,
        font: body.font ? String(body.font) : undefined,
      });
      return { ok: true, ...result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post<{ Body: { chatId?: string; idMessage?: string } }>("/api/greenapi/read-chat", async (request, reply) => {
    const { chatId, idMessage } = request.body || {};
    if (!chatId) return reply.status(400).send({ error: "chatId requis." });
    const body: Record<string, string> = { chatId };
    if (idMessage) body.idMessage = idMessage;
    try {
      const result = await callGreenApi("readChat", { http: "POST", body });
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.get("/api/greenapi/instance/qr", async (_request, reply) => {
    try {
      const result = await callGreenApi("getQR");
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.get("/api/greenapi/instance/settings", async (_request, reply) => {
    try {
      const result = await callGreenApi("getSettings");
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.get<{ Querystring: { minutes?: string } }>("/api/greenapi/statuses/incoming", async (request, reply) => {
    try {
      const minutes = request.query.minutes || "1440";
      const result = await callGreenApi("getIncomingStatuses", { query: { minutes } });
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.get<{ Querystring: { minutes?: string } }>("/api/greenapi/statuses/outgoing", async (request, reply) => {
    try {
      const minutes = request.query.minutes || "1440";
      const result = await callGreenApi("getOutgoingStatuses", { query: { minutes } });
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post<{
    Body: {
      method?: string;
      http?: "GET" | "POST" | "DELETE";
      body?: unknown;
      query?: Record<string, string>;
      pathSuffix?: string;
    };
  }>("/api/greenapi/call", async (request, reply) => {
    const method = request.body?.method?.trim();
    if (!method) return reply.status(400).send({ error: "method requis." });

    if (method === "deleteNotification") {
      const receiptId = request.body?.pathSuffix?.trim();
      if (!receiptId) return reply.status(400).send({ error: "pathSuffix (receiptId) requis pour deleteNotification." });
      try {
        const result = await callGreenApi("deleteNotification", {
          http: "DELETE",
          pathSuffix: receiptId,
        });
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof GreenApiError ? err.message : err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }

    if (!ALLOWED_GREEN_API_METHODS.has(method)) {
      return reply.status(403).send({ error: `Méthode non autorisée : ${method}` });
    }

    const def = findGreenApiMethod(method);
    const http = request.body?.http || def?.http || "GET";

    if (method === "sendMessage" && request.body?.body && typeof request.body.body === "object") {
      const b = request.body.body as { chatId?: string; message?: string };
      if (b.chatId && b.message) {
        try {
          const result = await sendWhatsAppMessage(b.chatId, b.message);
          return { ok: true, result, via: "sendWhatsAppMessage" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.status(400).send({ error: msg });
        }
      }
    }

    try {
      const result = await callGreenApi(method, {
        http,
        body: request.body?.body,
        query: request.body?.query,
        pathSuffix: request.body?.pathSuffix,
      });
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof GreenApiError ? err.message : err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });
}
