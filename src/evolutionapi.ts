import {
  assertCanSendTo,
  countOutboundToday,
  findProspectPhoneForLidReply,
  getAppSettings,
  getContact,
  getEffectiveOutboundLimit,
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

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

export async function getEvolutionCredentials(userId: number): Promise<EvolutionCredentials | null> {
  const s = await getAppSettings(userId);
  if (!s.evolution_api_key?.trim() || !s.evolution_instance_name?.trim()) return null;
  return {
    baseUrl: (s.evolution_api_base_url || config.defaultEvolutionBaseUrl).replace(/\/$/, ""),
    apiKey: s.evolution_api_key.trim(),
    instanceName: s.evolution_instance_name.trim(),
  };
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

/** Identifiant interne WhatsApp (@lid) — ne pas confondre avec un numéro de téléphone. */
export function isLidJid(jid: string): boolean {
  return jid.trim().toLowerCase().endsWith("@lid");
}

/** Numéro plausible (8–13 chiffres). Les @lid convertis en @c.us dépassent souvent 13 chiffres. */
export function isLikelyPhoneJid(jid: string): boolean {
  const digits = chatIdToNumber(jid);
  return digits.length >= 8 && digits.length <= 13;
}

export function normalizePhoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new EvolutionApiError("Numéro de téléphone invalide.");
  return `${digits}@c.us`;
}

export function normalizeGroupParticipantId(participantId: string): string {
  const id = participantId.trim();
  if (isLidJid(id)) return id;
  if (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")) {
    const digits = chatIdToNumber(id);
    if (isLikelyPhoneJid(id)) return `${digits}@c.us`;
    return `${digits}@lid`;
  }
  const digits = chatIdToNumber(id);
  if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
  if (digits.length >= 8) return `${digits}@lid`;
  return id;
}

export interface InboundChatMeta {
  senderPn?: string;
  remoteJidAlt?: string;
  senderName?: string;
  participant?: string;
}

export function chatIdsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const da = chatIdToNumber(a);
  const db = chatIdToNumber(b);
  return da.length >= 8 && da === db;
}

export async function resolveProspectChatId(userId: number, rawChatId: string, sender?: string): Promise<string> {
  return resolveInboundChatId(userId, rawChatId, { participant: sender });
}

/** Résout un JID entrant (@lid ou téléphone) vers le contact prospect réel. */
export async function resolveInboundChatId(
  userId: number,
  rawChatId: string,
  meta: InboundChatMeta = {}
): Promise<string> {
  const raw = rawChatId.trim();

  for (const candidate of [meta.senderPn, meta.remoteJidAlt, meta.participant]) {
    if (!candidate?.trim()) continue;
    const c = candidate.trim();
    if ((c.endsWith("@s.whatsapp.net") || c.endsWith("@c.us")) && isLikelyPhoneJid(c)) {
      return normalizeGroupParticipantId(c);
    }
  }

  if ((raw.endsWith("@c.us") || raw.endsWith("@s.whatsapp.net")) && isLikelyPhoneJid(raw)) {
    return normalizeGroupParticipantId(raw);
  }

  if (isLidJid(raw) || (raw.endsWith("@c.us") && !isLikelyPhoneJid(raw))) {
    const lid = isLidJid(raw) ? raw : `${chatIdToNumber(raw)}@lid`;
    const correlated = await findProspectPhoneForLidReply(userId, lid, meta.senderName);
    if (correlated) return correlated;
    return lid;
  }

  const senderId = meta.participant?.trim() || "";
  if (senderId.endsWith("@c.us") || senderId.endsWith("@s.whatsapp.net")) {
    return normalizeGroupParticipantId(senderId);
  }
  const digits = chatIdToNumber(senderId || raw);
  if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
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
  if (isLidJid(chatId)) return chatId;
  const digits = chatIdToNumber(chatId);
  if (!digits || !isLikelyPhoneJid(chatId)) {
    throw new EvolutionApiError("Destinataire invalide (identifiant @lid non résolu).");
  }
  return `${digits}@s.whatsapp.net`;
}

function formatEvolutionSendNumber(chatId: string): string {
  if (chatId.endsWith("@g.us")) return chatId;
  if (isLidJid(chatId)) return chatId;
  return toRemoteJid(chatId);
}

export interface TextSendOptions {
  /** Répondre en citant un message existant (carte de citation WhatsApp). */
  quoted?: { id: string; remoteJid?: string; fromMe?: boolean; conversation?: string };
  /** Numéros à mentionner (chiffres uniquement, ex. "22990000000"). Le texte doit contenir @numéro. */
  mentioned?: string[];
  /** Mentionner tous les membres du groupe (@everyone). */
  mentionsEveryOne?: boolean;
  /** Afficher l'aperçu de lien (carte SEO) pour les URLs du message. */
  linkPreview?: boolean;
  /** Délai (ms) pendant lequel « en train d'écrire… » s'affiche avant l'envoi. */
  delay?: number;
}

