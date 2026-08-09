/**
 * Client OAuth + API Calendly (event types, bookings, contacts).
 * OAuth 2.0 + PKCE (S256) — access ~2h, refresh token rotation.
 */

import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

export const CALENDLY_PROVIDER = "calendly" as const;

export const CALENDLY_SCOPES = [
  "users:read",
  "event_types:read",
  "scheduled_events:read",
  "contacts:read",
] as const;

const AUTHORIZE_URL = "https://auth.calendly.com/oauth/authorize";
const TOKEN_URL = "https://auth.calendly.com/oauth/token";
const API_BASE = "https://api.calendly.com";

export class CalendlyAuthError extends Error {
  constructor(
    message: string,
    public readonly code: "revoked" | "config" | "http" | "invalid",
  ) {
    super(message);
    this.name = "CalendlyAuthError";
  }
}

export function calendlyRedirectUri(): string {
  return (
    config.calendlyRedirectUri ||
    `${config.publicUrl}/api/integrations/calendly/callback`
  );
}

export function isCalendlyConfigured(): boolean {
  return Boolean(config.calendlyClientId && config.calendlyClientSecret);
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Génère verifier + challenge PKCE (S256). */
export function generateCalendlyPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildCalendlyAuthorizeUrl(
  state: string,
  codeChallenge: string,
): string {
  if (!isCalendlyConfigured()) {
    throw new CalendlyAuthError("Calendly non configuré (CLIENT_ID / SECRET).", "config");
  }
  const params = new URLSearchParams({
    client_id: config.calendlyClientId,
    response_type: "code",
    redirect_uri: calendlyRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    scope: CALENDLY_SCOPES.join(" "),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type CalendlyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  owner?: string;
  organization?: string;
};

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(
    `${config.calendlyClientId}:${config.calendlyClientSecret}`,
  ).toString("base64")}`;
}

async function postToken(body: URLSearchParams): Promise<CalendlyTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });
  const text = await res.text();
  let raw: Record<string, unknown> = {};
  try {
    raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail = String(
      raw.error_description || raw.error || text.slice(0, 160) || `HTTP ${res.status}`,
    ).slice(0, 220);
    console.error(
      `[calendly-oauth] token HTTP ${res.status} redirect=${calendlyRedirectUri()} body=${text.slice(0, 300)}`,
    );
    const revoked =
      res.status === 401 || /invalid_grant|revok|expired/i.test(detail);
    throw new CalendlyAuthError(
      res.status === 400
        ? `${detail}. Vérifie Redirect URI Calendly = ${calendlyRedirectUri()}`
        : detail,
      revoked ? "revoked" : "http",
    );
  }
  const access = String(raw.access_token || "");
  if (!access) throw new CalendlyAuthError("Réponse token sans access_token.", "invalid");
  return {
    access_token: access,
    refresh_token: raw.refresh_token ? String(raw.refresh_token) : undefined,
    expires_in:
      typeof raw.expires_in === "number" && raw.expires_in > 0
        ? raw.expires_in
        : 7200,
    token_type: raw.token_type ? String(raw.token_type) : undefined,
    owner: raw.owner ? String(raw.owner) : undefined,
    organization: raw.organization ? String(raw.organization) : undefined,
  };
}

export async function exchangeCalendlyCode(
  code: string,
  codeVerifier: string,
): Promise<CalendlyTokenResponse> {
  if (!isCalendlyConfigured()) {
    throw new CalendlyAuthError("Calendly non configuré.", "config");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: calendlyRedirectUri(),
    code_verifier: codeVerifier,
  });
  return postToken(body);
}

export async function refreshCalendlyToken(
  refreshToken: string,
): Promise<CalendlyTokenResponse> {
  if (!isCalendlyConfigured()) {
    throw new CalendlyAuthError("Calendly non configuré.", "config");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postToken(body);
}

export type CalendlyUser = {
  uri: string;
  email?: string;
  name?: string;
  currentOrganization?: string;
};

export async function fetchCalendlyUser(accessToken: string): Promise<CalendlyUser> {
  const res = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new CalendlyAuthError("Token Calendly invalide ou révoqué.", "revoked");
  }
  if (!res.ok) {
    throw new CalendlyAuthError(`Calendly /users/me HTTP ${res.status}`, "http");
  }
  const data = (await res.json()) as {
    resource?: {
      uri?: string;
      email?: string;
      name?: string;
      current_organization?: string;
    };
  };
  const r = data.resource ?? {};
  if (!r.uri) throw new CalendlyAuthError("Calendly /users/me sans uri.", "invalid");
  return {
    uri: r.uri,
    email: r.email,
    name: r.name,
    currentOrganization: r.current_organization,
  };
}

export type CalendlyEventTypeSummary = {
  uri: string;
  uuid: string;
  name: string;
  schedulingUrl?: string;
  active?: boolean;
  duration?: number;
};

function uuidFromUri(uri: string): string {
  const parts = uri.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || uri;
}

export async function fetchCalendlyEventTypes(
  accessToken: string,
  userUri: string,
): Promise<CalendlyEventTypeSummary[]> {
  const types: CalendlyEventTypeSummary[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < 10; page++) {
    const url = new URL(`${API_BASE}/event_types`);
    url.searchParams.set("user", userUri);
    url.searchParams.set("count", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new CalendlyAuthError("Token Calendly invalide ou révoqué.", "revoked");
    }
    if (!res.ok) {
      throw new CalendlyAuthError(`Calendly /event_types HTTP ${res.status}`, "http");
    }
    const data = (await res.json()) as {
      collection?: Array<{
        uri?: string;
        name?: string;
        scheduling_url?: string;
        active?: boolean;
        duration?: number;
      }>;
      pagination?: { next_page_token?: string | null };
    };
    for (const item of data.collection ?? []) {
      if (!item.uri) continue;
      types.push({
        uri: item.uri,
        uuid: uuidFromUri(item.uri),
        name: item.name || "Sans titre",
        schedulingUrl: item.scheduling_url,
        active: item.active,
        duration: item.duration,
      });
    }
    pageToken = data.pagination?.next_page_token ?? null;
    if (!pageToken) break;
  }

  return types;
}

export type CalendlyBookingSummary = {
  eventUri: string;
  eventUuid: string;
  eventName: string | null;
  startTime: string | null;
  inviteeUri: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  answers: Array<{ question: string; answer: string }>;
};

export type CalendlyBookingsResult = {
  totalEvents: number;
  bookings: CalendlyBookingSummary[];
  suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }>;
};

const PHONE_TITLE_RE = /phone|tel|téléphone|telephone|whatsapp|wa|mobile|num[eé]ro|numero/i;
const PHONE_VALUE_RE = /(?:\+?\d[\d\s.\-]{7,}\d)/;

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && PHONE_VALUE_RE.test(value);
}

/**
 * Liste les RDV (scheduled events) + invitees → leads (email / téléphone custom questions).
 */
export async function fetchCalendlyBookings(
  accessToken: string,
  userUri: string,
  opts?: { eventTypeUri?: string; limit?: number },
): Promise<CalendlyBookingsResult> {
  const limit = Math.min(Math.max(1, opts?.limit ?? 25), 50);
  const url = new URL(`${API_BASE}/scheduled_events`);
  url.searchParams.set("user", userUri);
  url.searchParams.set("status", "active");
  url.searchParams.set("count", String(limit));
  if (opts?.eventTypeUri) {
    url.searchParams.set("event_type", opts.eventTypeUri);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new CalendlyAuthError(
      "Accès RDV refusé. Reconnecte Calendly dans Réglages → Intégrations (scheduled_events:read).",
      "revoked",
    );
  }
  if (!res.ok) {
    throw new CalendlyAuthError(`Calendly /scheduled_events HTTP ${res.status}`, "http");
  }

  const data = (await res.json()) as {
    collection?: Array<{
      uri?: string;
      name?: string;
      start_time?: string;
      event_type?: string;
    }>;
  };

  const bookings: CalendlyBookingSummary[] = [];
  const suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }> = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  for (const event of data.collection ?? []) {
    if (!event.uri) continue;
    const eventUuid = uuidFromUri(event.uri);
    const invRes = await fetch(
      `${API_BASE}/scheduled_events/${encodeURIComponent(eventUuid)}/invitees?count=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (invRes.status === 401 || invRes.status === 403) {
      throw new CalendlyAuthError("Token Calendly invalide ou révoqué.", "revoked");
    }
    if (!invRes.ok) continue;

    const invData = (await invRes.json()) as {
      collection?: Array<{
        uri?: string;
        name?: string;
        email?: string;
        text_reminder_number?: string | null;
        questions_and_answers?: Array<{ question?: string; answer?: string }>;
      }>;
    };

    for (const inv of invData.collection ?? []) {
      if (!inv.uri) continue;
      const answers: Array<{ question: string; answer: string }> = [];
      let phone: string | null = inv.text_reminder_number?.trim() || null;
      const email = inv.email?.trim() || null;
      const name = inv.name?.trim() || null;

      for (const qa of inv.questions_and_answers ?? []) {
        const q = String(qa.question ?? "").trim();
        const a = String(qa.answer ?? "").trim();
        if (!a) continue;
        answers.push({ question: q || "question", answer: a });
        if (!phone && (PHONE_TITLE_RE.test(q) || looksLikePhone(a))) {
          if (looksLikePhone(a)) phone = a;
        }
      }

      bookings.push({
        eventUri: event.uri,
        eventUuid,
        eventName: event.name ?? null,
        startTime: event.start_time ?? null,
        inviteeUri: inv.uri,
        name,
        email,
        phone,
        answers,
      });

      if (phone) {
        const norm = phone.replace(/\D/g, "");
        if (!seenPhones.has(norm)) {
          seenPhones.add(norm);
          suggestedLeads.push({ name, phone, email });
        }
      } else if (email) {
        const key = email.toLowerCase();
        if (!seenEmails.has(key)) {
          seenEmails.add(key);
          // Sans téléphone : on n'ajoute pas aux suggested_leads WhatsApp
        }
      }
    }
  }

  return {
    totalEvents: data.collection?.length ?? 0,
    bookings,
    suggestedLeads,
  };
}

