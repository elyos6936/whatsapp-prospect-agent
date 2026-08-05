/**
 * Client OAuth Google (intégrations — Sheets + Contacts / People API).
 * Deux providers distincts : comptes Google indépendants possibles.
 * Client OAuth séparé du login GIS (GOOGLE_CLIENT_ID).
 */

import { config } from "../config.js";

/** @deprecated legacy — migrer vers google_sheets / google_contacts */
export const GOOGLE_PROVIDER = "google" as const;

export const GOOGLE_SHEETS_PROVIDER = "google_sheets" as const;
export const GOOGLE_CONTACTS_PROVIDER = "google_contacts" as const;

/** Scopes Sheets / Drive. */
export const GOOGLE_SHEETS_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

/**
 * People API — lecture/écriture des contacts (pas contacts.readonly).
 * + openid/email pour afficher le compte connecté.
 */
export const GOOGLE_CONTACTS_SCOPE =
  "https://www.googleapis.com/auth/contacts" as const;

export const GOOGLE_CONTACTS_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  GOOGLE_CONTACTS_SCOPE,
] as const;

/** Tous les scopes intégrations (doc / référence). */
export const GOOGLE_SCOPES = [
  ...GOOGLE_SHEETS_SCOPES,
  GOOGLE_CONTACTS_SCOPE,
] as const;

export type GoogleOAuthPurpose = "sheets" | "contacts";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const PEOPLE_BASE = "https://people.googleapis.com/v1";

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

export function mergeScopeStrings(
  ...parts: Array<string | null | undefined>
): string {
  const set = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const s of part.split(/\s+/)) {
      if (s.trim()) set.add(s.trim());
    }
  }
  return [...set].join(" ");
}

/** True si le scope Contacts (écriture People) est présent. */
export function hasGoogleContactsScope(scopes: string | null | undefined): boolean {
  if (!scopes) return false;
  return scopes
    .split(/\s+/)
    .some((s) => s === GOOGLE_CONTACTS_SCOPE || s === "https://www.googleapis.com/auth/contacts");
}

/** True si au moins un scope Sheets/Drive est présent. */
export function hasGoogleSheetsScope(scopes: string | null | undefined): boolean {
  if (!scopes) return false;
  const set = new Set(scopes.split(/\s+/).filter(Boolean));
  return (
    set.has("https://www.googleapis.com/auth/spreadsheets") ||
    set.has("https://www.googleapis.com/auth/drive.file")
  );
}

/** Ne conserve que les scopes Sheets (retire Contacts). */
export function sheetsScopesOnly(scopes: string | null | undefined): string {
  const contacts = new Set([
    GOOGLE_CONTACTS_SCOPE,
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.readonly",
  ]);
  const kept = (scopes ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !contacts.has(s));
  const merged = mergeScopeStrings(kept.join(" "), GOOGLE_SHEETS_SCOPES.join(" "));
  return merged || GOOGLE_SHEETS_SCOPES.join(" ");
}

/** Ne conserve que les scopes Contacts (+ identité). */
export function contactsScopesOnly(scopes: string | null | undefined): string {
  const base = new Set<string>(GOOGLE_CONTACTS_SCOPES);
  const kept = (scopes ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s && (base.has(s) || s === GOOGLE_CONTACTS_SCOPE));
  return mergeScopeStrings(kept.join(" "), GOOGLE_CONTACTS_SCOPES.join(" "));
}

export function providerForGooglePurpose(purpose: GoogleOAuthPurpose): string {
  return purpose === "contacts" ? GOOGLE_CONTACTS_PROVIDER : GOOGLE_SHEETS_PROVIDER;
}

/** Déduit le purpose OAuth depuis le provider pending (source de vérité). */
export function purposeFromGoogleProvider(
  provider: string,
  purposeHint?: string | null,
): GoogleOAuthPurpose {
  if (provider === GOOGLE_CONTACTS_PROVIDER) return "contacts";
  if (provider === GOOGLE_SHEETS_PROVIDER) return "sheets";
  // Legacy provider=google : se fier au hint purpose
  return purposeHint === "contacts" ? "contacts" : "sheets";
}

