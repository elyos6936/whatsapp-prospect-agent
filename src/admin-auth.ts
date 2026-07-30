/**
 * Auth panneau ops (/ops) — compte séparé via env, JWT role=admin.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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

function readAdminFromEnvFile(envPath: string): {
  email?: string;
  password?: string;
  passwordHash?: string;
} {
  try {
    if (!fs.existsSync(envPath)) return {};
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    return {
      email: parsed.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
      password: parsed.ADMIN_PASSWORD?.trim() || undefined,
      passwordHash: parsed.ADMIN_PASSWORD_HASH?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

/** process.env d’abord, sinon parse `/opt/klanvio/.env` (sans écraser le reste du process). */
function resolveAdminSecrets(): {
  email: string;
  password: string;
  passwordHash: string;
} {
  let email = process.env.ADMIN_EMAIL?.trim().toLowerCase() || "";
  let password = process.env.ADMIN_PASSWORD?.trim() || "";
  let passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim() || "";

  if (!email || !(password || passwordHash)) {
    for (const envPath of [
      path.resolve(process.cwd(), ".env"),
      "/opt/klanvio/.env",
    ]) {
      const fromFile = readAdminFromEnvFile(envPath);
      email = email || fromFile.email || "";
      password = password || fromFile.password || "";
      passwordHash = passwordHash || fromFile.passwordHash || "";
      if (email && (password || passwordHash)) break;
    }
  }

  return { email, password, passwordHash };
}

export function isAdminConfigured(): boolean {
  const s = resolveAdminSecrets();
  if (!s.email) return false;
  return Boolean(s.passwordHash || s.password);
}

export async function verifyAdminCredentials(
  email: string,
  password: string
): Promise<boolean> {
  const s = resolveAdminSecrets();
  if (!s.email || !(s.passwordHash || s.password)) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized !== s.email) return false;
  if (s.passwordHash) {
    return verifyPassword(password, s.passwordHash);
  }
  const expected = s.password;
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

export function adminActorEmail(): string {
  return resolveAdminSecrets().email || "ops";
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
    request.adminActor = String(payload.email || adminActorEmail());
  } catch {
    await reply.status(401).send({ error: "Token admin invalide ou expiré." });
  }
}

export function clientIp(request: FastifyRequest): string {
  const xf = request.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0]!.trim();
  return request.ip || "";
}
