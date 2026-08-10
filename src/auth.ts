import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { registerAdminJwtHelpers } from "./admin-auth.js";
import { getAccountAccessBlock, getUserById } from "./users.js";
import { resolveWorkspaceContext } from "./team.js";
import type { TeamRole } from "./team.js";

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/admin/auth/login",
  "/api/evolution/webhook",
  "/api/billing/moneyfusion/webhook",
  "/api/integrations/typeform/callback",
  "/api/integrations/calendly/callback",
  "/api/integrations/google/callback",
];

const PUBLIC_EXACT = new Set(["/", "/api/health"]);

function isPublicRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (PUBLIC_EXACT.has(path)) return true;
  if (!path.startsWith("/api/")) return true; // static assets (/ops, …)
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

/** Routes ops : auth dédiée (role=admin), pas le JWT client. */
function isAdminApiRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (path.startsWith("/api/admin/")) return true;
  // Inbox support ops — requireAdmin sur les handlers
  if (path === "/api/support/tickets" || path.startsWith("/api/support/tickets/")) {
    // Routes user : /api/support/tickets/mine…
    if (path.startsWith("/api/support/tickets/mine")) return false;
    return true;
  }
  return false;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

declare module "fastify" {
  interface FastifyRequest {
    /** Compte connecté (JWT). */
    actorUserId?: number;
    /** Données partagées workspace (propriétaire si membre d'équipe). */
    userId?: number;
    workspaceId?: number;
    workspaceRole?: TeamRole;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  if (!config.jwtSecret) {
    console.error("\n❌ JWT_SECRET manquant. Définissez la variable d'environnement.\n");
    process.exit(1);
  }

  await app.register(import("@fastify/jwt"), {
    secret: config.jwtSecret,
    sign: { expiresIn: "30d" },
  });

  app.decorate("signUserToken", function signUserToken(userId: number) {
    return app.jwt.sign({ sub: String(userId) });
  });

  registerAdminJwtHelpers(app);

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (
      request.method === "GET" &&
      /^\/api\/team\/invite\/[^/]+$/.test(path) &&
      !path.endsWith("/accept")
    ) {
      return;
    }

    if (isPublicRoute(request.url)) return;
    // /api/admin/* (hors login public) : géré par requireAdmin dans admin-routes
    if (isAdminApiRoute(request.url)) return;

    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Authentification requise." });
    }

    try {
      const payload = await request.jwtVerify<{ sub: string; role?: string }>();
      if (payload.role === "admin") {
        return reply.status(403).send({ error: "Token admin non valide pour l'API client." });
      }
      const userId = Number(payload.sub);
      if (!Number.isFinite(userId) || userId < 1) {
        return reply.status(401).send({ error: "Token invalide." });
      }
      const user = await getUserById(userId);
      const block = getAccountAccessBlock(user);
      if (block) {
        return reply.status(403).send({ error: block, code: "account_blocked" });
      }
      request.actorUserId = userId;
      const workspace = await resolveWorkspaceContext(userId);
      request.workspaceId = workspace.workspaceId;
      request.workspaceRole = workspace.role;
      request.userId = workspace.ownerUserId;
    } catch {
      return reply.status(401).send({ error: "Token invalide ou expiré." });
    }
  });
}

export function requireUserId(request: FastifyRequest): number {
  const id = request.userId;
  if (!id) throw new Error("userId manquant");
  return id;
}

export function requireActorUserId(request: FastifyRequest): number {
  const id = request.actorUserId ?? request.userId;
  if (!id) throw new Error("actorUserId manquant");
  return id;
}

declare module "fastify" {
  interface FastifyInstance {
    signUserToken(userId: number): string;
  }
}
