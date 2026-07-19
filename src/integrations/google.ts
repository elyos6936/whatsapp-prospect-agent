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

const SHEETS_VALUES_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type SpreadsheetValuesResult = {
  range: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  suggestedLeads: Array<{ name: string | null; phone: string }>;
  totalRows: number;
};

const PHONE_HEADER_RE = /^(phone|tel|téléphone|telephone|whatsapp|wa|mobile|num[eé]ro|numero|cell)$/i;
const NAME_HEADER_RE = /^(name|nom|pr[eé]nom|prenom|full.?name|contact|client)$/i;
const PHONE_VALUE_RE = /(?:\+?\d[\d\s.\-]{7,}\d)/;

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && PHONE_VALUE_RE.test(value);
}

function suggestLeads(
  headers: string[],
  rows: Array<Record<string, string>>,
): Array<{ name: string | null; phone: string }> {
  const phoneCols = headers.filter((h) => PHONE_HEADER_RE.test(h.trim()));
  const nameCols = headers.filter((h) => NAME_HEADER_RE.test(h.trim()));
  const leads: Array<{ name: string | null; phone: string }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    let phone: string | null = null;
    if (phoneCols.length) {
      for (const col of phoneCols) {
        const v = String(row[col] ?? "").trim();
        if (v && looksLikePhone(v)) {
          phone = v;
          break;
        }
      }
    }
    if (!phone) {
      for (const h of headers) {
        const v = String(row[h] ?? "").trim();
        if (v && looksLikePhone(v)) {
          phone = v;
          break;
        }
      }
    }
    if (!phone) continue;
    const norm = phone.replace(/\D/g, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    let name: string | null = null;
    for (const col of nameCols) {
      const v = String(row[col] ?? "").trim();
      if (v) {
        name = v;
        break;
      }
    }
    leads.push({ name, phone });
  }
  return leads;
}

/**
 * Lit une plage de valeurs via Sheets API v4.
 * `range` ex. "A1:Z50" ou "Feuille1!A1:Z50".
 */
export async function fetchSpreadsheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  maxRows = 50,
): Promise<SpreadsheetValuesResult> {
  const capped = Math.min(Math.max(1, maxRows), 100);
  const encodedRange = encodeURIComponent(range);
  const url = `${SHEETS_VALUES_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?majorDimension=ROWS`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError("Token Google invalide ou accès Sheet refusé.", "revoked");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GoogleAuthError(
      `Sheets API HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      "http",
    );
  }

  const data = (await res.json()) as {
    range?: string;
    values?: string[][];
  };
  const values = data.values ?? [];
  if (values.length === 0) {
    return {
      range: data.range || range,
      headers: [],
      rows: [],
      suggestedLeads: [],
      totalRows: 0,
    };
  }

  const rawHeaders = (values[0] ?? []).map((h, i) => {
    const t = String(h ?? "").trim();
    return t || `col_${i + 1}`;
  });
  const dataRows = values.slice(1, 1 + capped);
  const rows = dataRows.map((line) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      obj[rawHeaders[i]!] = String(line[i] ?? "").trim();
    }
    return obj;
  });

  return {
    range: data.range || range,
    headers: rawHeaders,
    rows,
    suggestedLeads: suggestLeads(rawHeaders, rows),
    totalRows: Math.max(0, values.length - 1),
  };
}