function buildTextOptionsBody(options?: TextSendOptions): Record<string, unknown> {
  if (!options) return {};
  const extra: Record<string, unknown> = {};
  if (options.quoted?.id) {
    extra.quoted = {
      key: {
        id: options.quoted.id,
        ...(options.quoted.remoteJid ? { remoteJid: options.quoted.remoteJid } : {}),
        ...(typeof options.quoted.fromMe === "boolean" ? { fromMe: options.quoted.fromMe } : {}),
      },
      ...(options.quoted.conversation
        ? { message: { conversation: options.quoted.conversation } }
        : {}),
    };
  }
  if (Array.isArray(options.mentioned) && options.mentioned.length > 0) {
    extra.mentioned = options.mentioned.map((n) => n.replace(/\D/g, "")).filter(Boolean);
  }
  if (options.mentionsEveryOne) extra.mentionsEveryOne = true;
  if (typeof options.linkPreview === "boolean") extra.linkPreview = options.linkPreview;
  if (typeof options.delay === "number" && options.delay > 0) {
    extra.delay = Math.min(Math.round(options.delay), 20_000);
  }
  return extra;
}

async function sendTextViaEvolution(
  creds: EvolutionCredentials,
  chatId: string,
  message: string,
  options?: TextSendOptions
): Promise<unknown> {
  const number = formatEvolutionSendNumber(chatId);
  const digits = chatIdToNumber(chatId);
  const extra = buildTextOptionsBody(options);
  const attempts: Array<Record<string, unknown>> = isLidJid(chatId)
    ? [
        { number, textMessage: { text: message }, ...extra },
        { number, text: message, ...extra },
      ]
    : [
        { number, textMessage: { text: message }, ...extra },
        { number: digits, textMessage: { text: message }, ...extra },
        { number, text: message, ...extra },
        { number: digits, text: message, ...extra },
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

/**
 * Crée (si nécessaire) l'instance Evolution dédiée à l'utilisateur.
 * Idempotent : ignore l'erreur si l'instance existe déjà.
 */
export async function createInstance(userId: number): Promise<void> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  try {
    await evolutionFetch(creds, `/instance/create`, {
      method: "POST",
      body: {
        instanceName: creds.instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: {
          enabled: true,
          url: `${config.publicUrl}/api/evolution/webhook`,
          webhookByEvents: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE"],
        },
      },
      timeoutMs: 60_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof EvolutionApiError ? err.status : undefined;
    const alreadyExists =
      status === 403 ||
      status === 409 ||
      /already|exists|in use|déjà/i.test(msg);
    if (alreadyExists) return;
    throw err;
  }
}

export async function diagnoseEvolutionApi(userId: number): Promise<{
  configured: boolean;
  connection: Awaited<ReturnType<typeof testEvolutionConnection>>;
  outboundToday: number;
  outboundLimit: number;
  sendFormatHint: string;
  statusEndpoint: string;
}> {
  const creds = await getEvolutionCredentials(userId);
  const connection = await testEvolutionConnection(userId);
  return {
    configured: Boolean(creds),
    connection,
    outboundToday: await countOutboundToday(userId),
    outboundLimit: await getEffectiveOutboundLimit(userId),
    sendFormatHint: "DM → {number: '229…@s.whatsapp.net', textMessage:{text}} | Groupe → @g.us",
    statusEndpoint: "/message/sendStatus (statut WhatsApp, pas la bio profil)",
  };
}

export async function testEvolutionConnection(userId: number): Promise<{
  connected: boolean;
  state: string;
  message: string;
}> {
  const creds = await getEvolutionCredentials(userId);
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

export async function requireEvolutionConnected(userId: number, context = "cette opération"): Promise<void> {
  const state = await testEvolutionConnection(userId);
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

type JidKind = "group" | "channel" | "broadcast" | "user";

function pickReadableName(...candidates: unknown[]): string {
  for (const c of candidates) {
    const t = String(c ?? "").trim();
    if (!t || t.includes("@")) continue;
    return t;
  }
  return "";
}

function classifyJidType(jid: string): JidKind {
  const j = jid.toLowerCase();
  if (j.includes("@newsletter")) return "channel";
  if (j.endsWith("@g.us")) return "group";
  if (j.includes("@broadcast")) return "broadcast";
  return "user";
}

function normalizeEvolutionRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["groups", "channels", "chats", "records", "data", "result"]) {
      const val = o[key];
      if (Array.isArray(val)) return val.filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>;
    }
  }
  return [];
}

async function fetchContactNameMap(
  creds: EvolutionCredentials,
  limit = 500
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const data = await evolutionFetch<unknown>(creds, `/chat/findContacts/${creds.instanceName}`, {
      method: "POST",
      body: { take: limit },
      timeoutMs: 45_000,
    });
    for (const c of normalizeEvolutionRows(data)) {
      const id = String(c.remoteJid || c.id || c.jid || "");
      const name = pickReadableName(c.pushName, c.name, c.contactName);
      if (!id || !name) continue;
      map.set(id, name);
      if (id.endsWith("@s.whatsapp.net")) {
        map.set(`${chatIdToNumber(id)}@c.us`, name);
        map.set(`${chatIdToNumber(id)}@s.whatsapp.net`, name);
      }
      if (id.endsWith("@lid")) map.set(id, name);
    }
  } catch (err) {
    console.warn("findContacts (noms):", err instanceof Error ? err.message : err);
  }
  return map;
}

async function fetchGroupNameMap(creds: EvolutionCredentials): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const data = await evolutionFetch<unknown>(creds, `/group/fetchAllGroups/${creds.instanceName}`, {
      query: { getParticipants: "false" },
      timeoutMs: 90_000,
    });
    for (const g of normalizeEvolutionRows(data)) {
      const id = String(g.id || g.remoteJid || g.jid || "");
      const name = pickReadableName(g.subject, g.name, g.pushName);
      if (id.endsWith("@g.us") && name) map.set(id, name);
    }
  } catch (err) {
    console.warn("fetchAllGroups (noms):", err instanceof Error ? err.message : err);
  }
  return map;
}

