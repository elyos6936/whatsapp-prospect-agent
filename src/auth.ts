import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/evolution/webhook",
  "/api/integrations/typeform/callback",
  "/api/integrations/google/callback",
];

const PUBLIC_EXACT = new Set(["/", "/api/health"]);

function isPublicRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (PUBLIC_EXACT.has(path)) return true;
  if (!path.startsWith("/api/")) return true; // static assets
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
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

  app.addHook("onRequest", async (request, reply) => {
    if (isPublicRoute(request.url)) return;

    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Authentification requise." });
    }

    try {
      const payload = await request.jwtVerify<{ sub: string }>();
      const userId = Number(payload.sub);
      if (!Number.isFinite(userId) || userId < 1) {
        return reply.status(401).send({ error: "Token invalide." });
      }
      request.userId = userId;
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

declare module "fastify" {
  interface FastifyInstance {
    signUserToken(userId: number): string;
  }
}
