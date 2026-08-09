/**
 * Client API Tally (clé API Bearer) — formulaires + soumissions → leads.
 * Docs : https://developers.tally.so/api-reference/introduction
 */

export const TALLY_PROVIDER = "tally" as const;

const API_BASE = "https://api.tally.so";
/** Pin version paginée (items / hasMore). */
const TALLY_VERSION = "2025-02-01";

export class TallyAuthError extends Error {
  constructor(
    message: string,
    public readonly code: "revoked" | "config" | "http" | "invalid",
  ) {
    super(message);
    this.name = "TallyAuthError";
  }
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "tally-version": TALLY_VERSION,
  };
}

export async function validateTallyApiKey(apiKey: string): Promise<{
  ok: true;
  email?: string;
  accountId?: string;
}> {
  const key = apiKey.trim();
  if (!key || key.length < 8) {
    throw new TallyAuthError("Clé API Tally invalide.", "invalid");
  }
  const res = await fetch(`${API_BASE}/forms?page=1&limit=1`, {
    headers: authHeaders(key),
  });
  if (res.status === 401 || res.status === 403) {
    throw new TallyAuthError("Clé API Tally refusée (401/403).", "revoked");
  }
  if (!res.ok) {
    throw new TallyAuthError(`Tally HTTP ${res.status} lors de la validation.`, "http");
  }
  return { ok: true };
}

export type TallyFormSummary = {
  id: string;
  name: string;
  status?: string;
  updatedAt?: string;
  numberOfSubmissions?: number;
};

export async function fetchTallyForms(apiKey: string): Promise<TallyFormSummary[]> {
  const forms: TallyFormSummary[] = [];
  let page = 1;

  for (;;) {
    const url = new URL(`${API_BASE}/forms`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "50");

    const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
    if (res.status === 401 || res.status === 403) {
      throw new TallyAuthError("Clé API Tally invalide ou révoquée.", "revoked");
    }
    if (!res.ok) {
      throw new TallyAuthError(`Tally /forms HTTP ${res.status}`, "http");
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        name?: string;
        status?: string;
        updatedAt?: string;
        numberOfSubmissions?: number;
      }>;
      hasMore?: boolean;
    };
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      forms.push({
        id: item.id,
        name: item.name || "Sans titre",
        status: item.status,
        updatedAt: item.updatedAt,
        numberOfSubmissions: item.numberOfSubmissions,
      });
    }
    if (!data.hasMore || !(data.items?.length)) break;
    page += 1;
    if (page > 20) break;
  }

  return forms;
}

export type TallyAnswerFlat = {
  questionId: string;
  questionTitle: string;
  type: string;
  value: string;
};

export type TallyResponseSummary = {
  submissionId: string;
  submittedAt: string | null;
  answers: TallyAnswerFlat[];
  phone: string | null;
  email: string | null;
  name: string | null;
};

export type TallyResponsesResult = {
  formId: string;
  totalItems: number;
  responses: TallyResponseSummary[];
  suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }>;
};

const PHONE_TITLE_RE = /phone|tel|téléphone|telephone|whatsapp|wa|mobile|num[eé]ro|numero/i;
const NAME_TITLE_RE = /name|nom|pr[eé]nom|prenom|full.?name|contact/i;
const EMAIL_TITLE_RE = /e-?mail|courriel/i;
const PHONE_VALUE_RE = /(?:\+?\d[\d\s.\-]{7,}\d)/;

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && PHONE_VALUE_RE.test(value);
}