async function resolveGroupDisplayName(
  creds: EvolutionCredentials,
  groupId: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(groupId);
  if (cached) return cached;
  try {
    const info = await evolutionFetch<{ group?: { subject?: string } }>(
      creds,
      `/group/findGroupInfos/${creds.instanceName}`,
      { query: { groupJid: groupId }, timeoutMs: 20_000 }
    );
    const subject = info.group?.subject?.trim();
    if (subject) {
      cache.set(groupId, subject);
      return subject;
    }
  } catch {
    /* ignore */
  }
  return `Groupe …${groupId.replace("@g.us", "").slice(-6)}`;
}

async function resolveChatDisplayName(
  creds: EvolutionCredentials,
  id: string,
  type: JidKind,
  contactNames: Map<string, string>,
  groupNames: Map<string, string>
): Promise<string> {
  if (type === "group") return resolveGroupDisplayName(creds, id, groupNames);
  if (type === "channel") {
    return `Chaîne WhatsApp (…${id.split("@")[0].slice(-8)})`;
  }
  if (type === "broadcast") return "Statuts WhatsApp";

  const normalized = id.endsWith("@s.whatsapp.net") ? normalizeGroupParticipantId(id) : id;
  const fromBook =
    contactNames.get(id) ||
    contactNames.get(normalized) ||
    contactNames.get(`${chatIdToNumber(id)}@c.us`) ||
    contactNames.get(`${chatIdToNumber(id)}@s.whatsapp.net`);
  if (fromBook) return fromBook;

  if (isLikelyPhoneJid(id)) return chatIdToDisplay(normalizeGroupParticipantId(id));
  if (isLidJid(id)) return `Contact (…${chatIdToNumber(id).slice(-6)})`;
  return `Chat (…${id.slice(0, 14)})`;
}

export async function listWhatsAppGroups(userId: number): Promise<Array<{ id: string; name: string; type: string }>> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const groupNames = await fetchGroupNameMap(creds);
  if (groupNames.size > 0) {
    return [...groupNames.entries()].map(([id, name]) => ({ id, name, type: "group" }));
  }

  const data = await evolutionFetch<unknown>(
    creds,
    `/group/fetchAllGroups/${creds.instanceName}`,
    { query: { getParticipants: "false" }, timeoutMs: 90_000 }
  );

  const rows = normalizeEvolutionRows(data);
  const out: Array<{ id: string; name: string; type: string }> = [];

  for (const g of rows) {
    const id = String(g.id || g.remoteJid || g.jid || "");
    if (!id.endsWith("@g.us")) continue;
    const name =
      pickReadableName(g.subject, g.name, g.pushName) ||
      (await resolveGroupDisplayName(creds, id, groupNames));
    out.push({ id, name, type: "group" });
  }

  return out;
}

export async function listWhatsAppChannels(userId: number): Promise<Array<{ id: string; name: string; type: string }>> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const channels: Array<{ id: string; name: string; type: string }> = [];

  try {
    const data = await evolutionFetch<unknown>(creds, `/chat/findChannels/${creds.instanceName}`, {
      method: "POST",
      body: {},
      timeoutMs: 45_000,
    });
    for (const row of normalizeEvolutionRows(data)) {
      const id = String(row.id || row.remoteJid || row.jid || "");
      if (!id.includes("@newsletter")) continue;
      const name =
        pickReadableName(row.name, row.pushName, row.subject) || `Chaîne WhatsApp (${id.split("@")[0].slice(-8)})`;
      channels.push({ id, name, type: "channel" });
    }
  } catch {
    /* findChannels absent sur certaines versions — repli via findChats */
  }

  if (channels.length === 0) {
    const chats = await listWhatsAppChats(userId, 300);
    for (const c of chats) {
      if (c.type === "channel") channels.push({ id: c.id, name: c.name, type: "channel" });
    }
  }

  return channels;
}

function normalizeParticipantNumbers(raw: string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const digits = chatIdToNumber(String(item ?? ""));
    if (digits.length >= 8 && digits.length <= 15) out.push(digits);
  }
  return [...new Set(out)];
}

function extractCreatedGroupId(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  const candidates = [
    o.id,
    o.groupId,
    o.gid,
    (o.group as { id?: string } | undefined)?.id,
    (o.group as { jid?: string } | undefined)?.jid,
    (o.key as { remoteJid?: string } | undefined)?.remoteJid,
  ];
  for (const c of candidates) {
    const id = String(c ?? "").trim();
    if (id.endsWith("@g.us")) return id;
  }
  return "";
}

/** Crée un groupe WhatsApp via Evolution API (minimum 1 participant requis par WhatsApp). */
export async function createWhatsAppGroup(userId: number, input: {
  subject: string;
  participants: string[];
  description?: string;
  promoteParticipants?: boolean;
}): Promise<{ groupId: string; subject: string; participantCount: number }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await requireEvolutionConnected(userId, "la création de groupe");

  const subject = input.subject.trim().slice(0, 100);
  if (!subject) throw new EvolutionApiError("Le nom du groupe est requis.");

  const participants = normalizeParticipantNumbers(input.participants);
  if (participants.length === 0) {
    throw new EvolutionApiError(
      "Au moins un numéro de participant valide est requis (WhatsApp n'autorise pas un groupe vide)."
    );
  }

  const description = (input.description ?? "").trim().slice(0, 500);
  const body: Record<string, unknown> = {
    subject,
    participants,
    description: description || subject,
  };
  if (input.promoteParticipants) body.promoteParticipants = true;

  const data = await evolutionFetch<unknown>(creds, `/group/create/${creds.instanceName}`, {
    method: "POST",
    body,
    timeoutMs: 60_000,
  });

  let groupId = extractCreatedGroupId(data);
  if (!groupId) {
    const groups = await fetchGroupNameMap(creds);
    for (const [id, name] of groups.entries()) {
      if (name.toLowerCase() === subject.toLowerCase()) {
        groupId = id;
        break;
      }
    }
  }

  if (!groupId) {
    throw new EvolutionApiError(
      "Groupe créé côté WhatsApp mais ID non retourné par Evolution API. Utilisez list_whatsapp_groups pour le retrouver."
    );
  }

  return { groupId, subject, participantCount: participants.length };
}

