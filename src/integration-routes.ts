/**
 * Routes Intégrations (Typeform + Google OAuth).
 * Ne touche pas aux campagnes / WhatsApp / agent.
 */

import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import { config } from "./config.js";
import {
  addConnectedSheets,
  consumeOauthPendingState,
  createOauthPendingState,
  deleteAllConnectedSheets,
  deleteUserIntegration,
  getUserIntegration,
  listConnectedSheets,
  listIntegrationStatuses,
  removeConnectedSheet,
  upsertUserIntegration,
} from "./integrations-db.js";
import {
  GOOGLE_REAUTH_MESSAGE,
  TYPEFORM_REAUTH_MESSAGE,
  getValidGoogleAccessToken,
  getValidTypeformAccessToken,
} from "./integrations/access.js";
import {
  GOOGLE_PROVIDER,
  GOOGLE_SHEETS_MAX_PER_USER,
  GOOGLE_SHEETS_SCOPES,
  GoogleAuthError,
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  googleRedirectUri,
  hasGoogleContactsScope,
  isGoogleIntegrationsConfigured,
  mergeScopeStrings,
  type GoogleOAuthPurpose,
} from "./integrations/google.js";
import { markGoogleContactsPromptDone } from "./users.js";
import {
  TYPEFORM_PROVIDER,
  TYPEFORM_SCOPES,
  TypeformAuthError,
  buildTypeformAuthorizeUrl,
  exchangeTypeformCode,
  fetchTypeformAccount,
  fetchTypeformForms,
  isTypeformConfigured,
  typeformRedirectUri,
} from "./integrations/typeform.js";
import { rawQueryParam } from "./oauth-query.js";
import { isTokensEncryptionConfigured } from "./secret-crypto.js";

export { getValidGoogleAccessToken, getValidTypeformAccessToken } from "./integrations/access.js";

