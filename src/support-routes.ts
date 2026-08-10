import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import { requireAdmin } from "./admin-auth.js";
import { handleSupportUserChat, sendOpsSupportReply } from "./support-bot.js";
import {
  assertTicketOwnedByUser,
  ensureSupportSchema,
  getSupportTicketById,
  listSupportMessages,
  listSupportTicketsForUser,
  listSupportTicketsOps,
  updateSupportTicket,
  type SupportTicketStatus,
} from "./support-store.js";

export async function registerSupportRoutes(app: FastifyInstance): Promise<void> {
  await ensureSupportSchema().catch((err) => {
    console.error("[support] ensureSupportSchema:", err);
  });

  /** Thread actif (s’il existe) + liste des tickets avec messages. Ne crée pas de ticket vide. */
  app.get("/api/support/thread", async (request) => {
    const userId = requireUserId(request);
    const tickets = await listSupportTicketsForUser(userId);
    const ticket =
      tickets.find((t) => t.status === "open" || t.status === "pending") ?? null;
    const messages = ticket ? await listSupportMessages(ticket.id) : [];
    return { ticket, messages, tickets };
  });

  app.get<{ Querystring: { status?: string } }>("/api/support/tickets/mine", async (request) => {
    const userId = requireUserId(request);
    const raw = String(request.query.status ?? "").trim();
    const status =
      raw === "done" || raw === "open" || raw === "pending" || raw === "active"
        ? (raw as SupportTicketStatus | "active")
        : undefined;
    const tickets = await listSupportTicketsForUser(userId, status);
    return { tickets };
  });

  app.get<{ Params: { id: string } }>("/api/support/tickets/mine/:id", async (request, reply) => {
    const userId = requireUserId(request);
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: "id invalide" });
    const ticket = await assertTicketOwnedByUser(id, userId);
    if (!ticket) return reply.status(404).send({ error: "Ticket introuvable" });
    const messages = await listSupportMessages(ticket.id);
    return { ticket, messages };
  });

  app.post<{
    Body: { message?: string; imageUrls?: string[]; ticketId?: number };
  }>("/api/support/chat", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const result = await handleSupportUserChat(userId, {
        message: request.body?.message,
        imageUrls: request.body?.imageUrls,
        ticketId: request.body?.ticketId,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  });

  // ——— Ops (token admin) ———

  app.get<{ Querystring: { status?: string } }>(
    "/api/support/tickets",
    { preHandler: requireAdmin },
    async (request) => {
      const raw = String(request.query.status ?? "active").trim();
      const status =
        raw === "done" || raw === "open" || raw === "pending" || raw === "active"
          ? (raw as SupportTicketStatus | "active")
          : "active";
      const tickets = await listSupportTicketsOps(status);
      return { tickets };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/support/tickets/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "id invalide" });
      const ticket = await getSupportTicketById(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket introuvable" });
      const messages = await listSupportMessages(id);
      return { ticket, messages };
    }
  );

  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    "/api/support/tickets/:id/reply",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "id invalide" });
      try {
        const result = await sendOpsSupportReply(id, String(request.body?.message ?? ""));
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg });
      }
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { status?: SupportTicketStatus };
  }>("/api/support/tickets/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: "id invalide" });
    const status = request.body?.status;
    if (status !== "open" && status !== "pending" && status !== "done") {
      return reply.status(400).send({ error: "status invalide" });
    }
    const ticket = await updateSupportTicket(id, { status });
    if (!ticket) return reply.status(404).send({ error: "Ticket introuvable" });
    return { ticket };
  });
}
