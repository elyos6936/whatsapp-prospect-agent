import {
  assertCanSendTo,
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
  getAppSettings,
  getContact,
  isContactBlocked,
  saveContact,
  saveWhatsAppMessage,
} from "./db.js";
import { config } from "./config.js";

export interface EvolutionCredentials {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

/** @deprecated Alias rétrocompat — préférer EvolutionCredentials */
export type GreenApiCredentials = EvolutionCredentials;

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

/** @deprecated Alias rétrocompat */
export const GreenApiError = EvolutionApiError;

export function getEvolutionCredentials(): EvolutionCredentials | null {
  const s = getAppSettings();
  if (!s.evolution_api_key?.trim() || !s.evolution_instance_name?.trim()) return null;
  return {
    baseUrl: (s.evolution_api_base_url || config.defaultEvolutionBaseUrl).replace(/\/$/, ""),
    apiKey: s.evolution_api_key.trim(),
    instanceName: s.evolution_instance_name.trim(),
  };
}

export function getGreenApiCredentials(): EvolutionCredentials | null {
  return getEvolutionCredentials();
}

function instancePath(creds: EvolutionCredentials, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${creds.baseUrl}${clean.replace("{instance}", encodeURIComponent(creds.instanceName))}`;
}

async function evolutionFetch<T>(
  creds: EvolutionCredentials,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    query?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  let url = instancePath(creds, path);
  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params.toString()}`;
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        apikey: creds.apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new EvolutionApiError(`Réponse Evolution API invalide (${path})`, res.status);
    }

    if (!res.ok) {
      const msg = extractErrorMessage(data) || text || res.statusText;
      throw new EvolutionApiError(`Evolution API ${path} : ${msg}`, res.status);
    }

    if (typeof data === "object" && data && "success" in data && (data as { success: boolean }).success === false) {
      throw new EvolutionApiError(`Evolution API : ${extractErrorMessage(data)}`);
    }