export function buildGoogleAuthorizeUrl(
  state: string,
  options?: { purpose?: GoogleOAuthPurpose },
): string {
  if (!isGoogleIntegrationsConfigured()) {
    throw new GoogleAuthError(
      "Google Integrations non configuré (CLIENT_ID / SECRET).",
      "config",
    );
  }
  const purpose = options?.purpose ?? "sheets";
  const scope =
    purpose === "contacts"
      ? GOOGLE_CONTACTS_SCOPES.join(" ")
      : GOOGLE_SHEETS_SCOPES.join(" ");
  const params = new URLSearchParams({
    client_id: config.googleIntegrationsClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope,
    state,
    access_type: "offline",
    include_granted_scopes: "true",
    // Contacts : choisir explicitement un compte (≠ Sheets). Sheets : consent refresh.
    prompt: purpose === "contacts" ? "select_account consent" : "consent",
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

/** Digits-only key depuis un JID WhatsApp / numéro. null si LID ou invalide. */
export function phoneKeyFromWhatsAppId(phoneOrJid: string): string | null {
  const raw = String(phoneOrJid ?? "").trim();
  if (!raw) return null;
  if (/@lid$/i.test(raw) || raw.toLowerCase().includes("@lid")) return null;
  if (/@g\.us$/i.test(raw) || /@newsletter/i.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  // Bénin : +229 01 XX XX XX XX → sans le 01 national
  if (digits.startsWith("22901") && digits.length === 14) {
    digits = `229${digits.slice(5)}`;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function toE164Display(phoneKey: string): string {
  const d = phoneKey.replace(/\D/g, "");
  return d ? `+${d}` : "";
}

/** Comparaison stricte de numéros (évite les faux positifs endsWith). */
export function phonesMatchStrict(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if (!da || !db || da.length < 8 || db.length < 8) return false;
  if (da === db) return true;
  // Même numéro avec/sans indicatif pays (ex. 01… vs 22901…)
  const shorter = da.length <= db.length ? da : db;
  const longer = da.length > db.length ? da : db;
  if (longer.endsWith(shorter) && shorter.length >= 9 && longer.length - shorter.length <= 4) {
    return true;
  }
  return false;
}

/**
 * Recherche un contact People par numéro.
 * Retourne resourceName si trouvé, sinon null.
 */
export async function searchGoogleContactByPhone(
  accessToken: string,
  phoneKey: string,
): Promise<string | null> {
  const query = toE164Display(phoneKey) || phoneKey;
  const url = new URL(`${PEOPLE_BASE}/people:searchContacts`);
  url.searchParams.set("query", query);
  url.searchParams.set("readMask", "names,phoneNumbers");
  url.searchParams.set("pageSize", "10");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError("Token Google invalide ou People API refusée.", "revoked");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GoogleAuthError(
      `People searchContacts HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      "http",
    );
  }

  const data = (await res.json()) as {
    results?: Array<{
      person?: {
        resourceName?: string;
        phoneNumbers?: Array<{ value?: string; canonicalForm?: string }>;
      };
    }>;
  };

  for (const r of data.results ?? []) {
    const person = r.person;
    if (!person?.resourceName) continue;
    const phones = person.phoneNumbers ?? [];
    const match = phones.some((p) =>
      phonesMatchStrict(String(p.canonicalForm || p.value || ""), phoneKey),
    );
    if (match) return person.resourceName;
  }
  return null;
}

/** Vérifie qu'une fiche People existe encore et porte bien ce numéro. */
export async function getGoogleContactByResource(
  accessToken: string,
  resourceName: string,
  expectedPhoneKey?: string,
): Promise<{ resourceName: string; displayName: string | null } | null> {
  const rn = resourceName.replace(/^people\//, "");
  const url = new URL(`${PEOPLE_BASE}/people/${rn}`);
  url.searchParams.set("personFields", "names,phoneNumbers,memberships");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError("Token Google invalide ou People API refusée.", "revoked");
  }
  if (!res.ok) return null;

  const data = (await res.json()) as {
    resourceName?: string;
    names?: Array<{ displayName?: string; givenName?: string }>;
    phoneNumbers?: Array<{ value?: string; canonicalForm?: string }>;
  };
  if (!data.resourceName) return null;

  if (expectedPhoneKey) {
    const phones = data.phoneNumbers ?? [];
    const match = phones.some((p) =>
      phonesMatchStrict(String(p.canonicalForm || p.value || ""), expectedPhoneKey),
    );
    if (!match) return null;
  }

  const displayName =
    data.names?.[0]?.displayName?.trim() ||
    data.names?.[0]?.givenName?.trim() ||
    null;
  return { resourceName: data.resourceName, displayName };
}

export async function createGoogleContact(
  accessToken: string,
  input: { name: string; phoneE164: string },
): Promise<string | null> {
  const given = input.name.trim() || input.phoneE164;
  const res = await fetch(`${PEOPLE_BASE}/people:createContact`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      names: [{ givenName: given.slice(0, 100) }],
      phoneNumbers: [{ value: input.phoneE164, type: "mobile" }],
      memberships: [
        {
          contactGroupMembership: {
            contactGroupResourceName: "contactGroups/myContacts",
          },
        },
      ],
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError("Token Google invalide ou People API refusée.", "revoked");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GoogleAuthError(
      `People createContact HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
      "http",
    );
  }
  const data = (await res.json()) as { resourceName?: string };
  const resourceName = data.resourceName ?? null;
  if (resourceName) {
    // Force « Mes contacts » — sinon la fiche peut rester invisible / non sync téléphone.
    await addContactToMyContacts(accessToken, resourceName).catch((err) => {
      console.warn(
        `[google-contacts] membership myContacts: ${
          err instanceof Error ? err.message.slice(0, 120) : String(err)
        }`,
      );
    });
  }
  return resourceName;
}

/** Ajoute une fiche au groupe « Mes contacts » (sync téléphone). */
export async function addContactToMyContacts(
  accessToken: string,
  resourceName: string,
): Promise<void> {
  const rn = resourceName.startsWith("people/") ? resourceName : `people/${resourceName}`;
  const res = await fetch(
    `${PEOPLE_BASE}/contactGroups/myContacts/members:modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resourceNamesToAdd: [rn] }),
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError("Token Google invalide ou People API refusée.", "revoked");
  }
  if (!res.ok && res.status !== 400) {
    // 400 = déjà membre — OK
    const body = await res.text().catch(() => "");
    throw new GoogleAuthError(
      `contactGroups.members.modify HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
      "http",
    );
  }
}

/** Met à jour le nom d'une fiche existante (si on a un meilleur pushName). */
export async function updateGoogleContactName(
  accessToken: string,
  resourceName: string,
  name: string,
): Promise<boolean> {
  const given = name.trim().slice(0, 100);
  if (!given) return false;
  const rn = resourceName.startsWith("people/") ? resourceName : `people/${resourceName}`;
  const getUrl = new URL(`${PEOPLE_BASE}/${rn}`);
  getUrl.searchParams.set("personFields", "names,metadata");
  const existing = await fetch(getUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!existing.ok) return false;
  const person = (await existing.json()) as {
    etag?: string;
    names?: Array<{ givenName?: string; displayName?: string }>;
  };
  const current =
    person.names?.[0]?.displayName?.trim() || person.names?.[0]?.givenName?.trim() || "";
  if (current === given) return true;

  const res = await fetch(
    `${PEOPLE_BASE}/${rn}:updateContact?updatePersonFields=names`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        etag: person.etag,
        names: [{ givenName: given }],
      }),
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new GoogleAuthError("Token Google invalide ou People API refusée.", "revoked");
  }
  return res.ok;
}
