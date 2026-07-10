import type { FastifyInstance } from "fastify";
import {
  createAutomation,
  getAutomationDetail,
  listAutomations,
  updateAutomationConfig,
  updateAutomationStatus,
  type AutomationStatus,
  type AutomationType,
} from "./db.js";
import { bootstrapGroupProspectTargets, reloadGroupProspectTargets } from "./automation-engine.js";
import { findGroupByNameOrId, requireGreenApiAuthorized } from "./greenapi.js";

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/automations", async () => {
    const automations = listAutomations({ limit: 100 });
    return { automations };
  });

  app.get<{ Params: { id: string } }>("/api/automations/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "ID invalide." });
    }
    const detail = getAutomationDetail(id);
    if (!detail) {
      return reply.status(404).send({ error: "Automatisation introuvable." });
    }
    return detail;
  });

  app.patch<{ Params: { id: string }; Body: { status?: AutomationStatus } }>(
    "/api/automations/:id",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ error: "ID invalide." });
      }
      const status = req.body?.status;
      if (!status || !["active", "paused", "completed", "failed"].includes(status)) {
        return reply.status(400).send({ error: "Statut invalide (active, paused, completed, failed)." });
      }
      const updated = updateAutomationStatus(id, status);
      if (!updated) {
        return reply.status(404).send({ error: "Automatisation introuvable." });
      }
      return { automation: updated };
    }
  );

  app.post<{
    Body: {
      name: string;
      type: AutomationType;
      config: Record<string, unknown>;
      summary?: string;
      budget_fcfa?: number;
    };
  }>("/api/automations", async (req, reply) => {
    const { name, type, config, summary, budget_fcfa } = req.body ?? {};
    if (!name?.trim() || !type) {
      return reply.status(400).send({ error: "name et type requis." });
    }

    const auto = createAutomation({
      name: name.trim(),
      type,
      config: config as Parameters<typeof createAutomation>[0]["config"],
      summary,
      budgetFcfa: budget_fcfa,
      status: "active",
    });

    if (type === "group_prospect" && config?.group_id) {
      let groupId = String(config.group_id);
      if (!groupId.endsWith("@g.us")) {
        const group = await findGroupByNameOrId(groupId);
        if (!group) {
          return reply.status(400).send({ error: `Groupe introuvable : ${groupId}` });
        }
        groupId = group.id;
      }
      const group = await findGroupByNameOrId(groupId);
      const savedConfig = {
        ...(config as Record<string, unknown>),
        groupId,
        groupName: group?.name ?? String(config.group_id),
        initialMessage: config.initial_message ? String(config.initial_message) : undefined,
        maxMembers: config.max_members ? Number(config.max_members) : 30,
      };
      updateAutomationConfig(auto.id, savedConfig);
      try {
        await requireGreenApiAuthorized("la création d'une campagne de prospection groupe");
        const count = await bootstrapGroupProspectTargets(auto.id);
        return { automation: getAutomationDetail(auto.id), targetsAdded: count };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg, automation: getAutomationDetail(auto.id) });
      }
    }

    return { automation: getAutomationDetail(auto.id) };
  });

  app.post<{ Params: { id: string } }>("/api/automations/:id/reload-members", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "ID invalide." });
    }
    const detail = getAutomationDetail(id);
    if (!detail) {
      return reply.status(404).send({ error: "Automatisation introuvable." });
    }
    if (detail.automation.type !== "group_prospect") {
      return reply.status(400).send({ error: "Seules les campagnes group_prospect peuvent recharger des membres." });
    }
    try {
      const targetsAdded = await reloadGroupProspectTargets(id);
      return {
        ok: true,
        targetsAdded,
        automation: getAutomationDetail(id),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg, automation: getAutomationDetail(id) });
    }
  });
}