export async function getGroupMembers(userId: number, groupId: string): Promise<{
  groupId: string;
  subject: string;
  size: number;
  participants: Array<{ id: string; name?: string; isAdmin?: boolean }>;
}> {
  const creds = await getEvolutionCredentials(userId);
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
  userId: number,
  chatId: string,
  message: string,
  opts: {
    enableAutoReply?: boolean;
    countsTowardQuota?: boolean;
    textOptions?: TextSendOptions;
  } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const data = await sendTextViaEvolution(creds, chatId, message, opts.textOptions);

  markOutboundSent();
  const idMessage = extractMessageId(data);

  await saveWhatsAppMessage(userId, {
    contactPhone: chatId.endsWith("@g.us") ? chatId : normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: message,
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      await saveContact(userId, { phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  } else if (normalized.endsWith("@c.us")) {
    try {
      if (!(await getContact(userId, normalized))) {
        await saveContact(userId, { phone: normalized, status: "en_conversation", autoReply: false });
      }
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized.endsWith("@g.us") ? chatId : normalized };
}

/**
 * Réagit à un message avec un emoji (ou le retire si `reaction` est vide).
 * `messageId` = id du message ciblé (ex. via list_green_incoming_messages).
 * `fromMe` = true si on réagit à un message qu'on a soi-même envoyé.
 */
export async function sendWhatsAppReaction(
  userId: number,
  chatId: string,
  messageId: string,
  reaction: string,
  opts: { fromMe?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const remoteJid = formatEvolutionSendNumber(chatId);
  const data = await evolutionFetch<unknown>(creds, `/message/sendReaction/${creds.instanceName}`, {
    method: "POST",
    body: {
      key: { remoteJid, fromMe: opts.fromMe ?? false, id: messageId },
      reaction,
    },
  });

  const idMessage = extractMessageId(data);
  return { idMessage, chatId: normalizeGroupParticipantId(chatId) };
}

export async function sendWhatsAppMedia(
  userId: number,
  chatId: string,
  input: {
    /** URL publique OU chaîne base64 (avec ou sans préfixe data:) du média. */
    url: string;
    type: "image" | "video" | "document" | "audio";
    caption?: string;
    fileName?: string;
    /** MIME explicite (ex. video/mp4, application/pdf). Requis pour certains base64. */
    mimetype?: string;
  },
  opts: { enableAutoReply?: boolean; countsTowardQuota?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  // Evolution accepte l'URL ou le base64 dans le même champ `media`. On retire un
  // éventuel préfixe data:...;base64, car l'API attend le base64 nu.
  const media = input.url.startsWith("data:")
    ? input.url.slice(input.url.indexOf(",") + 1)
    : input.url;

  const data = await evolutionFetch<unknown>(creds, `/message/sendMedia/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      mediatype: input.type,
      media,
      caption: input.caption,
      fileName: input.fileName,
      ...(input.mimetype ? { mimetype: input.mimetype } : {}),
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  const source = input.url.startsWith("data:") ? "[base64]" : input.url;
  const label = input.caption || `[${input.type}] ${source}`;

  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: label,
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      await saveContact(userId, { phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized };
}

/**
 * Envoie une vraie note vocale WhatsApp (PTT). Différent d'un fichier audio :
 * WhatsApp l'affiche avec la forme d'onde et le bouton lecture.
 * `audio` = URL publique OU base64 (préfixe data: accepté).
 */
export async function sendWhatsAppVoice(
  userId: number,
  chatId: string,
  audio: string,
  opts: { enableAutoReply?: boolean; countsTowardQuota?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const payload = audio.startsWith("data:") ? audio.slice(audio.indexOf(",") + 1) : audio;

  const data = await evolutionFetch<unknown>(creds, `/message/sendWhatsAppAudio/${creds.instanceName}`, {
    method: "POST",
    body: { number, audio: payload },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);

  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: "[note vocale]",
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      await saveContact(userId, { phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized };
}

/** Envoie une localisation (épingle carte) avec nom et adresse/description. */
export async function sendWhatsAppLocation(
  userId: number,
  chatId: string,
  input: { latitude: number; longitude: number; name?: string; address?: string },
  opts: { enableAutoReply?: boolean; countsTowardQuota?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const data = await evolutionFetch<unknown>(creds, `/message/sendLocation/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      name: input.name,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  const label = `[localisation] ${input.name || ""} (${input.latitude}, ${input.longitude})`.trim();

  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: label,
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      await saveContact(userId, { phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized };
}

/** Envoie une carte contact (vCard) : nom, entreprise, téléphone, email, URL. */
export async function sendWhatsAppContact(
  userId: number,
  chatId: string,
  contact: {
    fullName: string;
    phone: string;
    organization?: string;
    email?: string;
    url?: string;
  },
  opts: { enableAutoReply?: boolean; countsTowardQuota?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const wuid = contact.phone.replace(/\D/g, "");

  const data = await evolutionFetch<unknown>(creds, `/message/sendContact/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      contact: [
        {
          fullName: contact.fullName,
          wuid,
          phoneNumber: contact.phone,
          organization: contact.organization,
          email: contact.email,
          url: contact.url,
        },
      ],
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  const label = `[contact] ${contact.fullName} — ${contact.phone}`;

  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: label,
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  const normalized = normalizeGroupParticipantId(chatId);
  if (normalized.endsWith("@c.us") && opts.enableAutoReply !== false) {
    try {
      await saveContact(userId, { phone: normalized, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
  }

  return { idMessage, chatId: normalized };
}

/** Envoie un SONDAGE (poll). Les votes reviennent via le webhook (best-effort). */
export async function sendWhatsAppPoll(
  userId: number,
  chatId: string,
  input: { name: string; values: string[]; selectableCount?: number; delay?: number },
  opts: { countsTowardQuota?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const values = input.values.map((v) => v.trim()).filter(Boolean);
  if (!input.name.trim()) throw new EvolutionApiError("La question du sondage est requise.");
  if (values.length < 2) throw new EvolutionApiError("Un sondage nécessite au moins 2 options.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const selectableCount = Math.min(Math.max(input.selectableCount ?? 1, 1), values.length);
  const data = await evolutionFetch<unknown>(creds, `/message/sendPoll/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      name: input.name.trim(),
      selectableCount,
      values,
      ...(input.delay && input.delay > 0 ? { delay: Math.min(Math.round(input.delay), 20_000) } : {}),
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: `[sondage] ${input.name.trim()} — ${values.join(" / ")}`,
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  return { idMessage, chatId: normalizeGroupParticipantId(chatId) };
}

/** Envoie une LISTE interactive (menu de sélection). Expérimental côté WhatsApp. */
export async function sendWhatsAppList(
  userId: number,
  chatId: string,
  input: {
    title: string;
    description: string;
    buttonText: string;
    footerText?: string;
    sections: Array<{
      title: string;
      rows: Array<{ title: string; description?: string; rowId?: string }>;
    }>;
    delay?: number;
  },
  opts: { countsTowardQuota?: boolean } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  if (!input.sections?.length) throw new EvolutionApiError("La liste nécessite au moins une section.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const sections = input.sections.map((s) => ({
    title: s.title,
    rows: s.rows.map((r, i) => ({
      title: r.title,
      description: r.description ?? "",
      rowId: r.rowId ?? `row_${i + 1}`,
    })),
  }));

  const data = await evolutionFetch<unknown>(creds, `/message/sendList/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      title: input.title,
      description: input.description,
      buttonText: input.buttonText,
      footerText: input.footerText ?? "",
      sections,
      ...(input.delay && input.delay > 0 ? { delay: Math.min(Math.round(input.delay), 20_000) } : {}),
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: `[liste] ${input.title} — ${input.buttonText}`,
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  return { idMessage, chatId: normalizeGroupParticipantId(chatId) };
}

/** Envoie un STICKER (image statique WebP/PNG/JPEG). `sticker` = URL ou base64. */
export async function sendWhatsAppSticker(
  userId: number,
  chatId: string,
  sticker: string,
  opts: { countsTowardQuota?: boolean; delay?: number } = {}
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  await assertCanSendTo(userId, chatId);
  await waitOutboundSpacing();

  const number = formatEvolutionSendNumber(chatId);
  const payload = sticker.startsWith("data:") ? sticker.slice(sticker.indexOf(",") + 1) : sticker;
  const data = await evolutionFetch<unknown>(creds, `/message/sendSticker/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      sticker: payload,
      ...(opts.delay && opts.delay > 0 ? { delay: Math.min(Math.round(opts.delay), 20_000) } : {}),
    },
  });

  markOutboundSent();
  const idMessage = extractMessageId(data);
  await saveWhatsAppMessage(userId, {
    contactPhone: normalizeGroupParticipantId(chatId),
    direction: "sortant",
    body: "[sticker]",
    greenApiId: idMessage,
    countsTowardQuota: opts.countsTowardQuota !== false,
  });

  return { idMessage, chatId: normalizeGroupParticipantId(chatId) };
}

export async function findGroupByNameOrId(
  userId: number,
  nameOrId: string
): Promise<{ id: string; name: string } | null> {
  const raw = nameOrId.trim();
  if (raw.endsWith("@g.us")) return { id: raw, name: raw };

  const groups = await listWhatsAppGroups(userId);
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
  userId: number,
  groupId: string,
  message: string,
  options: { maxMembers?: number; delayMs?: number } = {}
): Promise<{
  groupName: string;
  sent: Array<{ chatId: string; idMessage: string }>;
  skipped: number;
  errors: Array<{ chatId: string; error: string }>;
}> {
  const group = await getGroupMembers(userId, groupId);
  const maxMembers = options.maxMembers ?? 30;
  const delayMs = options.delayMs ?? 4000;

  const sent: Array<{ chatId: string; idMessage: string }> = [];
  const errors: Array<{ chatId: string; error: string }> = [];

  const eligible: typeof group.participants = [];
  for (const p of group.participants) {
    if (!(await isContactBlocked(userId, p.id))) eligible.push(p);
  }
  const blockedSkipped = group.participants.length - eligible.length;
  const participants = eligible.slice(0, maxMembers);
  const skipped = Math.max(0, eligible.length - participants.length) + blockedSkipped;

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    try {
      const result = await sendWhatsAppMessage(userId, p.id, message);
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
  userId: number,
  recipient: string,
  count = 30
): Promise<{ chatId: string; display: string; messages: ChatHistoryEntry[] }> {
  const creds = await getEvolutionCredentials(userId);
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
  senderPn?: string;
  remoteJidAlt?: string;
}

export async function getLastIncomingMessages(userId: number): Promise<LastIncomingMessage[]> {
  const creds = await getEvolutionCredentials(userId);
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
      const key = r.key as {
        id?: string;
        remoteJid?: string;
        participant?: string;
        senderPn?: string;
        remoteJidAlt?: string;
      } | undefined;
      const remoteJid = key?.remoteJid ?? "";
      if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid.includes("@broadcast")) continue;

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
        senderPn: key?.senderPn,
        remoteJidAlt: key?.remoteJidAlt,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function sendWhatsAppTextStatus(
  userId: number,
  message: string,
  options: { backgroundColor?: string; font?: string; participants?: string[] } = {}
): Promise<{ idMessage: string; audienceCount: number; confirmed: boolean }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const text = message.trim();
  if (!text) throw new EvolutionApiError("Le texte du statut est requis.");
  if (text.length > 500) throw new EvolutionApiError("Statut trop long (max 500 caractères).");

  const statusJidList = await buildStatusJidList(userId, options.participants);
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
        timeoutMs: 90_000,
      });
      return {
        idMessage: extractMessageId(data) || `status-${Date.now()}`,
        audienceCount: statusJidList.length,
        confirmed: true,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // Timeout : sur Evolution v2.3.7, le statut EST publié malgré l'absence de
      // réponse. On NE retente PAS (sinon publication en double) → succès probable.
      if (isEvolutionTimeoutError(err)) {
        return {
          idMessage: `status-${Date.now()}`,
          audienceCount: statusJidList.length,
          confirmed: false,
        };
      }
      // 400/422 : corps rejeté → on tente la variante suivante.
      const retryable = err instanceof EvolutionApiError && (err.status === 400 || err.status === 422);
      if (!retryable) throw err;
    }
  }

  throw new EvolutionApiError(
    `Publication du statut refusée par Evolution API (${statusJidList.length} contacts ciblés). ` +
      `Détail : ${lastErr?.message ?? "erreur inconnue"}`
  );
}

/**
 * Publie un STATUT (story) média : image, vidéo ou audio.
 * `content` = URL publique OU base64 (préfixe data: accepté).
 * Audience : `participants` fournis = ciblée, sinon tous les contacts (statusJidList construit).
 */
export async function sendWhatsAppMediaStatus(
  userId: number,
  input: {
    type: "image" | "video" | "audio";
    content: string;
    caption?: string;
    backgroundColor?: string;
    participants?: string[];
  }
): Promise<{ idMessage: string; audienceCount: number; confirmed: boolean }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  if (!input.content?.trim()) throw new EvolutionApiError("Le contenu du statut (URL ou base64) est requis.");

  const statusJidList = await buildStatusJidList(userId, input.participants);
  if (statusJidList.length === 0) {
    throw new EvolutionApiError(
      "Aucun contact disponible pour publier le statut. Evolution API exige statusJidList (allContacts provoque un timeout sur v2.3.7)."
    );
  }

  const content = input.content.startsWith("data:")
    ? input.content.slice(input.content.indexOf(",") + 1)
    : input.content;

  const body: Record<string, unknown> = {
    type: input.type,
    content,
    allContacts: false,
    statusJidList,
  };
  if (input.caption) body.caption = input.caption;
  if (input.backgroundColor && input.type !== "audio") body.backgroundColor = input.backgroundColor;

  try {
    const data = await evolutionFetch<unknown>(creds, `/message/sendStatus/${creds.instanceName}`, {
      method: "POST",
      body,
      timeoutMs: 90_000,
    });
    return {
      idMessage: extractMessageId(data) || `status-${Date.now()}`,
      audienceCount: statusJidList.length,
      confirmed: true,
    };
  } catch (err) {
    // Bug connu Evolution v2.3.7 : sendStatus PUBLIE le statut mais ne renvoie pas
    // de réponse HTTP → timeout. On considère donc l'envoi comme probablement réussi.
    if (isEvolutionTimeoutError(err)) {
      return {
        idMessage: `status-${Date.now()}`,
        audienceCount: statusJidList.length,
        confirmed: false,
      };
    }
    throw err;
  }
}

/** Détecte un timeout Evolution (le statut est souvent publié malgré l'absence de réponse). */
function isEvolutionTimeoutError(err: unknown): boolean {
  if (err instanceof EvolutionApiError) {
    return /délai|timeout|Abort|attente dépassé/i.test(err.message);
  }
  return err instanceof Error && (err.name === "AbortError" || /timeout|abort/i.test(err.message));
}

export async function listWhatsAppChats(userId: number, count = 100): Promise<
  Array<{ id: string; name: string; type: string; archive?: boolean }>
> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const safe = Math.min(Math.max(count, 1), 500);
  const [data, contactNames, groupNames] = await Promise.all([
    evolutionFetch<unknown>(creds, `/chat/findChats/${creds.instanceName}`, {
      method: "POST",
      body: { take: safe },
      timeoutMs: 45_000,
    }),
    fetchContactNameMap(creds),
    fetchGroupNameMap(creds),
  ]);

  const rows = normalizeEvolutionRows(data);
  const out: Array<{ id: string; name: string; type: string; archive?: boolean }> = [];

  for (const c of rows) {
    const id = String(c.remoteJid || c.id || c.jid || "");
    if (!id || id === "status@broadcast") continue;

    const type = classifyJidType(id);
    const inlineName = pickReadableName(c.name, c.pushName, c.subject, c.contactName);
    const name =
      inlineName ||
      (await resolveChatDisplayName(creds, id, type, contactNames, groupNames));

    out.push({
      id,
      name,
      type,
      archive: Boolean(c.archived),
    });
  }

  return out;
}

export async function markChatRead(userId: number, chatId: string, idMessage?: string): Promise<{ setRead: boolean }> {
  const creds = await getEvolutionCredentials(userId);
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

/** Marque un chat comme NON LU (dernier message identifié par idMessage). */
export async function markChatUnread(
  userId: number,
  chatId: string,
  idMessage: string,
  opts: { fromMe?: boolean } = {}
): Promise<{ markedUnread: boolean }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const remoteJid = toRemoteJid(chatId);
  await evolutionFetch(creds, `/chat/markChatUnread/${creds.instanceName}`, {
    method: "POST",
    body: {
      lastMessage: { key: { remoteJid, fromMe: opts.fromMe ?? false, id: idMessage } },
      chat: remoteJid,
    },
  });
  return { markedUnread: true };
}

/** Archive ou désarchive un chat. */
export async function archiveChat(
  userId: number,
  chatId: string,
  idMessage: string,
  archive: boolean,
  opts: { fromMe?: boolean } = {}
): Promise<{ archived: boolean }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const remoteJid = toRemoteJid(chatId);
  await evolutionFetch(creds, `/chat/archiveChat/${creds.instanceName}`, {
    method: "POST",
    body: {
      lastMessage: { key: { remoteJid, fromMe: opts.fromMe ?? false, id: idMessage } },
      chat: remoteJid,
      archive,
    },
  });
  return { archived: archive };
}