    return data as T;
  } catch (err) {
    if (err instanceof EvolutionApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new EvolutionApiError(`Evolution API : délai d'attente dépassé (${Math.round(timeoutMs / 1000)} s)`);
    }
    throw new EvolutionApiError(
      `Evolution API indisponible : ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function extractErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  if (o.error && typeof o.error === "object" && o.error && "message" in o.error) {
    return String((o.error as { message: unknown }).message);
  }
  if (typeof o.message === "string") return o.message;
  if (Array.isArray(o.response) && o.response[0] && typeof o.response[0] === "object") {
    const r0 = o.response[0] as Record<string, unknown>;
    if (typeof r0.message === "string") return r0.message;
  }
  return "";
}

export function chatIdToNumber(chatId: string): string {
  return chatId.replace(/@c\.us|@s\.whatsapp\.net|@lid/gi, "").replace(/\D/g, "");
}

export function normalizePhoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new EvolutionApiError("Numéro de téléphone invalide.");
  return `${digits}@c.us`;
}

export function normalizeGroupParticipantId(participantId: string): string {
  const id = participantId.trim();
  if (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")) {
    return `${chatIdToNumber(id)}@c.us`;
  }
  if (id.endsWith("@lid")) {
    const digits = chatIdToNumber(id);
    if (digits.length >= 8) return `${digits}@c.us`;
  }
  const digits = chatIdToNumber(id);
  if (digits.length >= 8) return `${digits}@c.us`;
  return id;
}

export function chatIdsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const da = chatIdToNumber(a);
  const db = chatIdToNumber(b);
  return da.length >= 8 && da === db;
}

export function resolveProspectChatId(rawChatId: string, sender?: string): string {
  const raw = rawChatId.trim();
  const senderId = sender?.trim() || "";
  if (raw.endsWith("@c.us") || raw.endsWith("@s.whatsapp.net")) {
    return normalizeGroupParticipantId(raw);
  }
  if (senderId.endsWith("@c.us") || senderId.endsWith("@s.whatsapp.net")) {
    return normalizeGroupParticipantId(senderId);
  }
  const digits = chatIdToNumber(senderId || raw);
  if (digits.length >= 8) return `${digits}@c.us`;
  if (raw.endsWith("@g.us")) return raw;
  return raw || senderId || "inconnu";
}

export function chatIdToDisplay(chatId: string): string {
  if (chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net")) {
    return "+" + chatIdToNumber(chatId);
  }
  return chatId;
}

function toRemoteJid(chatId: string): string {
  if (chatId.endsWith("@g.us")) return chatId;
  const digits = chatIdToNumber(chatId);
  if (!digits) throw new EvolutionApiError("Destinataire invalide.");
  return `${digits}@s.whatsapp.net`;
}

function formatEvolutionSendNumber(chatId: string): string {
  if (chatId.endsWith("@g.us")) return chatId;
  return toRemoteJid(chatId);
}

async function sendTextViaEvolution(
  creds: EvolutionCredentials,
  chatId: string,
  message: string
): Promise<unknown> {
  const number = formatEvolutionSendNumber(chatId);
  const digits = chatIdToNumber(chatId);
  const attempts: Array<Record<string, unknown>> = [
    { number, textMessage: { text: message } },
    { number: digits, textMessage: { text: message } },
    { number, text: message },
    { number: digits, text: message },
  ];

  let lastErr: Error | null = null;
  for (const body of attempts) {
    try {
      const data = await evolutionFetch<unknown>(creds, `/message/sendText/${creds.instanceName}`, {
        method: "POST",
        body,
      });
      if (data && typeof data === "object") {
        const o = data as Record<string, unknown>;
        if (o.key || o.message || o.status === "PENDING" || o.status === "SERVER_ACK") {
          return data;
        }
        if (typeof o.message === "string" && /error|fail/i.test(o.message)) {
          throw new EvolutionApiError(String(o.message));
        }
      }
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!(err instanceof EvolutionApiError) || (err.status !== 400 && err.status !== 422)) {
        throw err;
      }
    }
  }
  throw lastErr ?? new EvolutionApiError("Impossible d'envoyer le message.");
}

export async function diagnoseEvolutionApi(): Promise<{
  configured: boolean;
  connection: Awaited<ReturnType<typeof testGreenApiConnection>>;
  outboundToday: number;
  outboundLimit: number;
  sendFormatHint: string;
  statusEndpoint: string;
}> {
  const creds = getEvolutionCredentials();
  const connection = await testGreenApiConnection();
  return {
    configured: Boolean(creds),
    connection,
    outboundToday: countOutboundToday(),
    outboundLimit: DAILY_OUTBOUND_LIMIT,
    sendFormatHint: "DM → {number: '229…@s.whatsapp.net', textMessage:{text}} | Groupe → @g.us",
    statusEndpoint: "/message/sendStatus (statut WhatsApp, pas la bio profil)",
  };
}

export async function testGreenApiConnection(): Promise<{
  connected: boolean;
  state: string;
  message: string;
}> {
  const creds = getEvolutionCredentials();
  if (!creds) {
    return { connected: false, state: "not_configured", message: "Evolution API non configurée." };
  }

  try {
    const data = await evolutionFetch<{ instance?: { state?: string; instanceName?: string } }>(
      creds,
      `/instance/connectionState/${creds.instanceName}`
    );
    const state = data.instance?.state ?? "unknown";
    const ok = state === "open";
    return {
      connected: ok,
      state,
      message: ok
        ? "WhatsApp connecté (Evolution API)."
        : state === "connecting"
          ? "Connexion en cours — scannez le QR code Evolution API."
          : state === "close"
            ? "WhatsApp déconnecté — reconnectez l'instance Evolution API."
            : `État WhatsApp : ${state}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { connected: false, state: "error", message: msg };
  }
}

export async function requireGreenApiAuthorized(context = "cette opération"): Promise<void> {
  const state = await testGreenApiConnection();
  if (!state.connected) {
    const hint =
      state.state === "connecting"
        ? "L'instance se connecte encore — attendez ou scannez le QR code."
        : state.message;
    throw new EvolutionApiError(
      `WhatsApp non connecté (état : ${state.state}) — impossible d'exécuter ${context}. ${hint}`
    );
  }
}

export interface WaContact {
  id: string;
  name?: string;
  contactName?: string;
  type?: string;
}

