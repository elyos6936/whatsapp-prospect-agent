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
  GOOGLE_SHEETS_REAUTH_MESSAGE,
  TYPEFORM_REAUTH_MESSAGE,
  getValidGoogleSheetsToken,
  getValidTypeformAccessToken,
} from "./integrations/access.js";
import {
  GOOGLE_CONTACTS_PROVIDER,
  GOOGLE_CONTACTS_SCOPES,
  GOOGLE_PROVIDER,
  GOOGLE_SHEETS_MAX_PER_USER,
  GOOGLE_SHEETS_PROVIDER,
  GOOGLE_SHEETS_SCOPES,
  GoogleAuthError,
  buildGoogleAuthorizeUrl,
  contactsScopesOnly,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  googleRedirectUri,
  hasGoogleContactsScope,
  isGoogleIntegrationsConfigured,
  mergeScopeStrings,
  providerForGooglePurpose,
  purposeFromGoogleProvider,
  sheetsScopesOnly,
  type GoogleOAuthPurpose,
} from "./integrations/google.js";
import { clearGoogleContactsEnsuredCache } from "./integrations/google-contacts.js";
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

export { getValidGoogleSheetsToken, getValidGoogleContactsToken, getValidTypeformAccessToken } from "./integrations/access.js";
/** @deprecated alias Sheets */
export { getValidGoogleAccessToken } from "./integrations/access.js";

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
    const contacts = integrations.find((i) => i.provider === "google_contacts");
    return {
      integrations,
      typeformConfigured: isTypeformConfigured() && isTokensEncryptionConfigured(),
      googleConfigured: isGoogleIntegrationsConfigured() && isTokensEncryptionConfigured(),
      googleContactsGranted: Boolean(
        contacts?.connected && hasGoogleContactsScope(contacts.scopes),
      ),
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

  // ── Google Sheets + Google Contacts (providers séparés) ───────────────────

  async function startGoogleOAuth(
    userId: number,
    purpose: GoogleOAuthPurpose,
  ): Promise<{ url: string; redirectUri: string; purpose: GoogleOAuthPurpose }> {
    const provider = providerForGooglePurpose(purpose);
    const state = await createOauthPendingState(userId, provider, purpose);
    const url = buildGoogleAuthorizeUrl(state, { purpose });
    console.log(
      `[google-oauth] connect user=${userId} purpose=${purpose} provider=${provider}`,
    );
    return { url, redirectUri: googleRedirectUri(), purpose };
  }

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
    return startGoogleOAuth(userId, purpose);
  });

  /** Route dédiée Contacts — pas d’ambiguïté avec Sheets. */
  app.get("/api/integrations/google/contacts/connect", async (request, reply) => {
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
    return startGoogleOAuth(userId, "contacts");
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

    const stateTrim = state.trim();
    // IMPORTANT : déduire le purpose du provider matché (pas `purpose ?? sheets`).
    // Sinon un pending Contacts sans colonne purpose écrase google_sheets.
    const matchedProviders = [
      GOOGLE_CONTACTS_PROVIDER,
      GOOGLE_SHEETS_PROVIDER,
      GOOGLE_PROVIDER,
    ] as const;
    let pending: {
      userId: number;
      purpose: string | null;
      matchedProvider: string;
    } | null = null;
    for (const p of matchedProviders) {
      const row = await consumeOauthPendingState(stateTrim, p);
      if (row) {
        pending = { ...row, matchedProvider: p };
        break;
      }
    }
    if (!pending) {
      return reply.redirect(
        appSettingsRedirect({
          google: "error",
          message: "Session OAuth expirée. Réessaie Connecter.",
        }),
      );
    }
    const userId = pending.userId;
    const purpose = purposeFromGoogleProvider(pending.matchedProvider, pending.purpose);
    const provider = providerForGooglePurpose(purpose);
    console.log(
      `[google-oauth] callback user=${userId} matched=${pending.matchedProvider} purpose=${purpose} → ${provider}`,
    );

    try {
      if (!isTokensEncryptionConfigured()) {
        throw new GoogleAuthError("TOKENS_ENCRYPTION_KEY manquante.", "config");
      }
      const tokens = await exchangeGoogleCode(code.trim());

      if (!tokens.refresh_token) {
        console.warn(
          `[google-oauth] user=${userId} provider=${provider} access_token SANS refresh_token. ` +
            "Révoquer l’accès Klanvio sur myaccount.google.com/permissions puis reconnecter.",
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

      const existing = await getUserIntegration(userId, provider);
      // Changement de compte Contacts : supprimer l'ancien grant pour forcer un refresh neuf.
      if (
        purpose === "contacts" &&
        existing?.provider_account_id &&
        accountId &&
        existing.provider_account_id !== accountId
      ) {
        await deleteUserIntegration(userId, GOOGLE_CONTACTS_PROVIDER);
      }
      const existingAfter = await getUserIntegration(userId, provider);
      const hadRefresh = Boolean(existingAfter?.refresh_token_enc);

      if (!tokens.refresh_token && !hadRefresh) {
        return reply.redirect(
          appSettingsRedirect({
            google: "error",
            message:
              "Google n’a pas renvoyé de refresh token. Révoque l’accès Klanvio sur myaccount.google.com/permissions puis reconnecte.",
          }),
        );
      }

      const scopes =
        purpose === "contacts"
          ? contactsScopesOnly(mergeScopeStrings(tokens.scope, GOOGLE_CONTACTS_SCOPES.join(" ")))
          : sheetsScopesOnly(mergeScopeStrings(tokens.scope, GOOGLE_SHEETS_SCOPES.join(" ")));

      await upsertUserIntegration({
        userId,
        provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresInSeconds: tokens.expires_in ?? null,
        scopes,
        providerAccountId: accountId,
        providerEmail: email,
      });

      if (purpose === "contacts") {
        try {
          await markGoogleContactsPromptDone(userId);
        } catch {
          /* colonne absente tant que migration non appliquée */
        }
        try {
          await clearGoogleContactsEnsuredCache(userId);
        } catch {
          /* best effort */
        }
      }

      const flashKey = purpose === "contacts" ? "contacts_connected" : "connected";
      return reply.redirect(appSettingsRedirect({ google: flashKey }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.slice(0, 180) : "Échec connexion Google.";
      return reply.redirect(appSettingsRedirect({ google: "error", message: msg }));
    }
  });

  /** Déconnexion Google Sheets uniquement — ne touche pas Contacts. */
  app.delete("/api/integrations/google", async (request) => {
    const userId = requireUserId(request);
    await deleteUserIntegration(userId, GOOGLE_SHEETS_PROVIDER);
    await deleteUserIntegration(userId, GOOGLE_PROVIDER); // legacy
    await deleteAllConnectedSheets(userId);
    return { ok: true };
  });

  /** Déconnexion Google Contacts uniquement — ne touche jamais Sheets. */
  app.delete("/api/integrations/google/contacts", async (request) => {
    const userId = requireUserId(request);
    await deleteUserIntegration(userId, GOOGLE_CONTACTS_PROVIDER);
    try {
      await clearGoogleContactsEnsuredCache(userId);
    } catch {
      /* best effort */
    }
    return { ok: true };
  });

  app.get("/api/integrations/google/picker-token", async (request, reply) => {
    const userId = requireUserId(request);
    try {
      const accessToken = await getValidGoogleSheetsToken(userId);
      const row = await getUserIntegration(userId, GOOGLE_SHEETS_PROVIDER);
      const expiresAt = row?.token_expires_at?.getTime() ?? Date.now() + 3_000_000;
      return {
        accessToken,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    } catch (err) {
      if (err instanceof GoogleAuthError && err.code === "revoked") {
        return reply.status(409).send({
          error: GOOGLE_SHEETS_REAUTH_MESSAGE,
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
    const row = await getUserIntegration(userId, GOOGLE_SHEETS_PROVIDER);
    if (!row) {
      return reply.status(409).send({
        error: "Google Sheets non connecté.",
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