/** Modifie le texte d'un message DÉJÀ envoyé par nous (édition WhatsApp). */
export async function editWhatsAppMessage(
  userId: number,
  chatId: string,
  idMessage: string,
  newText: string
): Promise<{ idMessage: string; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  if (!newText.trim()) throw new EvolutionApiError("Le nouveau texte est requis.");

  const remoteJid = toRemoteJid(chatId);
  const number = chatId.endsWith("@g.us") ? chatId : chatIdToNumber(chatId);
  const data = await evolutionFetch<unknown>(creds, `/chat/updateMessage/${creds.instanceName}`, {
    method: "POST",
    body: {
      number,
      text: newText,
      key: { remoteJid, fromMe: true, id: idMessage },
    },
  });
  return { idMessage: extractMessageId(data) || idMessage, chatId: normalizeGroupParticipantId(chatId) };
}

/** Supprime un message pour TOUT LE MONDE (revoke). Le message doit avoir été envoyé par nous. */
export async function deleteWhatsAppMessage(
  userId: number,
  chatId: string,
  idMessage: string,
  opts: { fromMe?: boolean; participant?: string } = {}
): Promise<{ deleted: boolean; chatId: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const remoteJid = toRemoteJid(chatId);
  await evolutionFetch(creds, `/chat/deleteMessageForEveryone/${creds.instanceName}`, {
    method: "DELETE",
    body: {
      id: idMessage,
      remoteJid,
      fromMe: opts.fromMe ?? true,
      ...(opts.participant ? { participant: opts.participant } : {}),
    },
  });
  return { deleted: true, chatId: normalizeGroupParticipantId(chatId) };
}

