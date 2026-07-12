import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import {
  countOutboundToday,
  getEffectiveOutboundLimit,
  getRecentIncomingMessages,
  getWhatsAppMessageStats,
  listIncomingMessages,
} from "./db.js";
import {
  chatIdToDisplay,
  createWhatsAppGroup,
  EvolutionApiError,
  getChatHistory,
  getEvolutionCredentials,
  getGroupMembers,
  getInstanceQr,
  getLastIncomingMessages,
  listPersonalContacts,
  listWhatsAppGroups,
  markChatRead,
  restartInstance,
  logoutInstance,
  sendWhatsAppMessage,
  sendWhatsAppTextStatus,
  testEvolutionConnection,
} from "./evolutionapi.js";
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

export async function registerEvolutionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/evolution/dashboard", async (request, reply) => {
    const userId = requireUserId(request);
    if (!(await getEvolutionCredentials(userId))) {
      return reply.status(400).send({ error: "Evolution API non configurée." });
    }

    let instance: Awaited<ReturnType<typeof testEvolutionConnection>>;
    try {
      instance = await testEvolutionConnection(userId);
    } catch (err) {
      instance = {
        connected: false,
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const stats = await getWhatsAppMessageStats(userId);
    let chatsCount = 0;
    let contactsCount = 0;
    let groupsCount = 0;
    try {
      const [groups, contacts] = await Promise.all([
        listWhatsAppGroups(userId),
        listPersonalContacts(userId, 200),
      ]);
      groupsCount = groups.length;
      contactsCount = contacts.length;
      chatsCount = groupsCount + contactsCount;
    } catch {
      /* best effort */
    }

    return {
      instance,
      stats: {
        ...stats,
        outboundToday: await countOutboundToday(userId),
        outboundLimit: await getEffectiveOutboundLimit(userId),
        chatsCount,
        contactsCount,
        groupsCount,
      },
      poll: getWhatsappPollHealth(userId),
    };
  });

  app.get<{ Querystring: { contact?: string; today?: string; limit?: string } }>(
    "/api/evolution/inbox/local",
    async (request) => {
      const userId = requireUserId(request);
      const limit = Math.min(Math.max(Number(request.query.limit) || 200, 1), 500);
      const messages = await (
        request.query.today === "1"
          ? listIncomingMessages(userId, { todayOnly: true, limit })
          : request.query.contact
            ? listIncomingMessages(userId, { contactPhone: request.query.contact, limit })
            : getRecentIncomingMessages(userId, limit)
      );

      return {
        messages: messages.map((m) => ({
          ...m,
          display: chatIdToDisplay(m.contact_phone),
        })),
      };
    }
  );

  app.get("/api/evolution/inbox/live", async (request, reply) => {
    const userId = requireUserId(request);
    if (!(await getEvolutionCredentials(userId))) {
      return reply.status(400).send({ error: "Evolution API non configurée." });
    }
    const raw = await getLastIncomingMessages(userId);
    const messages = raw.map((m) => ({
      idMessage: m.idMessage,
      chatId: m.chatId,
      display: chatIdToDisplay(m.chatId),
      senderName: m.senderName || m.senderContactName || "",
      typeMessage: m.typeMessage,
      text: extractMessageText(m as unknown as Record<string, unknown>),
      timestamp: m.timestamp,
    }));
    return { messages, source: "evolution" };
  });

  app.get<{ Querystring: { count?: string } }>("/api/evolution/chats", async (request, reply) => {
    const userId = requireUserId(request);
    if (!(await getEvolutionCredentials(userId))) {
      return reply.status(400).send({ error: "Evolution API non configurée." });
    }
    const count = request.query.count || "100";
    const { listWhatsAppChats } = await import("./evolutionapi.js");
    const chats = await listWhatsAppChats(userId, Number(count));
    return { chats };
  });

  app.get<{ Querystring: { count?: string } }>("/api/evolution/contacts", async (request, reply) => {
    const userId = requireUserId(request);
    if (!(await getEvolutionCredentials(userId))) {
      return reply.status(400).send({ error: "Evolution API non configurée." });
    }
    const limit = Math.min(Math.max(Number(request.query.count) || 200, 1), 500);
    const contacts = await listPersonalContacts(userId, limit);
    return { contacts };
  });

  app.get("/api/evolution/groups", async (request, reply) => {
    const userId = requireUserId(request);
    if (!(await getEvolutionCredentials(userId))) {
      return reply.status(400).send({ error: "Evolution API non configurée." });
    }
    const groups = await listWhatsAppGroups(userId);
    return { groups };
  });

  app.post<{
    Body: { subject?: string; participants?: string[]; description?: string; promoteParticipants?: boolean };
  }>("/api/evolution/groups/create", async (request, reply) => {
    const userId = requireUserId(request);
    if (!(await getEvolutionCredentials(userId))) {
      return reply.status(400).send({ error: "Evolution API non configurée." });
    }
    const subject = request.body?.subject?.trim();
    if (!subject) return reply.status(400).send({ error: "subject requis." });
    const participants = Array.isArray(request.body?.participants) ? request.body.participants : [];
    try {
      const group = await createWhatsAppGroup(userId, {
        subject,
        participants,
        description: request.body?.description,
        promoteParticipants: request.body?.promoteParticipants,
      });
      return { ok: true, group };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.get<{ Querystring: { groupId?: string } }>("/api/evolution/groups/members", async (request, reply) => {
    const userId = requireUserId(request);
    const groupId = request.query.groupId?.trim();
    if (!groupId) return reply.status(400).send({ error: "groupId requis." });
    try {
      const group = await getGroupMembers(userId, groupId);
      return { group };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.get<{ Querystring: { chatId?: string; count?: string } }>(
    "/api/evolution/chat-history",
    async (request, reply) => {
      const userId = requireUserId(request);
      const chatId = request.query.chatId?.trim();
      if (!chatId) return reply.status(400).send({ error: "chatId requis." });
      const count = Math.min(Math.max(Number(request.query.count) || 60, 1), 200);
      try {
        return await getChatHistory(userId, chatId, count);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }
  );

  app.post<{ Body: { chatId?: string; message?: string } }>(
    "/api/evolution/send-message",
    async (request, reply) => {
      const userId = requireUserId(request);
      const chatId = request.body?.chatId?.trim();
      const message = request.body?.message?.trim();
      if (!chatId || !message) {
        return reply.status(400).send({ error: "chatId et message requis." });
      }
      try {
        const result = await sendWhatsAppMessage(userId, chatId, message);
        return { ok: true, ...result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }
  );

  app.post<{ Body: Record<string, unknown> }>("/api/evolution/send-status", async (request, reply) => {
    const userId = requireUserId(request);
    const body = request.body || {};
    const message = String(body.message ?? "").trim();
    if (!message) return reply.status(400).send({ error: "message requis." });
    try {
      const result = await sendWhatsAppTextStatus(userId, message, {
        backgroundColor: body.backgroundColor ? String(body.backgroundColor) : undefined,
        font: body.font ? String(body.font) : undefined,
      });
      return { ok: true, ...result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post<{ Body: { chatId?: string; idMessage?: string } }>(
    "/api/evolution/read-chat",
    async (request, reply) => {
      const userId = requireUserId(request);
      const { chatId, idMessage } = request.body || {};
      if (!chatId) return reply.status(400).send({ error: "chatId requis." });
      try {
        const result = await markChatRead(userId, chatId, idMessage);
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }
  );

  app.get("/api/evolution/instance/state", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      return await testEvolutionConnection(userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ connected: false, state: "error", message: msg });
    }
  });

  app.get("/api/evolution/instance/qr", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const qr = await getInstanceQr(userId);
      return { ok: true, ...qr };
    } catch (err) {
      const msg = err instanceof EvolutionApiError ? err.message : err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post("/api/evolution/instance/restart", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const result = await restartInstance(userId);
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  app.post("/api/evolution/instance/logout", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const result = await logoutInstance(userId);
      return { ok: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });
}
