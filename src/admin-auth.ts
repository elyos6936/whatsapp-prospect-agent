/**
 * Auth panneau ops (/ops) — compte séparé via env, JWT role=admin.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { verifyPassword } from "./auth.js";

export const ADMIN_JWT_ROLE = "admin";
export const ADMIN_JWT_SUB = "ops";
export const ADMIN_TOKEN_TTL = "8h";

declare module "fastify" {
  interface FastifyRequest {
    isAdmin?: boolean;
    adminActor?: string;
  }
  interface FastifyInstance {
    signAdminToken(actorEmail: string): string;
  }
}

export function isAdminConfigured(): boolean {
  if (!config.adminEmail) return false;
  return Boolean(config.adminPasswordHash || config.adminPassword);
}

export async function verifyAdminCredentials(
  email: string,
  password: string
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized !== config.adminEmail) return false;
  if (config.adminPasswordHash) {
    return verifyPassword(password, config.adminPasswordHash);
  }
  const expected = config.adminPassword;
  if (password.length !== expected.length) {
    await new Promise((r) => setTimeout(r, 40));
    return false;
  }
  let ok = true;
  for (let i = 0; i < expected.length; i++) {
    if (password.charCodeAt(i) !== expected.charCodeAt(i)) ok = false;
  }
  return ok;
}

export function registerAdminJwtHelpers(app: FastifyInstance): void {
  app.decorate("signAdminToken", function signAdminToken(actorEmail: string) {
    return app.jwt.sign(
      { sub: ADMIN_JWT_SUB, role: ADMIN_JWT_ROLE, email: actorEmail },
      { expiresIn: ADMIN_TOKEN_TTL }
    );
  });
}

type AdminPayload = { sub?: string; role?: string; email?: string };

/** Vérifie Bearer admin ; 401/403 sinon. */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    await reply.status(401).send({ error: "Authentification admin requise." });
    return;
  }
  try {
    const payload = await request.jwtVerify<AdminPayload>();
    if (payload.role !== ADMIN_JWT_ROLE || payload.sub !== ADMIN_JWT_SUB) {
      await reply.status(403).send({ error: "Accès admin refusé." });
      return;
    }
    request.isAdmin = true;
    request.adminActor = String(payload.email || config.adminEmail || "ops");
  } catch {
    await reply.status(401).send({ error: "Token admin invalide ou expiré." });
  }
}

export function clientIp(request: FastifyRequest): string {
  const xf = request.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0]!.trim();
  return request.ip || "";
}
