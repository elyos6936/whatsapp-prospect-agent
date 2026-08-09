/**
 * Access tokens intégrations (refresh + révocation).
 * Partagé entre routes HTTP et tools agent.
 * Google Sheets et Google Contacts : tokens / révocation isolés.
 */

import {
  decryptIntegrationTokens,
  deleteAllConnectedSheets,
  deleteUserIntegration,
  getUserIntegration,
  upsertUserIntegration,
} from "../integrations-db.js";
import {
  GOOGLE_CONTACTS_PROVIDER,
  GOOGLE_CONTACTS_SCOPES,
  GOOGLE_SHEETS_PROVIDER,
  GOOGLE_SHEETS_SCOPES,
  GoogleAuthError,
  contactsScopesOnly,
  mergeScopeStrings,
  refreshGoogleToken,
  sheetsScopesOnly,
} from "./google.js";
import {
  CALENDLY_PROVIDER,
  CALENDLY_SCOPES,
  CalendlyAuthError,
  refreshCalendlyToken,
} from "./calendly.js";
import { TALLY_PROVIDER, TallyAuthError } from "./tally.js";
import {
  TYPEFORM_PROVIDER,
  TYPEFORM_SCOPES,
  TypeformAuthError,
  refreshTypeformToken,
} from "./typeform.js";

export const TYPEFORM_REAUTH_MESSAGE =
  "Connexion Typeform expirée ou révoquée. Reconnecte Typeform dans Réglages → Intégrations.";

export const CALENDLY_REAUTH_MESSAGE =
  "Connexion Calendly expirée ou révoquée. Reconnecte Calendly dans Réglages → Intégrations.";

export const TALLY_REAUTH_MESSAGE =
  "Clé API Tally invalide ou révoquée. Reconnecte Tally dans Réglages → Intégrations.";

export const GOOGLE_REAUTH_MESSAGE =
  "Connexion Google expirée ou révoquée. Reconnecte Google dans Réglages → Intégrations.";

export const GOOGLE_SHEETS_REAUTH_MESSAGE =
  "Connexion Google Sheets expirée ou révoquée. Reconnecte Google Sheets dans Réglages → Intégrations.";

export const GOOGLE_CONTACTS_REAUTH_MESSAGE =
  "Connexion Google Contacts expirée ou révoquée. Reconnecte Google Contacts dans Réglages → Intégrations.";

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

async function getValidGoogleTokenForProvider(
  userId: number,
  provider: typeof GOOGLE_SHEETS_PROVIDER | typeof GOOGLE_CONTACTS_PROVIDER,
): Promise<string> {
  const isSheets = provider === GOOGLE_SHEETS_PROVIDER;
  const reauthMsg = isSheets ? GOOGLE_SHEETS_REAUTH_MESSAGE : GOOGLE_CONTACTS_REAUTH_MESSAGE;
  const defaultScopes = isSheets
    ? GOOGLE_SHEETS_SCOPES.join(" ")
    : GOOGLE_CONTACTS_SCOPES.join(" ");
  const scopeNormalizer = isSheets ? sheetsScopesOnly : contactsScopesOnly;

  const row = await getUserIntegration(userId, provider);
  if (!row) {
    throw new GoogleAuthError(
      isSheets ? "Google Sheets non connecté." : "Google Contacts non connecté.",
      "revoked",
    );
  }

  const { accessToken, refreshToken } = decryptIntegrationTokens(row);
  const expiresAt = row.token_expires_at?.getTime() ?? 0;
  const needsRefresh = !expiresAt || expiresAt < Date.now() + 120_000;

  if (!needsRefresh) return accessToken;

  const purgeThisProviderOnly = async () => {
    await deleteUserIntegration(userId, provider);
    if (isSheets) {
      await deleteAllConnectedSheets(userId);
    }
    // Contacts : ne jamais toucher Sheets / user_connected_sheets
  };

  if (!refreshToken) {
    await purgeThisProviderOnly();
    throw new GoogleAuthError(reauthMsg, "revoked");
  }

  try {
    const tokens = await refreshGoogleToken(refreshToken);
    await upsertUserIntegration({
      userId,
      provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresInSeconds: tokens.expires_in ?? null,
      scopes: scopeNormalizer(mergeScopeStrings(tokens.scope, row.scopes, defaultScopes)),
      providerAccountId: row.provider_account_id,
      providerEmail: row.provider_email,
    });
    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "revoked") {
      await purgeThisProviderOnly();
      throw new GoogleAuthError(reauthMsg, "revoked");
    }
    if (!needsRefresh || expiresAt > Date.now()) return accessToken;
    await purgeThisProviderOnly();
    throw new GoogleAuthError(reauthMsg, "revoked");
  }
}