/** Récupère le média d'un message (image/vidéo/audio/document) en base64. */
export async function getMessageMediaBase64(
  userId: number,
  idMessage: string,
  opts: { convertToMp4?: boolean } = {}
): Promise<{ base64: string; mimetype: string; fileName: string; mediaType: string }> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const data = await evolutionFetch<{
    base64?: string;
    mimetype?: string;
    fileName?: string;
    mediaType?: string;
  }>(creds, `/chat/getBase64FromMediaMessage/${creds.instanceName}`, {
    method: "POST",
    body: {
      message: { key: { id: idMessage } },
      ...(opts.convertToMp4 ? { convertToMp4: true } : {}),
    },
    timeoutMs: 60_000,
  });

  if (!data?.base64) throw new EvolutionApiError("Aucun média récupéré pour ce message.");
  return {
    base64: data.base64,
    mimetype: data.mimetype ?? "application/octet-stream",
    fileName: data.fileName ?? "media",
    mediaType: data.mediaType ?? "unknown",
  };
}

export interface SearchedMessage {
  idMessage: string;
  chatId: string;
  fromMe: boolean;
  text: string;
  typeMessage: string;
  timestamp: number;
}

/**
 * Recherche/liste des messages. Filtre par chat (recipient) et/ou texte.
 * Pour les messages de STATUT, passer recipient="status@broadcast".
 */
