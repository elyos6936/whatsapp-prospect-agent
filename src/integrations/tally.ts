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
  /** URL publique répondant (`https://tally.so/r/{id}`). */
  publicUrl: string;
};

/** Extrait l’id court Tally depuis une URL ou un id brut. */
export function normalizeTallyFormId(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const fromUrl = s.match(/tally\.so\/(?:r|forms)\/([A-Za-z0-9_-]+)/i);
  if (fromUrl?.[1]) return fromUrl[1];
  // Si l’agent colle toute l’URL mal parsée
  if (/^https?:\/\//i.test(s)) {
    try {
      const path = new URL(s).pathname;
      const seg = path.split("/").filter(Boolean).pop();
      if (seg && /^[A-Za-z0-9_-]+$/.test(seg)) return seg;
    } catch {
      /* ignore */
    }
  }
  return s.split(/[?#]/)[0].trim();
}

function normalizeFormName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Résout un form_id (id court, URL, ou nom) vers l’id API Tally.
 */
export async function resolveTallyFormId(
  apiKey: string,
  formIdOrName: string,
): Promise<{ id: string; name: string; matchedBy: "id" | "url" | "name" } | null> {
  const raw = String(formIdOrName ?? "").trim();
  if (!raw) return null;

  const normalizedId = normalizeTallyFormId(raw);
  const forms = await fetchTallyForms(apiKey);

  const byId = forms.find(
    (f) => f.id.toLowerCase() === normalizedId.toLowerCase(),
  );
  if (byId) {
    return {
      id: byId.id,
      name: byId.name,
      matchedBy: /tally\.so\//i.test(raw) ? "url" : "id",
    };
  }

  // Nom (ou fragment) — l’agent envoie parfois le titre au lieu de l’id
  const needle = normalizeFormName(raw);
  if (needle.length >= 3 && !/^[A-Za-z0-9_-]{4,12}$/.test(normalizedId)) {
    const exact = forms.find((f) => normalizeFormName(f.name) === needle);
    if (exact) return { id: exact.id, name: exact.name, matchedBy: "name" };
    const partial = forms.find(
      (f) =>
        normalizeFormName(f.name).includes(needle) ||
        needle.includes(normalizeFormName(f.name)),
    );
    if (partial) return { id: partial.id, name: partial.name, matchedBy: "name" };
  }

  // Id inconnu du listing mais peut-être valide directement
  if (/^[A-Za-z0-9_-]{4,32}$/.test(normalizedId)) {
    return { id: normalizedId, name: normalizedId, matchedBy: "id" };
  }

  return null;
}

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
        publicUrl: `https://tally.so/r/${item.id}`,
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

async function fetchTallySubmissionsPage(
  apiKey: string,
  formId: string,
  pageSize: number,
  filter: "completed" | "all" | "partial",
): Promise<{
  status: number;
  data: {
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
    totalNumberOfSubmissionsPerFilter?: {
      completed?: number;
      all?: number;
      partial?: number;
    };
  } | null;
}> {
  const url = new URL(`${API_BASE}/forms/${encodeURIComponent(formId)}/submissions`);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("filter", filter);

  const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
  if (res.status === 401 || res.status === 403) {
    throw new TallyAuthError("Clé API Tally invalide ou révoquée.", "revoked");
  }
  if (!res.ok) {
    return { status: res.status, data: null };
  }
  return {
    status: res.status,
    data: (await res.json()) as {
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
      totalNumberOfSubmissionsPerFilter?: {
        completed?: number;
        all?: number;
        partial?: number;
      };
    },
  };
}

export async function fetchTallyResponses(
  apiKey: string,
  formIdOrUrlOrName: string,
  pageSize = 25,
): Promise<TallyResponsesResult & { resolvedFormName?: string; filterUsed?: string }> {
  const capped = Math.min(Math.max(1, pageSize), 100);
  const resolved = await resolveTallyFormId(apiKey, formIdOrUrlOrName);
  if (!resolved) {
    throw new TallyAuthError(
      `Formulaire Tally introuvable pour « ${String(formIdOrUrlOrName).slice(0, 80)} ». Relance list_tally_forms et utilise le champ id exact.`,
      "invalid",
    );
  }
  const formId = resolved.id;

  let page = await fetchTallySubmissionsPage(apiKey, formId, capped, "completed");
  let filterUsed: "completed" | "all" = "completed";

  if (page.status === 404) {
    throw new TallyAuthError(
      `Formulaire Tally ${formId} introuvable (404). Vérifie l’id via list_tally_forms (publicUrl https://tally.so/r/{id}).`,
      "http",
    );
  }
  if (page.status !== 200 || !page.data) {
    throw new TallyAuthError(`Tally submissions HTTP ${page.status}`, "http");
  }

  const completedCount =
    page.data.totalNumberOfSubmissionsPerFilter?.completed ??
    page.data.submissions?.length ??
    0;
  // Compteur UI souvent = all ; si 0 completed, retenter sans filtre strict
  if (completedCount === 0) {
    const allPage = await fetchTallySubmissionsPage(apiKey, formId, capped, "all");
    if (allPage.status === 200 && allPage.data) {
      const allCount =
        allPage.data.totalNumberOfSubmissionsPerFilter?.all ??
        allPage.data.submissions?.length ??
        0;
      if (allCount > 0) {
        page = allPage;
        filterUsed = "all";
      }
    }
  }

  const data = page.data;
  if (!data) {
    throw new TallyAuthError(`Tally submissions HTTP ${page.status}`, "http");
  }

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
    resolvedFormName: resolved.name,
    filterUsed,
    totalItems:
      (filterUsed === "all"
        ? data.totalNumberOfSubmissionsPerFilter?.all
        : data.totalNumberOfSubmissionsPerFilter?.completed) ??
      data.totalNumberOfSubmissionsPerFilter?.all ??
      responses.length,
    responses,
    suggestedLeads,
  };
}
