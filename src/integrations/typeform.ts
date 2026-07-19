/**
 * Client OAuth + API Typeform (scopes : offline, forms:read, accounts:read).
 */

import { config } from "../config.js";

export const TYPEFORM_PROVIDER = "typeform" as const;
export const TYPEFORM_SCOPES = ["offline", "forms:read", "accounts:read"] as const;

const AUTHORIZE_URL = "https://api.typeform.com/oauth/authorize";
const TOKEN_URL = "https://api.typeform.com/oauth/token";
const API_BASE = "https://api.typeform.com";

export class TypeformAuthError extends Error {
  constructor(
    message: string,
    public readonly code: "revoked" | "config" | "http" | "invalid",
  ) {
    super(message);
    this.name = "TypeformAuthError";
  }
}

export function typeformRedirectUri(): string {
  return (
    config.typeformRedirectUri ||
    `${config.publicUrl}/api/integrations/typeform/callback`
  );
}

export function isTypeformConfigured(): boolean {
  return Boolean(config.typeformClientId && config.typeformClientSecret);
}

export function buildTypeformAuthorizeUrl(state: string): string {
  if (!isTypeformConfigured()) {
    throw new TypeformAuthError("Typeform non configuré (CLIENT_ID / SECRET).", "config");
  }
  const params = new URLSearchParams({
    client_id: config.typeformClientId,
    redirect_uri: typeformRedirectUri(),
    scope: TYPEFORM_SCOPES.join(" "),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type TypeformTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

async function postToken(body: URLSearchParams): Promise<TypeformTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(raw.error_description || raw.error || `HTTP ${res.status}`);
    const revoked =
      res.status === 400 ||
      res.status === 401 ||
      /invalid|revok|expired/i.test(msg);
    throw new TypeformAuthError(msg, revoked ? "revoked" : "http");
  }
  const access = String(raw.access_token || "");
  if (!access) throw new TypeformAuthError("Réponse token sans access_token.", "invalid");
  return {
    access_token: access,
    refresh_token: raw.refresh_token ? String(raw.refresh_token) : undefined,
    expires_in: typeof raw.expires_in === "number" ? raw.expires_in : undefined,
    token_type: raw.token_type ? String(raw.token_type) : undefined,
  };
}

export async function exchangeTypeformCode(code: string): Promise<TypeformTokenResponse> {
  if (!isTypeformConfigured()) {
    throw new TypeformAuthError("Typeform non configuré.", "config");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.typeformClientId,
    client_secret: config.typeformClientSecret,
    redirect_uri: typeformRedirectUri(),
  });
  return postToken(body);
}

export async function refreshTypeformToken(refreshToken: string): Promise<TypeformTokenResponse> {
  if (!isTypeformConfigured()) {
    throw new TypeformAuthError("Typeform non configuré.", "config");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.typeformClientId,
    client_secret: config.typeformClientSecret,
  });
  return postToken(body);
}

export type TypeformAccount = {
  alias?: string;
  email?: string;
  language?: string;
};

export async function fetchTypeformAccount(accessToken: string): Promise<TypeformAccount> {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new TypeformAuthError("Token Typeform invalide ou révoqué.", "revoked");
  }
  if (!res.ok) {
    throw new TypeformAuthError(`Typeform /me HTTP ${res.status}`, "http");
  }
  const data = (await res.json()) as TypeformAccount;
  return data;
}

export type TypeformFormSummary = {
  id: string;
  title: string;
  lastUpdatedAt?: string;
  createdAt?: string;
  settings?: { isPublic?: boolean };
};

export async function fetchTypeformForms(accessToken: string): Promise<TypeformFormSummary[]> {
  const forms: TypeformFormSummary[] = [];
  let page = 1;
  const pageSize = 50;

  for (;;) {
    const url = new URL(`${API_BASE}/forms`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new TypeformAuthError("Token Typeform invalide ou révoqué.", "revoked");
    }
    if (!res.ok) {
      throw new TypeformAuthError(`Typeform /forms HTTP ${res.status}`, "http");
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        title?: string;
        last_updated_at?: string;
        created_at?: string;
        settings?: { is_public?: boolean };
      }>;
      page_count?: number;
    };
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      forms.push({
        id: item.id,
        title: item.title || "Sans titre",
        lastUpdatedAt: item.last_updated_at,
        createdAt: item.created_at,
        settings: item.settings ? { isPublic: item.settings.is_public } : undefined,
      });
    }
    const pageCount = data.page_count ?? page;
    if (page >= pageCount || !(data.items?.length)) break;
    page += 1;
    if (page > 20) break; // garde-fou
  }

  return forms;
}