export async function searchWhatsAppMessages(
  userId: number,
  opts: { recipient?: string; query?: string; count?: number } = {}
): Promise<SearchedMessage[]> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");

  const take = Math.min(Math.max(opts.count ?? 50, 1), 200);
  const where: Record<string, unknown> = {};
  if (opts.recipient) {
    const remoteJid =
      opts.recipient === "status@broadcast"
        ? "status@broadcast"
        : opts.recipient.includes("@")
          ? toRemoteJid(opts.recipient)
          : toRemoteJid(normalizePhoneToChatId(opts.recipient));
    where.key = { remoteJid };
  }

  const data = await evolutionFetch<{ messages?: { records?: unknown[] } }>(
    creds,
    `/chat/findMessages/${creds.instanceName}`,
    {
      method: "POST",
      body: { where, take, orderBy: { messageTimestamp: "desc" } },
    }
  );

  const records = data.messages?.records ?? [];
  const q = opts.query?.trim().toLowerCase();
  const out: SearchedMessage[] = [];
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const key = r.key as { id?: string; fromMe?: boolean; remoteJid?: string } | undefined;
    const text = extractEvolutionText(r.message);
    if (!text) continue;
    if (q && !text.toLowerCase().includes(q)) continue;
    out.push({
      idMessage: key?.id ?? "",
      chatId: normalizeGroupParticipantId(key?.remoteJid ?? ""),
      fromMe: Boolean(key?.fromMe),
      text,
      typeMessage: String(r.messageType ?? "text"),
      timestamp: Number(r.messageTimestamp ?? 0),
    });
  }
  return out;
}

