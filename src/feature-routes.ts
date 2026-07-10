import type { FastifyInstance } from "fastify";
import {
  createGroupReplyRule,
  listPendingHandoffs,
  resolveHandoff,
  listContacts,
} from "./db.js";
import { getRoiDashboard } from "./roi-dashboard.js";

export async function registerFeatureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/roi/dashboard", async () => getRoiDashboard());

  app.get("/api/handoffs", async () => ({
    handoffs: listPendingHandoffs(50),
  }));

  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    "/api/handoffs/:id",
    async (req, reply) => {
      const id = Number(req.params.id);
      const status = req.body?.status;
      if (!Number.isFinite(id) || (status !== "resolved" && status !== "dismissed")) {
        return reply.status(400).send({ error: "status doit être resolved ou dismissed." });
      }
      resolveHandoff(id, status);
      return { ok: true };
    }
  );

  app.get("/api/contacts/scored", async () => {
    const contacts = listContacts({ limit: 200 });
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
    const { groupId, groupLabel, keywords, replyGuide, automationId } = req.body ?? {};
    if (!groupId?.trim()) {
      return reply.status(400).send({ error: "groupId requis." });
    }
    const rule = createGroupReplyRule({
      groupId: groupId.trim(),
      groupLabel,
      keywords: keywords ?? [],
      replyGuide,
      automationId,
    });
    return { ok: true, rule };
  });
}
