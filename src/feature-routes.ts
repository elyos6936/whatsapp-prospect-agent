import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import {
  createGroupReplyRule,
  listPendingHandoffs,
  resolveHandoff,
  listContacts,
} from "./db.js";
import { getRoiDashboard } from "./roi-dashboard.js";

export async function registerFeatureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/roi/dashboard", async (request) => getRoiDashboard(requireUserId(request)));

  app.get("/api/handoffs", async (request) => ({
    handoffs: await listPendingHandoffs(requireUserId(request), 50),
  }));

  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    "/api/handoffs/:id",
    async (req, reply) => {
      const userId = requireUserId(req);
      const id = Number(req.params.id);
      const status = req.body?.status;
      if (!Number.isFinite(id) || (status !== "resolved" && status !== "dismissed")) {
        return reply.status(400).send({ error: "status doit être resolved ou dismissed." });
      }
      await resolveHandoff(userId, id, status);
      return { ok: true };
    }
  );

  app.get("/api/contacts/scored", async (request) => {
    const userId = requireUserId(request);
    const contacts = await listContacts(userId, { limit: 200 });
    return {
      contacts: contacts
        .map((c) => ({
          phone: c.phone,
          name: c.name,
          status: c.status,
          lead_score: c.lead_score,
          handoff_status: c.handoff_status,
        }))
        .sort((a, b) => b.lead_score - a.lead_score),
    };
  });

  app.post<{
    Body: {
      groupId: string;
      groupLabel?: string;
      keywords?: string[];
      replyGuide?: string;
      automationId?: number;
    };
  }>("/api/group-rules", async (req, reply) => {
    const userId = requireUserId(req);
    const { groupId, groupLabel, keywords, replyGuide, automationId } = req.body ?? {};
    if (!groupId?.trim()) {
      return reply.status(400).send({ error: "groupId requis." });
    }
    const rule = await createGroupReplyRule(userId, {
      groupId: groupId.trim(),
      groupLabel,
      keywords: keywords ?? [],
      replyGuide,
      automationId,
    });
    return { ok: true, rule };
  });
}