export type CalendlyContactSummary = {
  uri: string;
  uuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
};

export type CalendlyContactsResult = {
  contacts: CalendlyContactSummary[];
  suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }>;
};

function pickContactField(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Carnet Contacts Calendly (GET /contacts) — scope contacts:read.
 * Champs variables selon la version API : parsing défensif.
 */
export async function fetchCalendlyContacts(
  accessToken: string,
  opts?: { organizationUri?: string; limit?: number },
): Promise<CalendlyContactsResult> {
  const limit = Math.min(Math.max(1, opts?.limit ?? 50), 100);
  const contacts: CalendlyContactSummary[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < 10; page++) {
    const url = new URL(`${API_BASE}/contacts`);
    url.searchParams.set("count", String(Math.min(limit, 100)));
    if (opts?.organizationUri) {
      url.searchParams.set("organization", opts.organizationUri);
    }
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new CalendlyAuthError(
        "Accès Contacts refusé. Reconnecte Calendly (scope contacts:read).",
        "revoked",
      );
    }
    if (!res.ok) {
      throw new CalendlyAuthError(`Calendly /contacts HTTP ${res.status}`, "http");
    }

    const data = (await res.json()) as {
      collection?: Array<Record<string, unknown>>;
      pagination?: { next_page_token?: string | null };
    };

    for (const raw of data.collection ?? []) {
      const uri = typeof raw.uri === "string" ? raw.uri : "";
      if (!uri) continue;
      const first = pickContactField(raw, ["first_name", "firstName"]);
      const last = pickContactField(raw, ["last_name", "lastName"]);
      const name =
        pickContactField(raw, ["name", "full_name", "fullName"]) ||
        [first, last].filter(Boolean).join(" ").trim() ||
        null;
      const email = pickContactField(raw, ["email", "primary_email"]);
      let phone = pickContactField(raw, [
        "phone",
        "phone_number",
        "phoneNumber",
        "mobile",
        "mobile_phone",
      ]);
      if (!phone && raw.phone_numbers && typeof raw.phone_numbers === "object") {
        const pn = raw.phone_numbers as Record<string, unknown>;
        phone = pickContactField(pn, ["mobile", "work", "home", "primary"]);
      }

      contacts.push({
        uri,
        uuid: uuidFromUri(uri),
        name,
        email,
        phone,
        company: pickContactField(raw, ["company", "organization_name"]),
        jobTitle: pickContactField(raw, ["job_title", "jobTitle", "title"]),
      });
    }

    pageToken = data.pagination?.next_page_token ?? null;
    if (!pageToken || contacts.length >= limit) break;
  }

  const suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }> = [];
  const seen = new Set<string>();
  for (const c of contacts.slice(0, limit)) {
    if (!c.phone || !looksLikePhone(c.phone)) continue;
    const norm = c.phone.replace(/\D/g, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    suggestedLeads.push({ name: c.name, phone: c.phone, email: c.email });
  }

  return {
    contacts: contacts.slice(0, limit),
    suggestedLeads,
  };
}
