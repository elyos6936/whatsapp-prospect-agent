/**
 * Routes panneau ops — /api/admin/*
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  clientIp,
  isAdminConfigured,
  requireAdmin,
  verifyAdminCredentials,
} from "./admin-auth.js";
import {
  adminCancelQueue,
  adminStopOutbound,
  adminUpdateOutreach,
  adminUpdateSubscription,
  ensureAdminAuditSchema,
  getAdminOverview,
  getAdminUserDetail,
  listAdminAudit,
  listAdminUserActivity,
  listAdminUserMessages,
  listAdminUsers,
  writeAdminAudit,
} from "./admin-service.js";
import { pauseAllActiveAutomations, setAutoReplyEnabled } from "./db.js";
import type { SubscriptionStatus } from "./outreach-level.js";

/** Rate-limit login : max 8 tentatives / 15 min / IP. */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || now > row.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  if (row.count >= 8) return false;
  row.count += 1;
  return true;
}

function actorMeta(request: FastifyRequest) {
  return {
    actor: request.adminActor || "ops",
    ip: clientIp(request),
    userAgent: String(request.headers["user-agent"] || "").slice(0, 300),
  };
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await ensureAdminAuditSchema().catch((err) => {
    console.warn("[admin] audit schema:", err instanceof Error ? err.message : err);
  });

  app.post<{ Body: { email?: string; password?: string } }>(
    "/api/admin/auth/login",
    async (request, reply) => {
      if (!isAdminConfigured()) {
        return reply.status(503).send({
          error:
            "ADMIN_EMAIL / ADMIN_PASSWORD absents du process API. Sur le VPS Hostinger, ajoute-les dans /opt/klanvio/.env (mot de passe entre guillemets si caractères spéciaux), puis : pm2 reload klanvio-api --update-env",
        });
      }

      const ip = clientIp(request);
      if (!checkLoginRateLimit(ip)) {
        return reply.status(429).send({ error: "Trop de tentatives. Réessayez plus tard." });
      }

      const email = String(request.body?.email ?? "").trim();
      const password = String(request.body?.password ?? "");
      if (!email || !password) {
        return reply.status(400).send({ error: "Email et mot de passe requis." });
      }

      const ok = await verifyAdminCredentials(email, password);
      if (!ok) {
        return reply.status(401).send({ error: "Identifiants incorrects." });
      }

      const token = app.signAdminToken(email.trim().toLowerCase());
      await writeAdminAudit({
        actor: email.trim().toLowerCase(),
        action: "admin.login",
        payload: {},
        ip,
        userAgent: String(request.headers["user-agent"] || "").slice(0, 300),
      }).catch(() => {});

      return {
        ok: true,
        token,
        expiresIn: "8h",
        email: email.trim().toLowerCase(),
      };
    }
  );

  app.get(
    "/api/admin/auth/me",
    { preHandler: requireAdmin },
    async (request) => ({
      ok: true,
      email: request.adminActor,
      role: "admin",
    })
  );

  app.get(
    "/api/admin/overview",
    { preHandler: requireAdmin },
    async () => getAdminOverview()
  );

  app.get<{
    Querystring: {
      q?: string;
      status?: string;
      level?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/users", { preHandler: requireAdmin }, async (request) => {
    const levelRaw = request.query.level ? Number(request.query.level) : undefined;
    return listAdminUsers({
      q: request.query.q,
      status: request.query.status,
      level: Number.isFinite(levelRaw) ? levelRaw : undefined,
      limit: request.query.limit ? Number(request.query.limit) : 50,
      offset: request.query.offset ? Number(request.query.offset) : 0,
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const detail = await getAdminUserDetail(id);
      if (!detail) return reply.status(404).send({ error: "Utilisateur introuvable." });
      return detail;
    }
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string; direction?: string };
  }>("/api/admin/users/:id/messages", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
    return listAdminUserMessages(id, {
      limit: request.query.limit ? Number(request.query.limit) : 50,
      offset: request.query.offset ? Number(request.query.offset) : 0,
      direction: request.query.direction,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/admin/users/:id/activity",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      return listAdminUserActivity(id, request.query.limit ? Number(request.query.limit) : 40);
    }
  );

  app.get<{
    Querystring: { limit?: string; offset?: string; targetUserId?: string };
  }>("/api/admin/audit", { preHandler: requireAdmin }, async (request) => {
    const target = request.query.targetUserId
      ? Number(request.query.targetUserId)
      : undefined;
    return listAdminAudit({
      limit: request.query.limit ? Number(request.query.limit) : 50,
      offset: request.query.offset ? Number(request.query.offset) : 0,
      targetUserId: Number.isFinite(target) ? target : undefined,
    });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      status?: SubscriptionStatus;
      outreachLevel?: number;
      trialConversationsUsed?: number;
      resetTrial?: boolean;
    };
  }>("/api/admin/users/:id/subscription", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
    const body = request.body ?? {};
    const user = await adminUpdateSubscription(id, body);
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable." });
    const meta = actorMeta(request);
    await writeAdminAudit({
      ...meta,
      action: "user.subscription.update",
      targetUserId: id,
      payload: body as Record<string, unknown>,
    });
    return { ok: true, user };
  });

  app.patch<{
    Params: { id: string };
    Body: { outreachLevel?: number; totalMessagesSent?: number };
  }>("/api/admin/users/:id/outreach", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
    const body = request.body ?? {};
    const user = await adminUpdateOutreach(id, body);
    if (!user) return reply.status(404).send({ error: "Utilisateur introuvable." });
    const meta = actorMeta(request);
    await writeAdminAudit({
      ...meta,
      action: "user.outreach.update",
      targetUserId: id,
      payload: body as Record<string, unknown>,
    });
    return { ok: true, user };
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/pause-automations",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const paused = await pauseAllActiveAutomations(id);
      const meta = actorMeta(request);
      await writeAdminAudit({
        ...meta,
        action: "user.pause_automations",
        targetUserId: id,
        payload: { paused },
      });
      return { ok: true, paused };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/cancel-queue",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const cancelled = await adminCancelQueue(id);
      const meta = actorMeta(request);
      await writeAdminAudit({
        ...meta,
        action: "user.cancel_queue",
        targetUserId: id,
        payload: { cancelled },
      });
      return { ok: true, cancelled };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/stop-outbound",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const result = await adminStopOutbound(id);
      const meta = actorMeta(request);
      await writeAdminAudit({
        ...meta,
        action: "user.stop_outbound",
        targetUserId: id,
        payload: result,
      });
      return { ok: true, ...result };
    }
  );

  app.post<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    "/api/admin/users/:id/set-auto-reply",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const enabled = request.body?.enabled === true;
      await setAutoReplyEnabled(id, enabled);
      const meta = actorMeta(request);
      await writeAdminAudit({
        ...meta,
        action: "user.set_auto_reply",
        targetUserId: id,
        payload: { enabled },
      });
      return { ok: true, enabled };
    }
  );
}
