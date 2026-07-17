import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import {
  createAutomation,
  getAutomation,
  getAutomationDetail,
  getDailyBilan,
  listAutomations,
  listAutomationTargets,
  listScheduledMessages,
  cancelScheduledMessage,
  saveAgentMessage,
  getRecentAgentMessages,
  clearAgentConversation,
  ensureDefaultAgentThread,
  updateAutomationConfig,
  updateAutomationStatus,
  pauseAutomation,
  resumeAutomation,
  haltAutomationMessaging,
  type AutomationStatus,
  type AutomationType,
} from "./db.js";
import { bootstrapGroupProspectTargets, reloadGroupProspectTargets, kickAutomationForUser } from "./automation-engine.js";
import { chatWithAgent } from "./agent.js";
import { findGroupByNameOrId, requireEvolutionConnected } from "./evolutionapi.js";

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/automations", async (request) => {
    const userId = requireUserId(request);
    const automations = await listAutomations(userId, { limit: 100 });
    return { automations };
  });

  app.get<{ Params: { id: string } }>("/api/automations/:id", async (req, reply) => {
    const userId = requireUserId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "ID invalide." });
    }
    const detail = await getAutomationDetail(userId, id);
    if (!detail) {
      return reply.status(404).send({ error: "Automatisation introuvable." });
    }
    return detail;
  });

  app.patch<{ Params: { id: string }; Body: { status?: AutomationStatus } }>(
    "/api/automations/:id",
    async (req, reply) => {
      const userId = requireUserId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ error: "ID invalide." });
      }
      const status = req.body?.status;
      if (!status || !["active", "paused", "completed", "failed"].includes(status)) {
        return reply.status(400).send({ error: "Statut invalide (active, paused, completed, failed)." });
      }
      const updated =
        status === "paused"
          ? await pauseAutomation(userId, id)
          : status === "active"
            ? await resumeAutomation(userId, id)
            : await (async () => {
                const cur = await getAutomation(userId, id);
                if (cur) {
                  await haltAutomationMessaging(userId, id);
                  await updateAutomationConfig(userId, id, {
                    ...cur.config,
                    enableAutoReply: false,
                  });
                }
                return updateAutomationStatus(userId, id, status);
              })();
      if (!updated) {
        return reply.status(404).send({ error: "Automatisation introuvable." });
      }
      if (status === "active") {
        kickAutomationForUser(userId);
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
    const userId = requireUserId(req);
    const { name, type, config, summary, budget_fcfa } = req.body ?? {};
    if (!name?.trim() || !type) {
      return reply.status(400).send({ error: "name et type requis." });
    }

    const auto = await createAutomation(userId, {
      name: name.trim(),
      type,
      config: config as Parameters<typeof createAutomation>[1]["config"],
      summary,
      budgetFcfa: budget_fcfa,
      status: "active",
    });

    if (type === "group_prospect" && config?.group_id) {
      let groupId = String(config.group_id);
      if (!groupId.endsWith("@g.us")) {
        const group = await findGroupByNameOrId(userId, groupId);
        if (!group) {
          return reply.status(400).send({ error: `Groupe introuvable : ${groupId}` });
        }
        groupId = group.id;
      }
      const group = await findGroupByNameOrId(userId, groupId);
      const savedConfig = {
        ...(config as Record<string, unknown>),
        groupId,
        groupName: group?.name ?? String(config.group_id),
        initialMessage: config.initial_message ? String(config.initial_message) : undefined,
        maxMembers: config.max_members ? Number(config.max_members) : 30,
      };
      await updateAutomationConfig(userId, auto.id, savedConfig);
      try {
        await requireEvolutionConnected(userId, "la création d'une campagne de prospection groupe");
        const count = await bootstrapGroupProspectTargets(userId, auto.id);
        kickAutomationForUser(userId);
        return { automation: await getAutomationDetail(userId, auto.id), targetsAdded: count };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: msg, automation: await getAutomationDetail(userId, auto.id) });
      }
    }

    return { automation: await getAutomationDetail(userId, auto.id) };
  });

  app.post<{ Params: { id: string } }>("/api/automations/:id/reload-members", async (req, reply) => {
    const userId = requireUserId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "ID invalide." });
    }
    const detail = await getAutomationDetail(userId, id);
    if (!detail) {
      return reply.status(404).send({ error: "Automatisation introuvable." });
    }
    if (detail.automation.type !== "group_prospect") {
      return reply.status(400).send({ error: "Seules les campagnes group_prospect peuvent recharger des membres." });
    }
    try {
      const targetsAdded = await reloadGroupProspectTargets(userId, id);
      return {
        ok: true,
        targetsAdded,
        automation: await getAutomationDetail(userId, id),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg, automation: await getAutomationDetail(userId, id) });
    }
  });

  // --- Constructeur d'automatisation (page Automatisation → Manuel) : chat IA dédié ---
  app.get("/api/automations/builder/history", async (request) => {
    const userId = requireUserId(request);
    const thread = await ensureDefaultAgentThread(userId);
    const messages = await getRecentAgentMessages(userId, thread.id, 100);
    return { messages, thread_id: thread.id };
  });

  app.post<{ Body: { message?: string } }>("/api/automations/builder/chat", async (req, reply) => {
    const userId = requireUserId(req);
    const message = req.body?.message?.trim();
    if (!message) {
      return reply.status(400).send({ error: "Le champ « message » est requis." });
    }

    const thread = await ensureDefaultAgentThread(userId);
    await saveAgentMessage(userId, thread.id, "user", message);
    try {
      const assistantReply = await chatWithAgent(userId, message, thread.id);
      const saved = await saveAgentMessage(userId, thread.id, "assistant", assistantReply);
      return { id: saved.id, reply: saved.content, created_at: saved.created_at };
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Erreur inconnue.";
      const saved = await saveAgentMessage(userId, thread.id, "assistant", `❌ ${errorText}`);
      return { id: saved.id, reply: saved.content, created_at: saved.created_at, error: true };
    }
  });

  app.delete("/api/automations/builder/history", async (request) => {
    const userId = requireUserId(request);
    const thread = await ensureDefaultAgentThread(userId);
    await clearAgentConversation(userId, thread.id);
    return { ok: true };
  });

  // --- Envois programmés ponctuels (sous-section « Automatique ») ---
  app.get("/api/scheduled", async (request) => {
    const userId = requireUserId(request);
    const messages = await listScheduledMessages(userId, { includeDone: true, limit: 100 });
    return { messages };
  });

  app.delete<{ Params: { id: string } }>("/api/scheduled/:id", async (req, reply) => {
    const userId = requireUserId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "ID invalide." });
    }
    const cancelled = await cancelScheduledMessage(userId, id);
    if (!cancelled) {
      return reply.status(404).send({ error: "Message programmé introuvable." });
    }
    return { ok: true, message: cancelled };
  });

  // --- Statistiques d'une automatisation (taux de réponse, messages) ---
  app.get<{ Params: { id: string } }>("/api/automations/:id/stats", async (req, reply) => {
    const userId = requireUserId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return reply.status(400).send({ error: "ID invalide." });
    }
    const auto = await getAutomation(userId, id);
    if (!auto) {
      return reply.status(404).send({ error: "Automatisation introuvable." });
    }

    const targets = await listAutomationTargets(userId, id, { limit: 1000 });
    const contacted = targets.filter((t) => t.status !== "pending").length;
    const replied = targets.filter((t) => t.status === "replied" || t.status === "interested").length;
    const interested = targets.filter((t) => t.status === "interested").length;
    const pending = targets.filter((t) => t.status === "pending").length;
    const stopped = targets.filter((t) => t.status === "stopped").length;

    const messagesSent =
      (Number(auto.stats.outboundUsed) || 0) || contacted;
    const messagesHandled = Number(auto.stats.messagesHandled) || 0;
    const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : null;

    const bilan = await getDailyBilan(userId).catch(() => null);

    return {
      automation: {
        id: auto.id,
        name: auto.name,
        type: auto.type,
        status: auto.status,
        mode: auto.config.mode ?? null,
        origin: auto.config.origin ?? "chat",
      },
      stats: {
        targetsTotal: targets.length,
        contacted,
        pending,
        replied,
        interested,
        stopped,
        messagesSent,
        messagesHandled,
        responseRatePercent: responseRate,
        conversions: Number(auto.stats.conversions) || 0,
        lastActionAt: auto.stats.lastActionAt ?? null,
        report: typeof auto.stats.report === "string" ? auto.stats.report : null,
      },
      today: bilan
        ? { date: bilan.date, incoming: bilan.incoming, outgoing: bilan.outgoing }
        : null,
    };
  });
}
