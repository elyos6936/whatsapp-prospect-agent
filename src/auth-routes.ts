import type { FastifyInstance } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";
import { hashPassword, verifyPassword, requireUserId } from "./auth.js";
import {
  createUser,
  createGoogleUser,
  linkGoogleAccount,
  getUserByEmail,
  getUserByGoogleSub,
  getUserById,
  completeOnboarding,
  publicUser,
} from "./users.js";
import { testEvolutionConnection } from "./evolutionapi.js";

let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!googleClient) googleClient = new OAuth2Client(config.googleClientId);
  return googleClient;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; password?: string; name?: string } }>(
    "/api/auth/register",
    async (request, reply) => {
      const email = request.body?.email?.trim().toLowerCase();
      const password = request.body?.password ?? "";
      const name = request.body?.name?.trim() ?? "";

      if (!email || !password || password.length < 6) {
        return reply.status(400).send({ error: "Email et mot de passe (6 car. min.) requis." });
      }
      if (!name) {
        return reply.status(400).send({ error: "Le prénom ou nom est requis." });
      }

      const existing = await getUserByEmail(email);
      if (existing) {
        return reply.status(409).send({ error: "Cet email est déjà utilisé." });
      }

      const user = await createUser({
        email,
        passwordHash: await hashPassword(password),
        name,
      });

      const token = app.signUserToken(user.id);
      return { token, user: publicUser(user) };
    },
  );

  app.post<{ Body: { email?: string; password?: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      const email = request.body?.email?.trim().toLowerCase();
      const password = request.body?.password ?? "";
      if (!email || !password) {
        return reply.status(400).send({ error: "Email et mot de passe requis." });
      }

      const row = await getUserByEmail(email);
      if (row && !row.password_hash) {
        return reply
          .status(401)
          .send({ error: "Ce compte utilise la connexion Google. Cliquez sur « Continuer avec Google »." });
      }
      if (!row || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
        return reply.status(401).send({ error: "Email ou mot de passe incorrect." });
      }

      const { password_hash: _, ...user } = row;
      const token = app.signUserToken(user.id);
      return { token, user: publicUser(user) };
    },
  );

  app.post<{ Body: { credential?: string } }>(
    "/api/auth/google",
    async (request, reply) => {
      if (!config.googleClientId) {
        return reply
          .status(503)
          .send({ error: "Connexion Google non configurée sur le serveur." });
      }

      const credential = request.body?.credential?.trim();
      if (!credential) {
        return reply.status(400).send({ error: "Jeton Google manquant." });
      }

      let payload;
      try {
        const ticket = await getGoogleClient().verifyIdToken({
          idToken: credential,
          audience: config.googleClientId,
        });
        payload = ticket.getPayload();
      } catch {
        return reply.status(401).send({ error: "Jeton Google invalide ou expiré." });
      }

      if (!payload?.sub || !payload.email) {
        return reply.status(401).send({ error: "Compte Google incomplet." });
      }
      if (payload.email_verified === false) {
        return reply.status(401).send({ error: "Email Google non vérifié." });
      }

      const googleSub = payload.sub;
      const email = payload.email.trim().toLowerCase();
      const name = (payload.name || payload.given_name || email.split("@")[0]).trim();
      const avatarUrl = payload.picture;

      let user = await getUserByGoogleSub(googleSub);
      if (!user) {
        const byEmail = await getUserByEmail(email);
        user = byEmail
          ? await linkGoogleAccount(byEmail.id, { googleSub, avatarUrl })
          : await createGoogleUser({ email, name, googleSub, avatarUrl });
      }

      const token = app.signUserToken(user.id);
      return { token, user: publicUser(user) };
    },
  );

  app.get("/api/me", async (request) => {
    const userId = requireUserId(request);
    const user = await getUserById(userId);
    if (!user) return { error: "Utilisateur introuvable" };

    let whatsapp = { connected: false, state: "not_configured", message: "Non configuré" };
    try {
      whatsapp = await testEvolutionConnection(userId);
    } catch (err) {
      whatsapp = {
        connected: false,
        state: "error",
        message: err instanceof Error ? err.message : "Erreur Evolution API",
      };
    }

    return {
      ...publicUser(user),
      whatsapp,
    };
  });

  app.post<{
    Body: {
      answers?: Record<string, unknown>;
      business_owner_name?: string;
      business_offer?: string;
      business_price?: string;
    };
  }>("/api/onboarding", async (request, reply) => {
    const userId = requireUserId(request);
    const answers = request.body?.answers;
    if (!answers || typeof answers !== "object") {
      return reply.status(400).send({ error: "Réponses onboarding requises." });
    }

    const user = await completeOnboarding(userId, {
      answers,
      business_owner_name: request.body?.business_owner_name,
      business_offer: request.body?.business_offer,
      business_price: request.body?.business_price,
    });

    return { ok: true, user: publicUser(user) };
  });
}