function answerValueToString(answer: unknown): string {
  if (answer == null) return "";
  if (typeof answer === "string" || typeof answer === "number" || typeof answer === "boolean") {
    return String(answer).trim();
  }
  if (Array.isArray(answer)) {
    return answer
      .map((a) => {
        if (typeof a === "string") return a;
        if (a && typeof a === "object" && "text" in a) return String((a as { text?: string }).text ?? "");
        if (a && typeof a === "object" && "label" in a) return String((a as { label?: string }).label ?? "");
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof answer === "object") {
    const o = answer as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.value === "string") return o.value.trim();
    if (typeof o.label === "string") return o.label.trim();
    try {
      return JSON.stringify(answer).slice(0, 200);
    } catch {
      return "";
    }
  }
  return "";
}

export async function fetchTallyResponses(
  apiKey: string,
  formId: string,
  pageSize = 25,
): Promise<TallyResponsesResult> {
  const capped = Math.min(Math.max(1, pageSize), 100);
  const url = new URL(`${API_BASE}/forms/${encodeURIComponent(formId)}/submissions`);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", String(capped));
  url.searchParams.set("filter", "completed");

  const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
  if (res.status === 401 || res.status === 403) {
    throw new TallyAuthError("Clé API Tally invalide ou révoquée.", "revoked");
  }
  if (!res.ok) {
    throw new TallyAuthError(`Tally submissions HTTP ${res.status}`, "http");
  }

  const data = (await res.json()) as {
    questions?: Array<{ id?: string; title?: string; type?: string }>;
    submissions?: Array<{
      id?: string;
      submittedAt?: string;
      isCompleted?: boolean;
      responses?: Array<{
        questionId?: string;
        answer?: unknown;
        formattedAnswer?: string;
      }>;
    }>;
    totalNumberOfSubmissionsPerFilter?: { completed?: number; all?: number };
  };

  const questionMeta = new Map<string, { title: string; type: string }>();
  for (const q of data.questions ?? []) {
    if (!q.id) continue;
    questionMeta.set(q.id, {
      title: q.title || q.id,
      type: String(q.type || ""),
    });
  }

  const responses: TallyResponseSummary[] = [];
  const suggestedLeads: Array<{ name: string | null; phone: string; email: string | null }> = [];
  const seenPhones = new Set<string>();

  for (const sub of data.submissions ?? []) {
    if (!sub.id) continue;
    const answers: TallyAnswerFlat[] = [];
    let phone: string | null = null;
    let email: string | null = null;
    let name: string | null = null;

    for (const raw of sub.responses ?? []) {
      const qid = String(raw.questionId ?? "");
      const meta = questionMeta.get(qid);
      const fieldTitle = meta?.title || qid || "champ";
      const type = meta?.type || "";
      const value =
        (typeof raw.formattedAnswer === "string" && raw.formattedAnswer.trim()) ||
        answerValueToString(raw.answer);
      if (!value) continue;
      answers.push({ questionId: qid, questionTitle: fieldTitle, type, value });

      if (type === "INPUT_PHONE_NUMBER" || PHONE_TITLE_RE.test(fieldTitle)) {
        if (looksLikePhone(value)) phone = phone || value;
      } else if (type === "INPUT_EMAIL" || EMAIL_TITLE_RE.test(fieldTitle)) {
        email = email || value;
      } else if (NAME_TITLE_RE.test(fieldTitle) || type === "INPUT_TEXT" || type === "TEXTAREA") {
        if (!name && value.length < 80 && !looksLikePhone(value) && !value.includes("@")) {
          if (NAME_TITLE_RE.test(fieldTitle)) name = value;
        }
      }
      if (!phone && looksLikePhone(value)) phone = value;
      if (!email && /@/.test(value) && value.includes(".")) email = value;
    }

    if (!name) {
      const textAns = answers.find(
        (a) =>
          (a.type === "INPUT_TEXT" || a.type === "TEXTAREA" || !a.type) &&
          a.value.length > 1 &&
          a.value.length < 60 &&
          !looksLikePhone(a.value) &&
          !a.value.includes("@"),
      );
      if (textAns) name = textAns.value;
    }

    responses.push({
      submissionId: sub.id,
      submittedAt: sub.submittedAt ?? null,
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
    totalItems:
      data.totalNumberOfSubmissionsPerFilter?.completed ??
      data.totalNumberOfSubmissionsPerFilter?.all ??
      responses.length,
    responses,
    suggestedLeads,
  };
}
