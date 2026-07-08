import { assertCanSendTo, getAppSettings, isContactBlocked, saveContact, saveWhatsAppMessage } from "./db.js";
import { config } from "./config.js";

export interface GreenApiCredentials {
  idInstance: string;
  apiToken: string;
  baseUrl: string;
}

export class GreenApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "GreenApiError";
  }
}

export function getGreenApiCredentials(): GreenApiCredentials | null {
  const s = getAppSettings();
  if (!s.green_api_id_instance || !s.green_api_token) return null;
  return {
    idInstance: s.green_api_id_instance,
    apiToken: s.green_api_token,
    baseUrl: s.green_api_base_url || config.defaultGreenApiBaseUrl,
  };
}

function buildUrl(creds: GreenApiCredentials, method: string): string {
  return `${creds.baseUrl}/waInstance${creds.idInstance}/${method}/${creds.apiToken}`;
}

async function greenFetch<T>(
  creds: GreenApiCredentials,
  method: string,
  options: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  let url = buildUrl(creds, method);
  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params.toString()}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new GreenApiError(`Réponse Green-API invalide (${method})`, res.status);
    }

    if (!res.ok) {
      const msg =
        typeof data === "object" && data && "message" in data
          ? String((data as { message: unknown }).message)
          : text || res.statusText;
      throw new GreenApiError(`Green-API ${method} : ${msg}`, res.status);
    }

    if (typeof data === "object" && data && "Error" in data) {
      throw new GreenApiError(`Green-API : ${String((data as { Error: unknown }).Error)}`);
    }

    return data as T;
  } catch (err) {
    if (err instanceof GreenApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GreenApiError("Green-API : délai d'attente dépassé (30 s)");
    }
    throw new GreenApiError(
      `Green-API indisponible : ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizePhoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new GreenApiError("Numéro de téléphone invalide.");
  return `${digits}@c.us`;
}

export function chatIdToDisplay(chatId: string): string {
  if (chatId.endsWith("@c.us")) {
    return "+" + chatId.replace("@c.us", "");
  }
  return chatId;
}

export async function testGreenApiConnection(): Promise<{
  connected: boolean;
  state: string;
  message: string;
}> {
  const creds = getGreenApiCredentials();
  if (!creds) {
    return { connected: false, state: "not_configured", message: "Identifiants Green-API manquants." };
  }

  const data = await greenFetch<{ stateInstance?: string }>(creds, "getStateInstance");
  const state = data.stateInstance ?? "unknown";

  const ok = state === "authorized";
  return {
    connected: ok,
    state,
    message: ok
      ? "WhatsApp connecté et autorisé."
      : state === "notAuthorized"
        ? "Instance Green-API trouvée mais WhatsApp non autorisé — scannez le QR code dans la console Green-API."
        : `État WhatsApp : ${state}`,
  };
}

export interface WaContact {
  id: string;
  name?: string;
  contactName?: string;
  type?: string;
}

export async function listWhatsAppGroups(): Promise<
  Array<{ id: string; name: string; type: string }>
> {
  const creds = getGreenApiCredentials();
  if (!creds) throw new GreenApiError("Green-API non configuré. Connectez WhatsApp dans les paramètres.");

  const contacts = await greenFetch<WaContact[]>(creds, "getContacts", {
    query: { group: "true" },
  });

  return (contacts ?? [])
    .filter((c) => c.type === "group" || c.id?.endsWith("@g.us"))
    .map((c) => ({
      id: c.id,
      name: c.name || c.contactName || c.id,
      type: c.type ?? "group",
    }));
}

export async function getGroupMembers(groupId: string): Promise<{
  groupId: string;
  subject: string;
  size: number;
  participants: Array<{ id: string; name?: string; isAdmin?: boolean }>;
}> {
  const creds = getGreenApiCredentials();
  if (!creds) throw new GreenApiError("Green-API non configuré.");

  const data = await greenFetch<{
    groupId: string;
    subject: string;
    size: number;
    participants: Array<{ id: string; name?: string; isAdmin?: boolean }>;
  }>(creds, "getGroupData", {
    method: "POST",
    body: { groupId },
  });

  return {
    groupId: data.groupId,
    subject: data.subject,
    size: data.size,
    participants: data.participants ?? [],
  };
}

/** Espacement entre deux envois manuels / auto : 45–120 s. */
let lastOutboundAt = 0;
let nextOutboundGapMs = 0;

async function waitOutboundSpacing(): Promise<void> {
  if (!lastOutboundAt || !nextOutboundGapMs) return;
  const wait = lastOutboundAt + nextOutboundGapMs - Date.now();
  if (wait <= 0) return;
  console.log(`⏳ Espacement anti-spam : attente ${Math.ceil(wait / 1000)}s…`);
  await new Promise((r) => setTimeout(r, wait));
}

function markOutboundSent(): void {
  lastOutboundAt = Date.now();
  nextOutboundGapMs = 45_000 + Math.floor(Math.random() * 75_000); // 45–120 s
}

export async function sendWhatsAppMessage(chatId: string, message: string): Promise<{
  idMessage: string;
  chatId: string;
}> {
  const creds = getGreenApiCredentials();
  if (!creds) throw new GreenApiError("Green-API non configuré.");

  assertCanSendTo(chatId);
  await waitOutboundSpacing();

  const data = await greenFetch<{ idMessage: string }>(creds, "sendMessage", {
    method: "POST",
    body: { chatId, message },
  });

  markOutboundSent();

  saveWhatsAppMessage({
    contactPhone: chatId,
    direction: "sortant",
    body: message,
    greenApiId: data.idMessage,
  });

  // Ne pas enregistrer les groupes comme contacts de prospection
  if (chatId.endsWith("@c.us")) {
    try {
      saveContact({ phone: chatId, status: "en_conversation" });
    } catch {
      /* best effort */
    }
  }

  return { idMessage: data.idMessage, chatId };
}

/** Trouve un groupe par nom (insensible à la casse / accents) ou par ID @g.us. */
export async function findGroupByNameOrId(
  nameOrId: string
): Promise<{ id: string; name: string } | null> {
  const raw = nameOrId.trim();
  if (raw.endsWith("@g.us")) {
    return { id: raw, name: raw };
  }

  const groups = await listWhatsAppGroups();
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .trim();

  const target = normalize(raw);
  const exact = groups.find((g) => normalize(g.name) === target);
  if (exact) return { id: exact.id, name: exact.name };

  const partial = groups.find(
    (g) => normalize(g.name).includes(target) || target.includes(normalize(g.name))
  );
  return partial ? { id: partial.id, name: partial.name } : null;
}

export async function messageGroupMembers(
  groupId: string,
  message: string,
  options: { maxMembers?: number; delayMs?: number } = {}
): Promise<{
  groupName: string;
  sent: Array<{ chatId: string; idMessage: string }>;
  skipped: number;
  errors: Array<{ chatId: string; error: string }>;
}> {
  const group = await getGroupMembers(groupId);
  const maxMembers = options.maxMembers ?? 30;
  const delayMs = options.delayMs ?? 4000;

  const sent: Array<{ chatId: string; idMessage: string }> = [];
  const errors: Array<{ chatId: string; error: string }> = [];

  const eligible = group.participants.filter((p) => !isContactBlocked(p.id));
  const blockedSkipped = group.participants.length - eligible.length;
  const participants = eligible.slice(0, maxMembers);
  const skipped = Math.max(0, eligible.length - participants.length) + blockedSkipped;

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    try {
      const result = await sendWhatsAppMessage(p.id, message);
      sent.push({ chatId: p.id, idMessage: result.idMessage });
    } catch (err) {
      errors.push({
        chatId: p.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (i < participants.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { groupName: group.subject, sent, skipped, errors };
}

export interface ChatHistoryEntry {
  idMessage: string;
  type: "incoming" | "outgoing";
  text: string;
  timestamp: number;
  senderName?: string;
  typeMessage: string;
}

export async function getChatHistory(
  recipient: string,
  count = 30
): Promise<{
  chatId: string;
  display: string;
  messages: ChatHistoryEntry[];
}> {
  const creds = getGreenApiCredentials();
  if (!creds) throw new GreenApiError("Green-API non configuré.");

  const chatId = recipient.includes("@") ? recipient.trim() : normalizePhoneToChatId(recipient);
  const safeCount = Math.min(Math.max(count, 1), 100);

  const raw = await greenFetch<
    Array<{
      idMessage?: string;
      type?: string;
      timestamp?: number;
      typeMessage?: string;
      textMessage?: string;
      extendedTextMessage?: { text?: string };
      senderName?: string;
      senderContactName?: string;
    }>
  >(creds, "getChatHistory", {
    method: "POST",
    body: { chatId, count: safeCount },
  });

  const messages: ChatHistoryEntry[] = [];

  for (const m of raw ?? []) {
    const text =
      m.textMessage?.trim() ||
      m.extendedTextMessage?.text?.trim() ||
      (m.typeMessage && m.typeMessage !== "textMessage" && m.typeMessage !== "extendedTextMessage"
        ? `[${m.typeMessage}]`
        : "");

    if (!text) continue;

    messages.push({
      idMessage: m.idMessage ?? "",
      type: m.type === "incoming" ? "incoming" : "outgoing",
      text,
      timestamp: m.timestamp ?? 0,
      senderName: m.senderName || m.senderContactName,
      typeMessage: m.typeMessage ?? "unknown",
    });
  }

  return {
    chatId,
    display: chatIdToDisplay(chatId),
    messages,
  };
}

export async function listPersonalContacts(limit = 50): Promise<
  Array<{ id: string; name: string }>
> {
  const creds = getGreenApiCredentials();
  if (!creds) throw new GreenApiError("Green-API non configuré.");

  const contacts = await greenFetch<WaContact[]>(creds, "getContacts", {
    query: { group: "false", count: String(limit) },
  });

  return (contacts ?? [])
    .filter((c) => c.type === "user" || c.id?.endsWith("@c.us"))
    .map((c) => ({
      id: c.id,
      name: c.name || c.contactName || chatIdToDisplay(c.id),
    }));
}