/** Access token Google Sheets (isolé — une révocation ne touche pas Contacts). */
export async function getValidGoogleSheetsToken(userId: number): Promise<string> {
  return getValidGoogleTokenForProvider(userId, GOOGLE_SHEETS_PROVIDER);
}

/** Access token Google Contacts (isolé — une révocation ne touche pas Sheets). */
export async function getValidGoogleContactsToken(userId: number): Promise<string> {
  return getValidGoogleTokenForProvider(userId, GOOGLE_CONTACTS_PROVIDER);
}

/** Évite 2 refresh parallèles (rotation refresh token → invalid_grant → déconnexion). */
const calendlyRefreshInflight = new Map<number, Promise<string>>();

/** Access token Calendly valide (refresh ~2h + rotation du refresh token). */
export async function getValidCalendlyAccessToken(userId: number): Promise<string> {
  const row = await getUserIntegration(userId, CALENDLY_PROVIDER);
  if (!row) {
    throw new CalendlyAuthError("Calendly non connecté.", "revoked");
  }

  const { accessToken, refreshToken } = decryptIntegrationTokens(row);
  const expiresAt = row.token_expires_at?.getTime() ?? 0;
  const stillValid = expiresAt > Date.now() + 120_000;

  if (stillValid) return accessToken;

  if (!refreshToken) {
    await deleteUserIntegration(userId, CALENDLY_PROVIDER);
    throw new CalendlyAuthError(CALENDLY_REAUTH_MESSAGE, "revoked");
  }

  const inflight = calendlyRefreshInflight.get(userId);
  if (inflight) return inflight;

  const refreshJob = (async () => {
    try {
      const tokens = await refreshCalendlyToken(refreshToken);
      await upsertUserIntegration({
        userId,
        provider: CALENDLY_PROVIDER,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? refreshToken,
        expiresInSeconds: tokens.expires_in ?? null,
        scopes: CALENDLY_SCOPES.join(" "),
        providerAccountId: row.provider_account_id,
        providerEmail: row.provider_email,
      });
      return tokens.access_token;
    } catch (err) {
      if (err instanceof CalendlyAuthError && err.code === "revoked") {
        await deleteUserIntegration(userId, CALENDLY_PROVIDER);
        throw new CalendlyAuthError(CALENDLY_REAUTH_MESSAGE, "revoked");
      }
      if (expiresAt > Date.now()) return accessToken;
      await deleteUserIntegration(userId, CALENDLY_PROVIDER);
      throw new CalendlyAuthError(CALENDLY_REAUTH_MESSAGE, "revoked");
    } finally {
      calendlyRefreshInflight.delete(userId);
    }
  })();

  calendlyRefreshInflight.set(userId, refreshJob);
  return refreshJob;
}

/** Clé API Tally stockée chiffrée (pas d'expiry OAuth). */
export async function getValidTallyApiKey(userId: number): Promise<string> {
  const row = await getUserIntegration(userId, TALLY_PROVIDER);
  if (!row) {
    throw new TallyAuthError("Tally non connecté.", "revoked");
  }
  const { accessToken } = decryptIntegrationTokens(row);
  if (!accessToken?.trim()) {
    await deleteUserIntegration(userId, TALLY_PROVIDER);
    throw new TallyAuthError(TALLY_REAUTH_MESSAGE, "revoked");
  }
  return accessToken;
}

/**
 * @deprecated Prefer getValidGoogleSheetsToken — alias pour tools / routes Sheets.
 */
export async function getValidGoogleAccessToken(userId: number): Promise<string> {
  return getValidGoogleSheetsToken(userId);
}
