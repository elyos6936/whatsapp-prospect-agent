/**
 * Client OAuth Google (intégrations — Sheets / futur Forms, Calendar).
 * Client OAuth séparé du login GIS (GOOGLE_CLIENT_ID).
 * Scopes : drive.file + spreadsheets + openid/email/profile.
 */

import { config } from "../config.js";

export const GOOGLE_PROVIDER = "google" as const;

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_SHEETS_MAX_PER_USER = 50;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public readonly code: "config" | "http" | "revoked" | "invalid" | "limit",
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function googleRedirectUri(): string {
  return (
    config.googleIntegrationsRedirectUri ||
    `${config.publicUrl}/api/integrations/google/callback`
  );
}

export function isGoogleIntegrationsConfigured(): boolean {
  return Boolean(
    config.googleIntegrationsClientId && config.googleIntegrationsClientSecret,
  );
}

export function buildGoogleAuthorizeUrl(state: string): string {
  if (!isGoogleIntegrationsConfigured()) {
    throw new GoogleAuthError(
      "Google Integrations non configuré (CLIENT_ID / SECRET).",
      "config",
    );
  }
  const params = new URLSearchParams({
    client_id: config.googleIntegrationsClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

async function postToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errCode = String(data.error ?? "");
    const msg = String(data.error_description || data.error || `Google token HTTP ${res.status}`);
    const revoked =
      errCode === "invalid_grant" ||
      /revoked|expired|invalid/i.test(msg);
    throw new GoogleAuthError(msg, revoked ? "revoked" : "http");
  }
  const access = typeof data.access_token === "string" ? data.access_token : "";
  if (!access) throw new GoogleAuthError("Réponse token sans access_token.", "invalid");
  return {
    access_token: access,
    refresh_token:
      typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    scope: typeof data.scope === "string" ? data.scope : undefined,
    token_type: typeof data.token_type === "string" ? data.token_type : undefined,
  };
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  if (!isGoogleIntegrationsConfigured()) {
    throw new GoogleAuthError("Google Integrations non configuré.", "config");
  }
  return postToken(
    new URLSearchParams({
      code,
      client_id: config.googleIntegrationsClientId,
      client_secret: config.googleIntegrationsClientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  );
}

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenResponse> {
  if (!isGoogleIntegrationsConfigured()) {
    throw new GoogleAuthError("Google Integrations non configuré.", "config");
  }
  return postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.googleIntegrationsClientId,
      client_secret: config.googleIntegrationsClientSecret,
      grant_type: "refresh_token",
    }),
  );
}

export type GoogleUserInfo = {
  sub?: string;
  email?: string;
  name?: string;
};

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    throw new GoogleAuthError("Token Google invalide ou révoqué.", "revoked");
  }
  if (!res.ok) {
    throw new GoogleAuthError(`Google userinfo HTTP ${res.status}`, "http");
  }
  return (await res.json()) as GoogleUserInfo;
}
