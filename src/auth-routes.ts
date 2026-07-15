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

let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!googleClient) googleClient = new OAuth2Client(config.googleClientId);
  return googleClient;
}

interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

/** Vérifie un ID token (flux GIS renderButton / One Tap). */
async function identityFromIdToken(credential: string): Promise<GoogleIdentity | null> {
  const ticket = await getGoogleClient().verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified === false) return null;
  const email = payload.email.trim().toLowerCase();
  return {
    sub: payload.sub,
    email,
    name: (payload.name || payload.given_name || email.split("@")[0]).trim(),
    avatarUrl: payload.picture,
  };
}

/**
 * Vérifie un access token (flux popup OAuth `initTokenClient`).
 * On contrôle que le token a bien été émis pour NOTRE client (aud), puis on
 * récupère le profil via l'endpoint userinfo.
 */
async function identityFromAccessToken(accessToken: string): Promise<GoogleIdentity | null> {
  const info = await getGoogleClient().getTokenInfo(accessToken);
  if (info.aud !== config.googleClientId) return null;
  if (!info.sub || !info.email || info.email_verified === false) return null;

  let name = "";
  let avatarUrl: string | undefined;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const profile = (await res.json()) as { name?: string; given_name?: string; picture?: string };
      name = (profile.name || profile.given_name || "").trim();
      avatarUrl = profile.picture;
    }
  } catch {
    /* profil best-effort : on retombe sur l'email */
  }

  const email = info.email.trim().toLowerCase();
  return {
    sub: info.sub,
    email,
    name: name || email.split("@")[0],
    avatarUrl,
  };
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

  app.post<{ Body: { credential?: string; accessToken?: string } }>(
    "/api/auth/google",
    async (request, reply) => {
      if (!config.googleClientId) {
        return reply
          .status(503)
          .send({ error: "Connexion Google non configurée sur le serveur." });
      }

      const credential = request.body?.credential?.trim();
      const accessToken = request.body?.accessToken?.trim();
      if (!credential && !accessToken) {
        return reply.status(400).send({ error: "Jeton Google manquant." });
      }

      let identity: GoogleIdentity | null = null;
      try {
        identity = accessToken
          ? await identityFromAccessToken(accessToken)
          : await identityFromIdToken(credential!);
      } catch {
        identity = null;
      }

      if (!identity) {
        return reply.status(401).send({ error: "Jeton Google invalide ou expiré." });
      }

      const { sub: googleSub, email, name, avatarUrl } = identity;

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
      const { getWhatsAppConnectionStatus } = await import("./whatsapp-connection.js");
      whatsapp = await getWhatsAppConnectionStatus(userId);
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