export async function listWhatsAppGroups(): Promise<Array<{ id: string; name: string; type: string }>> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const data = await evolutionFetch<Array<{ id?: string; remoteJid?: string; name?: string; subject?: string }>>(
    creds,
    `/group/fetchAllGroups/${creds.instanceName}`,
    { query: { getParticipants: "false" } }
  );

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((g) => ({
      id: g.id || g.remoteJid || "",
      name: g.subject || g.name || g.id || "",
      type: "group",
    }))
    .filter((g) => g.id.endsWith("@g.us"));
}

export async function getGroupMembers(groupId: string): Promise<{
  groupId: string;
  subject: string;
  size: number;
  participants: Array<{ id: string; name?: string; isAdmin?: boolean }>;
}> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const groupJid = groupId.trim();
  const [info, participantsData] = await Promise.all([
    evolutionFetch<{ group?: { id?: string; subject?: string; size?: number } }>(
      creds,
      `/group/findGroupInfos/${creds.instanceName}`,
      { query: { groupJid } }
    ).catch(() => ({ group: { id: groupJid, subject: groupJid } })),
    evolutionFetch<{ participants?: Array<{ id?: string; isAdmin?: boolean; isSuperAdmin?: boolean }> }>(
      creds,
      `/group/participants/${creds.instanceName}`,
      { query: { groupJid } }
    ),
  ]);

  const groupInfo = info.group ?? { id: groupJid, subject: groupJid };
  const participants = (participantsData.participants ?? []).map((p) => {
    const raw = (p as { phoneNumber?: string; id?: string }).phoneNumber || p.id || "";
    return {
      id: normalizeGroupParticipantId(raw),
      name: undefined,
      isAdmin: Boolean(p.isAdmin || (p as { admin?: string | null }).admin),
    };
  });

  return {
    groupId: groupInfo.id || groupJid,
    subject: groupInfo.subject || groupJid,
    size: "size" in groupInfo && groupInfo.size != null ? groupInfo.size : participants.length,
    participants,
  };
}

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
  nextOutboundGapMs = 45_000 + Math.floor(Math.random() * 75_000);
}

function extractMessageId(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  if (o.key && typeof o.key === "object" && (o.key as { id?: string }).id) {
    return String((o.key as { id: string }).id);
  }
  if (o.message && typeof o.message === "object" && (o.message as { key?: { id?: string } }).key?.id) {
    return String((o.message as { key: { id: string } }).key.id);
  }
  return `evo-${Date.now()}`;
}

