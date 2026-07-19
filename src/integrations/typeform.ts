/**
 * Client OAuth + API Typeform (scopes : offline, forms:read, responses:read, accounts:read).
 */

import { config } from "../config.js";

export const TYPEFORM_PROVIDER = "typeform" as const;
export const TYPEFORM_SCOPES = [
  "offline",
  "forms:read",
  "responses:read",
  "accounts:read",
] as const;

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

export type TypeformAnswerFlat = {
  fieldId: string;
  fieldTitle: string;
  type: string;
  value: string;
};

export type TypeformResponseSummary = {
  responseId: string;
  submittedAt: string | null;
  answers: TypeformAnswerFlat[];
  phone: string | null;
  email: string | null;
  name: string | null;
};

export type TypeformResponsesResult = {
  formId: string;
  totalItems: number;
  responses: TypeformResponseSummary[];
  suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }>;
};

type TypeformField = { id?: string; title?: string; type?: string; ref?: string };

function answerToString(answer: Record<string, unknown>): string {
  const type = String(answer.type ?? "");
  if (typeof answer.text === "string") return answer.text.trim();
  if (typeof answer.email === "string") return answer.email.trim();
  if (typeof answer.phone_number === "string") return answer.phone_number.trim();
  if (typeof answer.url === "string") return answer.url.trim();
  if (typeof answer.number === "number") return String(answer.number);
  if (typeof answer.boolean === "boolean") return answer.boolean ? "oui" : "non";
  if (answer.choice && typeof answer.choice === "object") {
    const c = answer.choice as { label?: string; other?: string };
    return String(c.label || c.other || "").trim();
  }
  if (Array.isArray(answer.choices)) {
    return answer.choices
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const o = c as { label?: string };
          return String(o.label ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (answer.date) return String(answer.date);
  return type ? `[${type}]` : "";
}

const PHONE_TITLE_RE = /phone|tel|téléphone|telephone|whatsapp|wa|mobile|num[eé]ro|numero/i;
const NAME_TITLE_RE = /name|nom|pr[eé]nom|prenom|full.?name|contact/i;
const EMAIL_TITLE_RE = /e-?mail|courriel/i;
const PHONE_VALUE_RE = /(?:\+?\d[\d\s.\-]{7,}\d)/;

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && PHONE_VALUE_RE.test(value);
}

/**
 * Récupère les réponses complétées d'un formulaire (+ mapping titres de champs).
 */
export async function fetchTypeformResponses(
  accessToken: string,
  formId: string,
  pageSize = 25,
): Promise<TypeformResponsesResult> {
  const capped = Math.min(Math.max(1, pageSize), 100);

  const fieldTitles = new Map<string, string>();
  try {
    const formRes = await fetch(`${API_BASE}/forms/${encodeURIComponent(formId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (formRes.status === 401 || formRes.status === 403) {
      throw new TypeformAuthError("Token Typeform invalide ou révoqué.", "revoked");
    }
    if (formRes.ok) {
      const form = (await formRes.json()) as { fields?: TypeformField[] };
      for (const f of form.fields ?? []) {
        if (f.id) fieldTitles.set(f.id, f.title || f.ref || f.id);
      }
    }
  } catch (err) {
    if (err instanceof TypeformAuthError) throw err;
    /* titres best-effort */
  }

  const url = new URL(`${API_BASE}/forms/${encodeURIComponent(formId)}/responses`);
  url.searchParams.set("page_size", String(capped));
  url.searchParams.set("completed", "true");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new TypeformAuthError(
      "Accès réponses refusé. Reconnecte Typeform dans Réglages → Intégrations pour autoriser responses:read.",
      "revoked",
    );
  }
  if (!res.ok) {
    throw new TypeformAuthError(`Typeform responses HTTP ${res.status}`, "http");
  }

  const data = (await res.json()) as {
    total_items?: number;
    items?: Array<{
      response_id?: string;
      submitted_at?: string;
      answers?: Array<Record<string, unknown>>;
    }>;
  };

  const responses: TypeformResponseSummary[] = [];
  const suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }> = [];
  const seenPhones = new Set<string>();

  for (const item of data.items ?? []) {
    const answers: TypeformAnswerFlat[] = [];
    let phone: string | null = null;
    let email: string | null = null;
    let name: string | null = null;

    for (const raw of item.answers ?? []) {
      const field = (raw.field as { id?: string; type?: string; ref?: string } | undefined) ?? {};
      const fieldId = String(field.id ?? "");
      const fieldTitle = fieldTitles.get(fieldId) || field.ref || fieldId || "champ";
      const type = String(raw.type ?? field.type ?? "");
      const value = answerToString(raw);
      if (!value) continue;
      answers.push({ fieldId, fieldTitle, type, value });

      if (type === "phone_number" || PHONE_TITLE_RE.test(fieldTitle)) {
        if (looksLikePhone(value)) phone = phone || value;
      } else if (type === "email" || EMAIL_TITLE_RE.test(fieldTitle)) {
        email = email || value;
      } else if (NAME_TITLE_RE.test(fieldTitle) || type === "short_text" || type === "long_text") {
        if (!name && value.length < 80 && !looksLikePhone(value) && !value.includes("@")) {
          if (NAME_TITLE_RE.test(fieldTitle)) name = value;
        }
      }
      if (!phone && looksLikePhone(value)) phone = value;
      if (!email && /@/.test(value) && value.includes(".")) email = value;
    }

    // Nom depuis premier short_text si pas trouvé
    if (!name) {
      const textAns = answers.find(
        (a) =>
          (a.type === "text" || a.type === "short_text") &&
          a.value.length > 1 &&
          a.value.length < 60 &&
          !looksLikePhone(a.value) &&
          !a.value.includes("@"),
      );
      if (textAns) name = textAns.value;
    }

    responses.push({
      responseId: String(item.response_id ?? ""),
      submittedAt: item.submitted_at ?? null,
      answers,
      phone,
      email,
      name,
    });

    if (phone) {
      const norm = phone.replace(/\D/g, "");
      if (!seenPhones.has(norm)) {
        seenPhones.add(norm);
        suggestedLeads.push({ name, phone, email });
      }
    }
  }

  return {
    formId,
    totalItems: data.total_items ?? responses.length,
    responses,
    suggestedLeads,
  };
}