export async function listPersonalContacts(userId: number, limit = 50): Promise<Array<{ id: string; name: string }>> {
  const creds = await getEvolutionCredentials(userId);
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
async function buildStatusJidList(userId: number, participants?: string[]): Promise<string[]> {
  if (participants?.length) {
    return [...new Set(participants.map(toStatusJid))];
  }

  const jids = new Set<string>();
  const creds = await getEvolutionCredentials(userId);
  if (creds) {
    const owner = await getInstanceOwnerJid(creds);
    if (owner) jids.add(owner);
  }

  try {
    for (const c of await listPersonalContacts(userId, 500)) {
      jids.add(toStatusJid(c.id));
    }
  } catch {
    /* best effort */
  }

  if (jids.size <= 1) {
    try {
      for (const c of await listWhatsAppChats(userId, 200)) {
        if (c.type === "user") jids.add(toStatusJid(c.id));
      }
    } catch {
      /* best effort */
    }
  }

  if (jids.size <= 1) {
    try {
      const groups = await listWhatsAppGroups(userId);
      for (const g of groups.slice(0, 8)) {
        const members = await getGroupMembers(userId, g.id);
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

export function parseConnectQrPayload(data: unknown): {
  base64: string | null;
  pairingCode: string | null;
} {
  if (!data || typeof data !== "object") return { base64: null, pairingCode: null };
  const o = data as Record<string, unknown>;

  let base64: string | null = null;
  if (typeof o.base64 === "string" && o.base64.trim()) {
    base64 = o.base64.trim();
  } else if (o.qrcode && typeof o.qrcode === "object") {
    const q = (o.qrcode as { base64?: string }).base64;
    if (typeof q === "string" && q.trim()) base64 = q.trim();
  } else if (typeof o.qrCode === "string" && o.qrCode.trim()) {
    base64 = o.qrCode.trim();
  } else if (typeof o.code === "string" && o.code.includes("base64,")) {
    base64 = o.code.split("base64,")[1]?.trim() || null;
  } else if (typeof o.message === "string" && o.message.length > 80) {
    base64 = o.message.trim();
  }

  const pairingCode =
    typeof o.pairingCode === "string" && o.pairingCode.trim()
      ? o.pairingCode.trim()
      : typeof o.code === "string" && o.code.length <= 12
        ? o.code.trim()
        : null;

  return { base64, pairingCode };
}

export async function getInstanceQr(userId: number): Promise<{
  base64: string | null;
  pairingCode: string | null;
  state: string;
  connected: boolean;
  message: string;
}> {
  const state = await testEvolutionConnection(userId);
  if (state.connected) {
    return {
      base64: null,
      pairingCode: null,
      state: state.state,
      connected: true,
      message: "WhatsApp est déjà connecté à cette instance.",
    };
  }

  // Assure l'existence de l'instance dédiée avant de demander le QR (idempotent).
  await createInstance(userId);

  // Garantit que le webhook pointe vers ce backend, même pour une instance
  // pré-existante (ex. PUBLIC_URL modifiée). Le poller d'historique sert de repli.
  try {
    await setEvolutionWebhook(userId, `${config.publicUrl}/api/evolution/webhook`);
  } catch (err) {
    console.warn(`⚠️ Webhook non (re)configuré pour user ${userId}:`, err instanceof Error ? err.message : err);
  }

  const raw = await connectInstance(userId);
  const { base64, pairingCode } = parseConnectQrPayload(raw);
  return {
    base64,
    pairingCode,
    state: state.state,
    connected: false,
    message: base64 || pairingCode
      ? "Scannez le QR code avec WhatsApp (Appareils connectés)."
      : state.message,
  };
}

export async function connectInstance(userId: number): Promise<unknown> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/instance/connect/${creds.instanceName}`);
}

export async function restartInstance(userId: number): Promise<unknown> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/instance/restart/${creds.instanceName}`, { method: "POST" });
}

export async function setEvolutionWebhook(userId: number, webhookUrl: string): Promise<unknown> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/webhook/set/${creds.instanceName}`, {
    method: "POST",
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    },
  });
}

export async function fetchAllInstances(userId: number): Promise<unknown> {
  const creds = await getEvolutionCredentials(userId);
  if (!creds) throw new EvolutionApiError("Evolution API non configurée.");
  return evolutionFetch(creds, `/instance/fetchInstances`, {
    query: { instanceName: creds.instanceName },
  });
}