function appSettingsRedirect(query: Record<string, string>): string {
  const url = new URL("/app", config.appUrl);
  url.searchParams.set("settings", "integrations");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integrations", async (request) => {
    const userId = requireUserId(request);
    const integrations = await listIntegrationStatuses(userId);
    const google = integrations.find((i) => i.provider === "google");
    return {
      integrations,
      typeformConfigured: isTypeformConfigured() && isTokensEncryptionConfigured(),
      googleConfigured: isGoogleIntegrationsConfigured() && isTokensEncryptionConfigured(),
      googleContactsGranted: hasGoogleContactsScope(google?.scopes),
    };
  });

  // ── Typeform ──────────────────────────────────────────────────────────────

  app.get("/api/integrations/typeform/connect", async (request, reply) => {
    const userId = requireUserId(request);
    if (!isTypeformConfigured()) {
      return reply.status(503).send({
        error: "Typeform n’est pas encore configuré sur le serveur (CLIENT_ID / SECRET).",
      });
    }
    if (!isTokensEncryptionConfigured()) {
      return reply.status(503).send({
        error: "TOKENS_ENCRYPTION_KEY manquante sur le serveur.",
      });
    }
    const state = await createOauthPendingState(userId, TYPEFORM_PROVIDER);
    const url = buildTypeformAuthorizeUrl(state);
    return { url, redirectUri: typeformRedirectUri() };
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/api/integrations/typeform/callback", async (request, reply) => {
    // Raw URL: ne pas laisser querystring convertir "+" → espace dans le code OAuth
    const code = rawQueryParam(request.url, "code") ?? request.query.code;
    const state = rawQueryParam(request.url, "state") ?? request.query.state;
    const error = rawQueryParam(request.url, "error") ?? request.query.error;
    const error_description =
      rawQueryParam(request.url, "error_description") ?? request.query.error_description;

    if (error) {
      const msg = error_description || error;
      return reply.redirect(
        appSettingsRedirect({ typeform: "error", message: String(msg).slice(0, 180) }),
      );
    }

    if (!code?.trim() || !state?.trim()) {
      return reply.redirect(
        appSettingsRedirect({ typeform: "error", message: "Callback OAuth incomplet." }),
      );
    }

    const pending = await consumeOauthPendingState(state.trim(), TYPEFORM_PROVIDER);
    if (!pending) {
      return reply.redirect(
        appSettingsRedirect({
          typeform: "error",
          message: "Session OAuth expirée. Réessaie Connecter.",
        }),
      );
    }
    const userId = pending.userId;

    try {
      if (!isTokensEncryptionConfigured()) {
        throw new TypeformAuthError("TOKENS_ENCRYPTION_KEY manquante.", "config");
      }
      const tokens = await exchangeTypeformCode(code.trim());
      let email: string | null = null;
      let accountId: string | null = null;
      try {
        const me = await fetchTypeformAccount(tokens.access_token);
        email = me.email?.trim() || null;
        accountId = me.alias?.trim() || null;
      } catch {
        /* profil best-effort */
      }

      await upsertUserIntegration({
        userId,
        provider: TYPEFORM_PROVIDER,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresInSeconds: tokens.expires_in ?? null,
        scopes: TYPEFORM_SCOPES.join(" "),
        providerAccountId: accountId,
        providerEmail: email,
      });

      return reply.redirect(appSettingsRedirect({ typeform: "connected" }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.slice(0, 280) : "Échec connexion Typeform.";
      return reply.redirect(appSettingsRedirect({ typeform: "error", message: msg }));
    }
  });

  app.delete("/api/integrations/typeform", async (request) => {
    const userId = requireUserId(request);
    await deleteUserIntegration(userId, TYPEFORM_PROVIDER);
    return { ok: true };
  });

  app.get("/api/integrations/typeform/forms", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const accessToken = await getValidTypeformAccessToken(userId);
      const forms = await fetchTypeformForms(accessToken);
      return { forms };
    } catch (err) {
      if (err instanceof TypeformAuthError && err.code === "revoked") {
        await deleteUserIntegration(userId, TYPEFORM_PROVIDER);
        return reply.status(409).send({
          error: TYPEFORM_REAUTH_MESSAGE,
          code: "typeform_reauth_required",
        });
      }
      if (err instanceof TypeformAuthError) {
        return reply.status(502).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // ── Google (Sheets + Contacts / People) ───────────────────────────────────

  app.get<{
    Querystring: { for?: string };
  }>("/api/integrations/google/connect", async (request, reply) => {
    const userId = requireUserId(request);
    if (!isGoogleIntegrationsConfigured()) {
      return reply.status(503).send({
        error:
          "Google n’est pas encore configuré sur le serveur (GOOGLE_INTEGRATIONS_CLIENT_ID / SECRET).",
      });
    }
    if (!isTokensEncryptionConfigured()) {
      return reply.status(503).send({
        error: "TOKENS_ENCRYPTION_KEY manquante sur le serveur.",
      });
    }

    const forRaw = String(request.query.for ?? "sheets").toLowerCase();
    const purpose: GoogleOAuthPurpose = forRaw === "contacts" ? "contacts" : "sheets";
    const existing = await getUserIntegration(userId, GOOGLE_PROVIDER);
    const alreadyConnected = Boolean(existing);

    const state = await createOauthPendingState(userId, GOOGLE_PROVIDER, purpose);
    const url = buildGoogleAuthorizeUrl(state, { purpose, alreadyConnected });
    return { url, redirectUri: googleRedirectUri(), purpose };
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/api/integrations/google/callback", async (request, reply) => {
    const code = rawQueryParam(request.url, "code") ?? request.query.code;
    const state = rawQueryParam(request.url, "state") ?? request.query.state;
    const error = rawQueryParam(request.url, "error") ?? request.query.error;

    if (error) {
      return reply.redirect(
        appSettingsRedirect({ google: "error", message: String(error).slice(0, 180) }),
      );
    }

    if (!code?.trim() || !state?.trim()) {
      return reply.redirect(
        appSettingsRedirect({ google: "error", message: "Callback OAuth incomplet." }),
      );
    }

    const pending = await consumeOauthPendingState(state.trim(), GOOGLE_PROVIDER);
    if (!pending) {
      return reply.redirect(
        appSettingsRedirect({
          google: "error",
          message: "Session OAuth expirée. Réessaie Connecter.",
        }),
      );
    }
    const userId = pending.userId;

    try {
      if (!isTokensEncryptionConfigured()) {
        throw new GoogleAuthError("TOKENS_ENCRYPTION_KEY manquante.", "config");
      }
      const tokens = await exchangeGoogleCode(code.trim());

      if (!tokens.refresh_token) {
        console.warn(
          `[google-oauth] user=${userId} access_token reçu SANS refresh_token. ` +
            "Google ne renvoie le refresh qu’au premier consentement (prompt=consent). " +
            "L’user doit révoquer l’accès Klanvio sur https://myaccount.google.com/permissions " +
            "puis reconnecter Google dans Réglages → Intégrations.",
        );
      }

      let email: string | null = null;
      let accountId: string | null = null;
      try {
        const me = await fetchGoogleUserInfo(tokens.access_token);
        email = me.email?.trim() || null;
        accountId = me.sub?.trim() || null;
      } catch {
        /* profil best-effort */
      }

      const existing = await getUserIntegration(userId, GOOGLE_PROVIDER);
      const hadRefresh = Boolean(existing?.refresh_token_enc);

      if (!tokens.refresh_token && !hadRefresh) {
        return reply.redirect(
          appSettingsRedirect({
            google: "error",
            message:
              "Google n’a pas renvoyé de refresh token. Révoque l’accès Klanvio sur myaccount.google.com/permissions puis reconnecte.",
          }),
        );
      }

      const mergedScopes = mergeScopeStrings(
        tokens.scope,
        existing?.scopes,
        pending.purpose === "contacts" ? undefined : GOOGLE_SHEETS_SCOPES.join(" "),
      );

      await upsertUserIntegration({
        userId,
        provider: GOOGLE_PROVIDER,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresInSeconds: tokens.expires_in ?? null,
        scopes: mergedScopes || GOOGLE_SHEETS_SCOPES.join(" "),
        providerAccountId: accountId,
        providerEmail: email,
      });

      if (hasGoogleContactsScope(mergedScopes) || pending.purpose === "contacts") {
        try {
          await markGoogleContactsPromptDone(userId);
        } catch {
          /* colonne absente tant que migration non appliquée */
        }
      }

      const flashKey =
        pending.purpose === "contacts" || hasGoogleContactsScope(tokens.scope)
          ? "contacts_connected"
          : "connected";
      return reply.redirect(appSettingsRedirect({ google: flashKey }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.slice(0, 180) : "Échec connexion Google.";
      return reply.redirect(appSettingsRedirect({ google: "error", message: msg }));
    }
  });

  app.delete("/api/integrations/google", async (request) => {
    const userId = requireUserId(request);
    await deleteUserIntegration(userId, GOOGLE_PROVIDER);
    await deleteAllConnectedSheets(userId);
    return { ok: true };
  });

  app.get("/api/integrations/google/picker-token", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const accessToken = await getValidGoogleAccessToken(userId);
      const row = await getUserIntegration(userId, GOOGLE_PROVIDER);
      const expiresAt = row?.token_expires_at?.getTime() ?? Date.now() + 3_000_000;
      return {
        accessToken,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    } catch (err) {
      if (err instanceof GoogleAuthError && err.code === "revoked") {
        return reply.status(409).send({
          error: GOOGLE_REAUTH_MESSAGE,
          code: "google_reauth_required",
        });
      }
      if (err instanceof GoogleAuthError) {
        return reply.status(502).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.get("/api/integrations/google/sheets", async (request) => {
    const userId = requireUserId(request);
    const sheets = await listConnectedSheets(userId);
    return { sheets, max: GOOGLE_SHEETS_MAX_PER_USER };
  });

  app.post<{
    Body: { sheets?: Array<{ id?: string; title?: string }> };
  }>("/api/integrations/google/sheets", async (request, reply) => {
    const userId = requireUserId(request);
    const row = await getUserIntegration(userId, GOOGLE_PROVIDER);
    if (!row) {
      return reply.status(409).send({
        error: "Google non connecté.",
        code: "google_reauth_required",
      });
    }

    const incoming = Array.isArray(request.body?.sheets) ? request.body.sheets : [];
    const mapped = incoming.map((s) => ({
      spreadsheetId: String(s.id ?? "").trim(),
      title: String(s.title ?? "").trim(),
    }));

    try {
      const result = await addConnectedSheets(userId, mapped, GOOGLE_SHEETS_MAX_PER_USER);
      const sheets = await listConnectedSheets(userId);
      return { ...result, sheets, max: GOOGLE_SHEETS_MAX_PER_USER };
    } catch (err) {
      const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
      if (code === "limit") {
        return reply.status(400).send({
          error:
            err instanceof Error
              ? err.message
              : `Limite de ${GOOGLE_SHEETS_MAX_PER_USER} Sheets atteinte.`,
          code: "sheets_limit",
          max: GOOGLE_SHEETS_MAX_PER_USER,
        });
      }
      throw err;
    }
  });

  app.delete<{
    Params: { spreadsheetId: string };
  }>("/api/integrations/google/sheets/:spreadsheetId", async (request, reply) => {
    const userId = requireUserId(request);
    const spreadsheetId = decodeURIComponent(request.params.spreadsheetId || "").trim();
    if (!spreadsheetId) {
      return reply.status(400).send({ error: "spreadsheetId manquant." });
    }
    const removed = await removeConnectedSheet(userId, spreadsheetId);
    if (!removed) {
      return reply.status(404).send({ error: "Sheet non trouvé." });
    }
    const sheets = await listConnectedSheets(userId);
    return { ok: true, sheets, max: GOOGLE_SHEETS_MAX_PER_USER };
  });
}
