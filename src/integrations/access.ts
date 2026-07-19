/**
 * Access tokens intégrations (refresh + révocation).
 * Partagé entre routes HTTP et tools agent.
 */

import {
  decryptIntegrationTokens,
  deleteAllConnectedSheets,
  deleteUserIntegration,
  getUserIntegration,
  upsertUserIntegration,
} from "../integrations-db.js";
import {
  GOOGLE_PROVIDER,
  GOOGLE_SCOPES,
  GoogleAuthError,
  refreshGoogleToken,
} from "./google.js";
import {
  TYPEFORM_PROVIDER,
  TYPEFORM_SCOPES,
  TypeformAuthError,
  refreshTypeformToken,
} from "./typeform.js";

export const TYPEFORM_REAUTH_MESSAGE =
  "Connexion Typeform expirée ou révoquée. Reconnecte Typeform dans Réglages → Intégrations.";

export const GOOGLE_REAUTH_MESSAGE =
  "Connexion Google expirée ou révoquée. Reconnecte Google dans Réglages → Intégrations.";

/**
 * Renvoie un access token Typeform valide, rafraîchit si besoin.
 * Si refresh échoue (révoqué) → supprime l'intégration et throw TypeformAuthError(revoked).
 */
export async function getValidTypeformAccessToken(userId: number): Promise<string> {
  const row = await getUserIntegration(userId, TYPEFORM_PROVIDER);
  if (!row) {
    throw new TypeformAuthError("Typeform non connecté.", "revoked");
  }

  const { accessToken, refreshToken } = decryptIntegrationTokens(row);
  const expiresAt = row.token_expires_at?.getTime() ?? 0;
  const stillValid = expiresAt > Date.now() + 120_000;

  if (stillValid) return accessToken;

  // Pas de refresh (Typeform refuse souvent `offline`) → reconnect si expiré
  if (!refreshToken) {
    await deleteUserIntegration(userId, TYPEFORM_PROVIDER);
    throw new TypeformAuthError(TYPEFORM_REAUTH_MESSAGE, "revoked");
  }

  try {
    const tokens = await refreshTypeformToken(refreshToken);
    await upsertUserIntegration({
      userId,
      provider: TYPEFORM_PROVIDER,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresInSeconds: tokens.expires_in ?? null,
      scopes: TYPEFORM_SCOPES.join(" "),
      providerAccountId: row.provider_account_id,
      providerEmail: row.provider_email,
    });
    return tokens.access_token;
  } catch (err) {
    if (err instanceof TypeformAuthError && err.code === "revoked") {
      await deleteUserIntegration(userId, TYPEFORM_PROVIDER);
      throw new TypeformAuthError(TYPEFORM_REAUTH_MESSAGE, "revoked");
    }
    if (expiresAt > Date.now()) return accessToken;
    await deleteUserIntegration(userId, TYPEFORM_PROVIDER);
    throw new TypeformAuthError(TYPEFORM_REAUTH_MESSAGE, "revoked");
  }
}

/**
 * Access token Google valide (refresh si besoin).
 * Préserve le refresh token existant si Google n'en renvoie pas un nouveau.
 */
export async function getValidGoogleAccessToken(userId: number): Promise<string> {
  const row = await getUserIntegration(userId, GOOGLE_PROVIDER);
  if (!row) {
    throw new GoogleAuthError("Google non connecté.", "revoked");
  }

  const { accessToken, refreshToken } = decryptIntegrationTokens(row);
  const expiresAt = row.token_expires_at?.getTime() ?? 0;
  const needsRefresh = !expiresAt || expiresAt < Date.now() + 120_000;

  if (!needsRefresh) return accessToken;

  if (!refreshToken) {
    await deleteUserIntegration(userId, GOOGLE_PROVIDER);
    await deleteAllConnectedSheets(userId);
    throw new GoogleAuthError(GOOGLE_REAUTH_MESSAGE, "revoked");
  }

  try {
    const tokens = await refreshGoogleToken(refreshToken);
    await upsertUserIntegration({
      userId,
      provider: GOOGLE_PROVIDER,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresInSeconds: tokens.expires_in ?? null,
      scopes: tokens.scope ?? row.scopes ?? GOOGLE_SCOPES.join(" "),
      providerAccountId: row.provider_account_id,
      providerEmail: row.provider_email,
    });
    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "revoked") {
      await deleteUserIntegration(userId, GOOGLE_PROVIDER);
      await deleteAllConnectedSheets(userId);
      throw new GoogleAuthError(GOOGLE_REAUTH_MESSAGE, "revoked");
    }
    if (!needsRefresh || expiresAt > Date.now()) return accessToken;
    await deleteUserIntegration(userId, GOOGLE_PROVIDER);
    await deleteAllConnectedSheets(userId);
    throw new GoogleAuthError(GOOGLE_REAUTH_MESSAGE, "revoked");
  }
}