export async function sendWhatsAppMessage(
  chatId: string,
  message: string,
  opts: { enableAutoReply?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  assertCanSendTo(chatId);
  await waitOutboundSpacing();

  const data = await sendTextViaEvolution(creds, chatId, message);

  markOutboundSent();
  const idMessage = extractMessageId(data);

  saveWhatsAppMessage({
    contactPhone: chatId.endsWith("@g.us") ? chatId : normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: message,
    greenApiId: idMessage,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      saveContact({ phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  } else if (normalized.endsWith("@c.us")) {
    try {
      if (!getContact(normalized)) {
        saveContact({ phone: normalized, status: "en_conversation", autoReply: false });
      }
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized.endsWith("@g.us") ? chatId : normalized };
}

export async function sendWhatsAppMedia(
  chatId: string,
  input: {
    url: string;
    type: "image" | "document" | "audio";
    caption?: string;
    fileName?: string;
  },
  opts: { enableAutoReply?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  assertCanSendTo(chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const data = await evolutionFetch<unknown>(creds, `/message/sendMedia/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      mediatype: input.type,
      media: input.url,
      caption: input.caption,
      fileName: input.fileName,
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  const label = input.caption || `[${input.type}] ${input.url}`;

  saveWhatsAppMessage({
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: label,
    greenApiId: idMessage,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      saveContact({ phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized };
}

export async function findGroupByNameOrId(
  nameOrId: string
): Promise<{ id: string; name: string } | null> {
  const raw = nameOrId.trim();
  if (raw.endsWith("@g.us")) return { id: raw, name: raw };

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

function extractEvolutionText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.conversation === "string") return m.conversation.trim();
  if (m.extendedTextMessage && typeof m.extendedTextMessage === "object") {
    const t = (m.extendedTextMessage as { text?: string }).text;
    if (t) return t.trim();
  }
  if (m.imageMessage && typeof m.imageMessage === "object") return "[Image]";
  if (m.audioMessage) return "[Audio]";
  if (m.videoMessage) return "[Vidéo]";
  if (m.documentMessage) return "[Document]";
  return "";
}

export async function getChatHistory(
  recipient: string,
  count = 30
): Promise<{ chatId: string; display: string; messages: ChatHistoryEntry[] }> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const chatId = recipient.includes("@") ? recipient.trim() : normalizePhoneToChatId(recipient);
  const remoteJid = toRemoteJid(chatId.endsWith("@g.us") ? chatId : chatId);
  const safeCount = Math.min(Math.max(count, 1), 100);

  const data = await evolutionFetch<{ messages?: { records?: unknown[] } }>(
    creds,
    `/chat/findMessages/${creds.instanceName}`,
    {
      method: "POST",
      body: {
        where: { key: { remoteJid } },
        take: safeCount,
        orderBy: { messageTimestamp: "desc" },
      },
    }
  );

  const records = data.messages?.records ?? [];
  const messages: ChatHistoryEntry[] = [];

  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const key = r.key as { id?: string; fromMe?: boolean; remoteJid?: string } | undefined;
    const text = extractEvolutionText(r.message);
    if (!text) continue;
    messages.push({
      idMessage: key?.id ?? "",
      type: key?.fromMe ? "outgoing" : "incoming",
      text,
      timestamp: Number(r.messageTimestamp ?? 0),
      typeMessage: String(r.messageType ?? "text"),
    });
  }

  return { chatId, display: chatIdToDisplay(chatId), messages: messages.reverse() };
}

export interface LastIncomingMessage {
  type?: string;
  idMessage: string;
  timestamp?: number;
  typeMessage: string;
  chatId: string;
  textMessage?: string;
  extendedTextMessageData?: { text?: string };
  senderId?: string;
  senderName?: string;
  senderContactName?: string;
}

export async function getLastIncomingMessages(): Promise<LastIncomingMessage[]> {
  const creds = getEvolutionCredentials();
  if (!creds) return [];

  try {
    const data = await evolutionFetch<{ messages?: { records?: unknown[] } }>(
      creds,
      `/chat/findMessages/${creds.instanceName}`,
      {
        method: "POST",
        body: {
          where: { fromMe: false },
          take: 40,
          orderBy: { messageTimestamp: "desc" },
        },
      }
    );

    const records = data.messages?.records ?? [];
    const out: LastIncomingMessage[] = [];

    for (const row of records) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const key = r.key as { id?: string; remoteJid?: string; participant?: string } | undefined;
      const remoteJid = key?.remoteJid ?? "";
      if (!remoteJid || remoteJid.endsWith("@g.us")) continue;

      const text = extractEvolutionText(r.message);
      if (!text) continue;

      out.push({
        idMessage: key?.id ?? `evo-${Date.now()}`,
        chatId: remoteJid,
        senderId: key?.participant || remoteJid,
        typeMessage: String(r.messageType ?? "textMessage"),
        textMessage: text,
        timestamp: Number(r.messageTimestamp ?? 0),
        senderName: String(r.pushName ?? ""),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function sendWhatsAppTextStatus(
  message: string,
  options: { backgroundColor?: string; font?: string; participants?: string[] } = {}
): Promise<{ idMessage: string; audienceCount: number }> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const text = message.trim();
  if (!text) throw new EvolutionApiError("Le texte du statut est requis.");
  if (text.length > 500) throw new EvolutionApiError("Statut trop long (max 500 caractères).");

  const statusJidList = await buildStatusJidList(options.participants);
  if (statusJidList.length === 0) {
    throw new EvolutionApiError(
      "Aucun contact disponible pour publier le statut. Evolution API exige statusJidList (allContacts provoque un timeout sur v2.3.7)."
    );
  }

  const fontMap: Record<string, number> = {
    SERIF: 1,
    SAN_SERIF: 2,
    NORICAN: 3,
    BRYNDAN: 4,
    BEBAS: 5,
  };
  const fontKey = (options.font || "SERIF").toUpperCase().replace(/-/g, "_");
  const fontNum = fontMap[fontKey] ?? 1;
  const bg = options.backgroundColor || "#228B22";
  const argb = hexToArgb(bg);

  // Ne jamais utiliser allContacts:true — bug connu Evolution v2.3.7 (timeout sans réponse).
  const attempts: Array<Record<string, unknown>> = [
    {
      type: "text",
      content: text,
      backgroundColor: bg,
      font: fontNum,
      allContacts: false,
      statusJidList,
    },
    {
      type: "text",
      content: text,
      backgroundArgb: argb,
      font: "SERIF",
      allContacts: false,
      statusJidList,
    },
    {
      type: "text",
      content: text,
      backgroundColor: bg,
      font: fontNum,
      statusJidList: statusJidList.map((j) => chatIdToNumber(j)),
    },
  ];

  let lastErr: Error | null = null;
  for (const body of attempts) {
    try {
      const data = await evolutionFetch<unknown>(creds, `/message/sendStatus/${creds.instanceName}`, {
        method: "POST",
        body,
        timeoutMs: 60_000,
      });
      return {
        idMessage: extractMessageId(data) || `status-${Date.now()}`,
        audienceCount: statusJidList.length,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const retryable =
        err instanceof EvolutionApiError &&
        (err.status === 400 || err.status === 422 || /délai|timeout|Abort/i.test(lastErr.message));
      if (!retryable) throw err;
    }
  }

  throw new EvolutionApiError(
    `Timeout Evolution API v2.3.7 lors de la publication du statut (${statusJidList.length} contacts ciblés). ` +
      `Les messages fonctionnent, mais sendStatus est instable sur cette version — mettez à jour Evolution sur Hostinger ou publiez depuis WhatsApp. ` +
      `Détail : ${lastErr?.message ?? "timeout"}`
  );
}

export async function listWhatsAppChats(count = 100): Promise<
  Array<{ id: string; name: string; type: string; archive?: boolean }>
> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const safe = Math.min(Math.max(count, 1), 500);
  const data = await evolutionFetch<Array<{ id?: string; remoteJid?: string; name?: string; archived?: boolean }>>(
    creds,
    `/chat/findChats/${creds.instanceName}`,
    { method: "POST", body: { take: safe } }
  );

  return (Array.isArray(data) ? data : []).map((c) => {
    const id = c.remoteJid || c.id || "";
    return {
      id,
      name: c.name || id,
      type: id.endsWith("@g.us") ? "group" : "user",
      archive: c.archived,
    };
  });
}

export async function markChatRead(chatId: string, idMessage?: string): Promise<{ setRead: boolean }> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const remoteJid = toRemoteJid(chatId);
  await evolutionFetch(creds, `/chat/markMessageAsRead/${creds.instanceName}`, {
    method: "POST",
    body: {
      readMessages: [
        {
          remoteJid,
          fromMe: false,
          id: idMessage || "latest",
        },
      ],
    },
  });
  return { setRead: true };
}

export async function listPersonalContacts(limit = 50): Promise<Array<{ id: string; name: string }>> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const data = await evolutionFetch<Array<{ id?: string; remoteJid?: string; pushName?: string; name?: string }>>(
    creds,
    `/chat/findContacts/${creds.instanceName}`,
    { method: "POST", body: { take: limit } }
  );

  return (Array.isArray(data) ? data : [])
    .filter((c) => {
      const id = c.remoteJid || c.id || "";
      return id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net");
    })
    .map((c) => {
      const id = normalizeGroupParticipantId(c.remoteJid || c.id || "");
      return { id, name: c.pushName || c.name || chatIdToDisplay(id) };
    });
}

function toStatusJid(chatId: string): string {
  const trimmed = chatId.trim();
  if (trimmed.endsWith("@s.whatsapp.net")) return trimmed;
  if (trimmed.endsWith("@c.us") || trimmed.endsWith("@lid")) {
    return `${chatIdToNumber(trimmed)}@s.whatsapp.net`;
  }
  const digits = chatIdToNumber(trimmed);
  if (digits.length >= 8) return `${digits}@s.whatsapp.net`;
  return trimmed;
}

function hexToArgb(hex: string): number {
  const clean = hex.replace(/^#/, "").trim();
  if (clean.length !== 6) return 0xff228b22;
  const rgb = Number.parseInt(clean, 16);
  if (!Number.isFinite(rgb)) return 0xff228b22;
  return (0xff << 24) | rgb;
}

async function getInstanceOwnerJid(creds: EvolutionCredentials): Promise<string | null> {
  try {
    const data = await evolutionFetch<unknown>(creds, `/instance/fetchInstances`, {
      query: { instanceName: creds.instanceName },
    });
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const inst = o.instance && typeof o.instance === "object" ? (o.instance as Record<string, unknown>) : null;
      const owner = o.owner ?? o.ownerJid ?? inst?.owner ?? inst?.ownerJid;
      if (typeof owner === "string" && owner.trim()) {
        return toStatusJid(owner);
      }
    }
  } catch {
    /* best effort */
  }
  return null;
}

/** Liste de JIDs pour statusJidList — allContacts:true provoque un timeout sur Evolution v2.3.7. */
async function buildStatusJidList(participants?: string[]): Promise<string[]> {
  if (participants?.length) {
    return [...new Set(participants.map(toStatusJid))];
  }

  const jids = new Set<string>();
  const creds = getEvolutionCredentials();
  if (creds) {
    const owner = await getInstanceOwnerJid(creds);
    if (owner) jids.add(owner);
  }

  try {
    for (const c of await listPersonalContacts(500)) {
      jids.add(toStatusJid(c.id));
    }
  } catch {
    /* best effort */
  }

  if (jids.size <= 1) {
    try {
      for (const c of await listWhatsAppChats(200)) {
        if (c.type === "user") jids.add(toStatusJid(c.id));
      }
    } catch {
      /* best effort */
    }
  }

  if (jids.size <= 1) {
    try {
      const groups = await listWhatsAppGroups();
      for (const g of groups.slice(0, 8)) {
        const members = await getGroupMembers(g.id);
        for (const p of members.participants) {
          jids.add(toStatusJid(p.id));
        }
      }
    } catch {
      /* best effort */
    }
  }

  return [...jids];
}

/** Appel générique Evolution API (console). */
export async function callGreenApi(
  method: string,
  options: {
    http?: "GET" | "POST" | "DELETE";
    body?: unknown;
    query?: Record<string, string>;
    pathSuffix?: string;
  } = {}
): Promise<unknown> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  if (method === "sendTextStatus") {
    const body = (options.body ?? {}) as Record<string, unknown>;
    const message = String(body.message ?? body.status ?? body.content ?? "").trim();
    if (!message) throw new EvolutionApiError("Le texte du statut est requis.");
    return sendWhatsAppTextStatus(message, {
      backgroundColor: body.backgroundColor ? String(body.backgroundColor) : undefined,
      font: body.font ? String(body.font) : undefined,
    });
  }

  const routeMap: Record<string, { path: string; http: "GET" | "POST" | "DELETE" }> = {
    getStateInstance: { path: `/instance/connectionState/${creds.instanceName}`, http: "GET" },
    getChats: { path: `/chat/findChats/${creds.instanceName}`, http: "POST" },
    getContacts: { path: `/chat/findContacts/${creds.instanceName}`, http: "POST" },
    getGroupData: { path: `/group/participants/${creds.instanceName}`, http: "GET" },
    getQR: { path: `/instance/connect/${creds.instanceName}`, http: "GET" },
    getSettings: { path: `/settings/find/${creds.instanceName}`, http: "GET" },
    reboot: { path: `/instance/restart/${creds.instanceName}`, http: "POST" },
    logout: { path: `/instance/logout/${creds.instanceName}`, http: "DELETE" },
    readChat: { path: `/chat/markMessageAsRead/${creds.instanceName}`, http: "POST" },
  };

  const mapped = routeMap[method];
  if (mapped) {
    return evolutionFetch(creds, mapped.path, {
      method: mapped.http,
      body: options.body,
      query: options.query,
    });
  }

  throw new EvolutionApiError(`Méthode non mappée pour Evolution API : ${method}`);
}

export async function connectInstance(): Promise<unknown> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/instance/connect/${creds.instanceName}`);
}

export async function restartInstance(): Promise<unknown> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/instance/restart/${creds.instanceName}`, { method: "POST" });
}

export async function setEvolutionWebhook(webhookUrl: string): Promise<unknown> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/webhook/set/${creds.instanceName}`, {
    method: "POST",
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    },
  });
}

export async function fetchAllInstances(): Promise<unknown> {
  const creds = getEvolutionCredentials();
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/instance/fetchInstances`, {
    query: { instanceName: creds.instanceName },
  });
}
