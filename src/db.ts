import { sql } from "./pg.js";
import { config, evolutionInstanceName } from "./config.js";
import { getUserById } from "./users.js";
import { matchesAnyTriggerPhrase } from "./phrase-matching.js";

export const DAILY_OUTBOUND_LIMIT = 30;
export const CONTACT_STATUSES = ["nouveau", "en_conversation", "interesse", "stop"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** Heure locale au format comparable (ex-SQLite localtime). */
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function parseLocalDateTime(value: string): Date {
  const [datePart, timePart = "00:00:00"] = value.trim().split(/\s+/);
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min, s] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, h ?? 0, min ?? 0, s ?? 0);
}

function toTsParam(value: string | Date): Date {
  return value instanceof Date ? value : parseLocalDateTime(value);
}

function formatTs(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return formatLocalDateTime(value);
  return String(value);
}

function formatTsNullable(value: unknown): string | null {
  if (value == null) return null;
  return formatTs(value);
}

async function getSettingRaw(userId: number, key: string): Promise<string> {
  const rows = await sql<{ value: string }[]>`
    SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key}
  `;
  return rows[0]?.value ?? "";
}

async function setSettingRaw(userId: number, key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO settings (user_id, key, value, updated_at)
    VALUES (${userId}, ${key}, ${value}, NOW())
    ON CONFLICT (user_id, key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
  `;
}

async function getSetting(userId: number, key: string): Promise<string> {
  return getSettingRaw(userId, key);
}

async function setSetting(userId: number, key: string, value: string): Promise<void> {
  await setSettingRaw(userId, key, value);
}

async function upsertContactInternal(userId: number, input: {
  phone: string;
  name?: string | null;
  notes?: string | null;
  status?: ContactStatus;
  autoReply?: boolean;
}): Promise<void> {
  const existing = await sql<{ id: number }[]>`
    SELECT id FROM contacts WHERE user_id = ${userId} AND phone = ${input.phone}
  `;

  const autoReply =
    input.autoReply === undefined ? null : input.autoReply ? 1 : 0;

  if (!existing.length) {
    await sql`
      INSERT INTO contacts (user_id, phone, name, notes, status, auto_reply)
      VALUES (
        ${userId},
        ${input.phone},
        ${input.name ?? null},
        ${input.notes ?? null},
        ${input.status ?? "nouveau"},
        ${autoReply ?? 0}
      )
    `;
    return;
  }

  await sql`
    UPDATE contacts SET
      name = COALESCE(${input.name ?? null}, name),
      notes = COALESCE(${input.notes ?? null}, notes),
      status = COALESCE(${input.status ?? null}, status),
      auto_reply = COALESCE(${autoReply}, auto_reply),
      updated_at = NOW()
    WHERE user_id = ${userId} AND phone = ${input.phone}
  `;
}

export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  id: number;
  role: AgentRole;
  content: string;
  created_at: string;
}

export interface AppSettings {
  openai_api_key: string;
  evolution_api_base_url: string;
  evolution_api_key: string;
  evolution_instance_name: string;
  business_owner_name: string;
  business_offer: string;
  business_price: string;
}

export async function getAppSettings(userId: number): Promise<AppSettings> {
  const user = await getUserById(userId);
  return {
    openai_api_key: config.envOpenAiKey,
    evolution_api_base_url: config.envEvolutionBaseUrl || config.defaultEvolutionBaseUrl,
    evolution_api_key: config.envEvolutionApiKey,
    evolution_instance_name: evolutionInstanceName(userId),
    business_owner_name: user?.business_owner_name ?? "",
    business_offer: user?.business_offer ?? "",
    business_price: user?.business_price ?? "",
  };
}

/** @deprecated Clés gérées par la plateforme (env). */
export async function saveOpenAiKey(_userId: number, _key: string): Promise<void> {
  /* no-op: clé plateforme */
}

/** @deprecated Evolution géré par la plateforme. */
export async function saveEvolutionSettings(_input: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}): Promise<void> {
  /* no-op */
}

export async function saveBusinessProfile(
  userId: number,
  input: {
  ownerName?: string;
  offer?: string;
  price?: string;
}): Promise<void> {
  const { saveUserBusinessProfile } = await import("./users.js");
  await saveUserBusinessProfile(userId, {
    ownerName: input.ownerName,
    offer: input.offer,
    price: input.price,
  });
}

export function maskSecret(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

function mapAgentMessage(row: Record<string, unknown>): AgentMessage {
  return {
    id: Number(row.id),
    role: row.role as AgentRole,
    content: String(row.content),
    created_at: formatTs(row.created_at),
  };
}

export async function saveAgentMessage(userId: number, role: AgentRole, content: string): Promise<AgentMessage> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_conversation (user_id, role, content)
    VALUES (${userId}, ${role}, ${content})
    RETURNING id, role, content, created_at
  `;
  return mapAgentMessage(rows[0]);
}

export async function getRecentAgentMessages(userId: number, limit = 50): Promise<AgentMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, role, content, created_at
    FROM agent_conversation
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentMessage).reverse();
}

export async function getAgentMessagesSince(userId: number, sinceId = 0, limit = 50): Promise<AgentMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, role, content, created_at
    FROM agent_conversation
    WHERE user_id = ${userId} AND id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentMessage);
}

export async function clearAgentConversation(userId: number): Promise<void> {
  await sql`DELETE FROM agent_conversation WHERE user_id = ${userId}`;
}

export interface WhatsAppMessage {
  id: number;
  contact_phone: string;
  sender_name: string | null;
  direction: "entrant" | "sortant";
  body: string;
  green_api_id: string | null;
  created_at: string;
}

function mapWhatsAppMessage(row: Record<string, unknown>): WhatsAppMessage {
  return {
    id: Number(row.id),
    contact_phone: String(row.contact_phone),
    sender_name: row.sender_name != null ? String(row.sender_name) : null,
    direction: row.direction as WhatsAppMessage["direction"],
    body: String(row.body),
    green_api_id: row.green_api_id != null ? String(row.green_api_id) : null,
    created_at: formatTs(row.created_at),
  };
}

export async function saveWhatsAppMessage(userId: number, input: {
  contactPhone: string;
  direction: "entrant" | "sortant";
  body: string;
  greenApiId?: string;
  senderName?: string;
  countsTowardQuota?: boolean;
}): Promise<WhatsAppMessage> {
  const countsTowardQuota =
    input.direction === "sortant" ? (input.countsTowardQuota !== false ? 1 : 0) : 1;
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO messages (user_id, contact_phone, sender_name, direction, body, green_api_id, counts_toward_quota)
    VALUES (
      ${userId},
      ${input.contactPhone},
      ${input.senderName ?? null},
      ${input.direction},
      ${input.body},
      ${input.greenApiId ?? null},
      ${countsTowardQuota}
    )
    RETURNING id, contact_phone, sender_name, direction, body, green_api_id, created_at
  `;
  return mapWhatsAppMessage(rows[0]);
}

export async function whatsAppMessageExists(userId: number, greenApiId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM messages WHERE user_id = ${userId} AND green_api_id = ${greenApiId} LIMIT 1`;
  return rows.length > 0;
}

export async function getIncomingMessagesSince(userId: number, sinceId = 0, limit = 50): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE user_id = ${userId} AND direction = 'entrant' AND id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function getRecentIncomingMessages(userId: number, limit = 30): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE user_id = ${userId} AND direction = 'entrant'
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage).reverse();
}

export async function getWhatsAppMessagesSince(userId: number, sinceId = 0, limit = 50): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE user_id = ${userId} AND id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function listIncomingMessages(
  userId: number,
  options: { contactPhone?: string; todayOnly?: boolean; limit?: number } = {}
): Promise<WhatsAppMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  let rows: Record<string, unknown>[];

  if (options.contactPhone && options.todayOnly) {
    const phone = options.contactPhone.trim();
    const chatId = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@c.us`;
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE user_id = ${userId} AND direction = 'entrant' AND contact_phone = ${chatId} AND created_at::date = CURRENT_DATE
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else if (options.contactPhone) {
    const phone = options.contactPhone.trim();
    const chatId = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@c.us`;
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE user_id = ${userId} AND direction = 'entrant' AND contact_phone = ${chatId}
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else if (options.todayOnly) {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE user_id = ${userId} AND direction = 'entrant' AND created_at::date = CURRENT_DATE
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE user_id = ${userId} AND direction = 'entrant'
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  }

  return rows.map(mapWhatsAppMessage).reverse();
}

export async function getWhatsAppMessageStats(userId: number): Promise<{
  totalIncoming: number;
  totalOutgoing: number;
  incomingToday: number;
  outgoingToday: number;
}> {
  const [totalIncomingRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages WHERE user_id = ${userId} AND direction = 'entrant'
  `;
  const [totalOutgoingRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages WHERE user_id = ${userId} AND direction = 'sortant'
  `;
  const [incomingTodayRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages
    WHERE user_id = ${userId} AND direction = 'entrant' AND created_at::date = CURRENT_DATE
  `;
  const [outgoingTodayRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages
    WHERE user_id = ${userId} AND direction = 'sortant' AND created_at::date = CURRENT_DATE
  `;
  return {
    totalIncoming: Number(totalIncomingRow?.c ?? 0),
    totalOutgoing: Number(totalOutgoingRow?.c ?? 0),
    incomingToday: Number(incomingTodayRow?.c ?? 0),
    outgoingToday: Number(outgoingTodayRow?.c ?? 0),
  };
}

export async function listAllIncomingMessages(userId: number, limit = 100): Promise<WhatsAppMessage[]> {
  const safe = Math.min(Math.max(limit, 1), 500);
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE user_id = ${userId} AND direction = 'entrant'
    ORDER BY id DESC
    LIMIT ${safe}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function getContactChatHistory(userId: number, chatId: string, limit = 12): Promise<WhatsAppMessage[]> {
  const digits = chatId.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE user_id = ${userId} AND (contact_phone = ${chatId}
       OR (${digits} != '' AND (
         contact_phone = ${digits} || '@c.us'
         OR contact_phone = ${digits} || '@lid'
         OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
       )))
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage).reverse();
}

export async function isAutoReplyEnabled(userId: number): Promise<boolean> {
  const v = await getSetting(userId, "whatsapp_auto_reply");
  return v !== "0";
}

export async function setAutoReplyEnabled(userId: number, enabled: boolean): Promise<void> {
  await setSetting(userId, "whatsapp_auto_reply", enabled ? "1" : "0");
}

export interface Contact {
  id: number;
  phone: string;
  name: string | null;
  notes: string | null;
  status: ContactStatus;
  auto_reply: number;
  lead_score: number;
  memory_summary: string | null;
  memory_updated_at: string | null;
  handoff_status: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeContactPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.endsWith("@g.us")) {
    throw new Error("Les groupes WhatsApp ne peuvent pas être enregistrés comme contacts de prospection.");
  }
  if (trimmed.endsWith("@lid")) return trimmed;
  if (trimmed.endsWith("@c.us")) {
    const digits = trimmed.replace(/@c\.us/gi, "").replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 13) return trimmed;
    if (digits.length >= 8) return `${digits}@lid`;
    return trimmed;
  }
  if (trimmed.endsWith("@s.whatsapp.net")) {
    const digits = trimmed.replace(/@s\.whatsapp\.net/gi, "").replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
    if (digits.length >= 8) return `${digits}@lid`;
  }
  if (trimmed.includes("@")) {
    const digits = trimmed.replace(/@\w+/g, "").replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
    if (digits.length >= 8) return `${digits}@lid`;
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) throw new Error("Numéro de téléphone invalide.");
  return `${digits}@c.us`;
}

function mapContact(row: Record<string, unknown>): Contact {
  return {
    id: Number(row.id),
    phone: String(row.phone),
    name: row.name != null ? String(row.name) : null,
    notes: row.notes != null ? String(row.notes) : null,
    status: row.status as ContactStatus,
    auto_reply: Number(row.auto_reply),
    lead_score: Number(row.lead_score ?? 0),
    memory_summary: row.memory_summary != null ? String(row.memory_summary) : null,
    memory_updated_at: formatTsNullable(row.memory_updated_at),
    handoff_status: row.handoff_status != null ? String(row.handoff_status) : null,
    created_at: formatTs(row.created_at),
    updated_at: formatTs(row.updated_at),
  };
}

async function lookupContactRow(userId: number, chatId: string): Promise<Contact | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, phone, name, notes, status, auto_reply,
           COALESCE(lead_score, 0) as lead_score,
           memory_summary, memory_updated_at, handoff_status,
           created_at, updated_at
    FROM contacts WHERE user_id = ${userId} AND (phone = ${chatId} OR whatsapp_lid = ${chatId})
  `;
  return rows[0] ? mapContact(rows[0]) : null;
}

async function findContactForChat(userId: number, chatId: string): Promise<Contact | null> {
  const trimmed = chatId.trim();
  try {
    const normalized = normalizeContactPhone(trimmed);
    const direct = await lookupContactRow(userId, normalized);
    if (direct) return direct;
  } catch {
    /* try digit fallback */
  }
  const digits = trimmed.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return lookupContactRow(userId, `${digits}@c.us`);
}

export async function getContact(userId: number, phone: string): Promise<Contact | null> {
  const trimmed = phone.trim();
  if (trimmed.endsWith("@g.us")) return null;
  return findContactForChat(userId, trimmed);
}

export async function listContacts(
  userId: number,
  options: { status?: ContactStatus; limit?: number } = {}
): Promise<Contact[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const rows = options.status
    ? await sql<Record<string, unknown>[]>`
        SELECT id, phone, name, notes, status, auto_reply,
          COALESCE(lead_score, 0) as lead_score, memory_summary, memory_updated_at, handoff_status,
          created_at, updated_at
        FROM contacts
        WHERE user_id = ${userId} AND status = ${options.status}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, phone, name, notes, status, auto_reply,
          COALESCE(lead_score, 0) as lead_score, memory_summary, memory_updated_at, handoff_status,
          created_at, updated_at
        FROM contacts
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
  return rows.map(mapContact);
}

export async function updateContactLeadScore(userId: number, phone: string, score: number): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  await sql`
    UPDATE contacts SET lead_score = ${clamped}, updated_at = NOW() WHERE user_id = ${userId} AND phone = ${chatId}
  `;
  if (clamped >= 70) {
    await sql`
      UPDATE contacts SET status = 'interesse', updated_at = NOW()
      WHERE user_id = ${userId} AND phone = ${chatId} AND status != 'stop'
    `;
  }
}

export async function updateContactMemory(userId: number, phone: string, summary: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contacts SET memory_summary = ${summary.trim()}, memory_updated_at = NOW(),
      updated_at = NOW() WHERE user_id = ${userId} AND phone = ${chatId}
  `;
}

export async function setContactHandoff(userId: number, phone: string, status: string | null): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contacts SET handoff_status = ${status}, updated_at = NOW() WHERE user_id = ${userId} AND phone = ${chatId}
  `;
}

export async function saveContact(userId: number, input: {
  phone: string;
  name?: string | null;
  notes?: string | null;
  status?: ContactStatus;
  autoReply?: boolean;
}): Promise<Contact> {
  const chatId = normalizeContactPhone(input.phone);
  if (input.status && !CONTACT_STATUSES.includes(input.status)) {
    throw new Error(`Statut invalide. Attendu : ${CONTACT_STATUSES.join(", ")}`);
  }

  await upsertContactInternal(userId, {
    phone: chatId,
    name: input.name,
    notes: input.notes,
    status: input.status,
    autoReply: input.autoReply,
  });

  const contact = await getContact(userId, chatId);
  if (!contact) throw new Error("Impossible d'enregistrer le contact.");
  return contact;
}

export async function touchIncomingContact(userId: number, chatId: string, senderName?: string): Promise<Contact> {
  const existing = await getContact(userId, chatId);
  if (!existing) {
    return saveContact(userId, {
      phone: chatId,
      name: senderName || null,
      status: "en_conversation",
      autoReply: false,
    });
  }

  const updates: {
    phone: string;
    name?: string | null;
    status?: ContactStatus;
  } = { phone: chatId };

  if (senderName && !existing.name) updates.name = senderName;
  if (existing.status === "nouveau") updates.status = "en_conversation";

  return saveContact(userId, updates);
}

export async function setContactAutoReply(userId: number, phone: string, enabled: boolean): Promise<Contact> {
  return saveContact(userId, { phone, autoReply: enabled });
}

export async function blockContact(userId: number, chatId: string): Promise<Contact> {
  return saveContact(userId, { phone: chatId, status: "stop", autoReply: false });
}

export async function unblockContact(userId: number, chatId: string): Promise<Contact> {
  const existing = await getContact(userId, chatId);
  const nextStatus: ContactStatus =
    existing && existing.status === "stop" ? "en_conversation" : existing?.status ?? "en_conversation";
  return saveContact(userId, { phone: chatId, status: nextStatus });
}

export async function isContactBlocked(userId: number, chatId: string): Promise<boolean> {
  const contact = await findContactForChat(userId, chatId);
  if (contact) return contact.status === "stop";
  try {
    const list = JSON.parse((await getSetting(userId, "blocked_contacts")) || "[]") as string[];
    return list.includes(chatId);
  } catch {
    return false;
  }
}

export async function shouldAutoReplyContact(userId: number, chatId: string): Promise<boolean> {
  if (!(await isAutoReplyEnabled(userId))) return false;
  if (await isContactBlocked(userId, chatId)) return false;
  const contact = await findContactForChat(userId, chatId);
  if (!contact) return false;
  return contact.auto_reply === 1;
}

export async function setContactWhatsappLid(userId: number, phone: string, lid: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  const lidNorm = lid.includes("@") ? lid.trim() : `${lid.replace(/\D/g, "")}@lid`;
  await sql`
    UPDATE contacts SET whatsapp_lid = ${lidNorm}, updated_at = NOW() WHERE user_id = ${userId} AND phone = ${chatId}
  `;
}

export async function findProspectPhoneForLidReply(
  userId: number,
  lidOrPseudo: string,
  senderName?: string
): Promise<string | null> {
  const lidDigits = lidOrPseudo.replace(/@c\.us|@lid|@s\.whatsapp\.net/gi, "").replace(/\D/g, "");
  const lid = lidOrPseudo.includes("@") ? lidOrPseudo.trim() : `${lidDigits}@lid`;

  const mapped = await sql<{ phone: string }[]>`
    SELECT phone FROM contacts
    WHERE user_id = ${userId} AND (whatsapp_lid = ${lid} OR whatsapp_lid = ${`${lidDigits}@lid`})
    LIMIT 1
  `;
  if (mapped[0]?.phone) return mapped[0].phone;

  if (senderName?.trim()) {
    const byName = await sql<{ phone: string }[]>`
      SELECT phone FROM contacts
      WHERE user_id = ${userId} AND auto_reply = 1 AND status != 'stop' AND name = ${senderName.trim()}
      LIMIT 2
    `;
    if (byName.length === 1) return byName[0].phone;
  }

  const recentOut = await sql<{ phone: string }[]>`
    SELECT m.contact_phone as phone
    FROM messages m
    JOIN contacts c ON c.user_id = m.user_id AND c.phone = m.contact_phone AND c.auto_reply = 1 AND c.status != 'stop'
    WHERE m.user_id = ${userId}
      AND m.direction = 'sortant'
      AND m.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY m.created_at DESC
    LIMIT 2
  `;
  if (recentOut.length === 1) return recentOut[0].phone;

  return null;
}

export async function findUnansweredInboundMessages(userId: number, limit = 30): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT m.id, m.contact_phone, m.sender_name, m.direction, m.body, m.green_api_id, m.created_at
    FROM messages m
    WHERE m.user_id = ${userId}
      AND m.direction = 'entrant'
      AND m.created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY m.id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function hasOutboundReplyAfter(
  userId: number,
  inboundId: number,
  ...phones: string[]
): Promise<boolean> {
  const ids = phones.filter(Boolean);
  if (ids.length === 0) return false;
  const rows = await sql`
    SELECT 1 FROM messages
    WHERE user_id = ${userId} AND direction = 'sortant' AND id > ${inboundId} AND contact_phone IN ${sql(ids)}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getDailyOutboundLimit(userId: number): Promise<number> {
  const raw = await getSetting(userId, "daily_outbound_limit");
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 5) return Math.min(Math.floor(n), 500);
  return DAILY_OUTBOUND_LIMIT;
}

function outboundQuotaBonusKey(): string {
  return `outbound_quota_bonus_${formatLocalDateTime(new Date()).slice(0, 10)}`;
}

export async function getOutboundQuotaBonus(userId: number): Promise<number> {
  const n = Number((await getSetting(userId, outboundQuotaBonusKey())) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function getEffectiveOutboundLimit(userId: number): Promise<number> {
  return (await getDailyOutboundLimit(userId)) + (await getOutboundQuotaBonus(userId));
}

export async function setDailyOutboundLimit(userId: number, limit: number): Promise<number> {
  const safe = Math.min(Math.max(Math.floor(limit), 5), 500);
  await setSetting(userId, "daily_outbound_limit", String(safe));
  return safe;
}

export async function resetOutboundQuotaForToday(userId: number, extra = 15): Promise<{
  sent: number;
  limit: number;
  bonus: number;
  effectiveLimit: number;
}> {
  const sent = await countOutboundToday(userId);
  const limit = await getDailyOutboundLimit(userId);
  const needed = Math.max(0, sent - limit);
  const bonus = needed + extra;
  await setSetting(userId, outboundQuotaBonusKey(), String(bonus));
  return { sent, limit, bonus, effectiveLimit: limit + bonus };
}

export async function countOutboundToday(userId: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int as n FROM messages
    WHERE user_id = ${userId}
      AND direction = 'sortant'
      AND COALESCE(counts_toward_quota, 1) = 1
      AND created_at::date = CURRENT_DATE
  `;
  return Number(row?.n ?? 0);
}

export async function canSendOutbound(userId: number): Promise<
  { ok: true } | { ok: false; reason: string; sent: number; limit: number }
> {
  const sent = await countOutboundToday(userId);
  const limit = (await getDailyOutboundLimit(userId)) + (await getOutboundQuotaBonus(userId));
  if (sent >= limit) {
    return {
      ok: false,
      reason: `Limite journalière atteinte (${sent}/${limit} messages sortants comptabilisés). Réinitialisez le quota dans la barre latérale ou réessayez demain.`,
      sent,
      limit,
    };
  }
  return { ok: true };
}

export async function assertCanSendTo(userId: number, chatId: string): Promise<void> {
  if (!chatId.endsWith("@g.us") && (await isContactBlocked(userId, chatId))) {
    throw new Error(
      `Contact ${chatId} est en statut STOP. Aucun envoi possible. Débloquez-le d'abord si vraiment nécessaire.`
    );
  }
  const check = await canSendOutbound(userId);
  if (!check.ok) throw new Error(check.reason);
}

export type ScheduledStatus = "pending" | "sent" | "failed" | "cancelled";

export interface ScheduledMessage {
  id: number;
  recipient: string;
  recipient_label: string | null;
  message: string;
  send_at: string;
  status: ScheduledStatus;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export function resolveLocalSendAt(input: {
  delayMinutes?: number;
  sendAtLocal?: string;
}): string {
  const now = new Date();

  if (input.delayMinutes !== undefined && input.delayMinutes !== null) {
    const mins = Number(input.delayMinutes);
    if (!Number.isFinite(mins) || mins < 0) {
      throw new Error("delay_minutes doit être un nombre ≥ 0.");
    }
    if (mins > 60 * 24 * 30) {
      throw new Error("Délai trop long (max 30 jours).");
    }
    const target = new Date(now.getTime() + mins * 60_000);
    return formatLocalDateTime(target);
  }

  const raw = (input.sendAtLocal ?? "").trim();
  if (!raw) {
    throw new Error("Indiquez delay_minutes OU send_at_local (ex. 06:30).");
  }

  const match = raw.match(/^(\d{1,2})[:hH](\d{2})$/);
  if (!match) {
    throw new Error(`Heure invalide « ${raw} ». Format attendu : 06:30 ou 6h30.`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Heure invalide « ${raw} ».`);
  }

  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime() + 15_000) {
    target.setDate(target.getDate() + 1);
  }

  return formatLocalDateTime(target);
}

function mapScheduledMessage(row: Record<string, unknown>): ScheduledMessage {
  return {
    id: Number(row.id),
    recipient: String(row.recipient),
    recipient_label: row.recipient_label != null ? String(row.recipient_label) : null,
    message: String(row.message),
    send_at: formatTs(row.send_at),
    status: row.status as ScheduledStatus,
    error: row.error != null ? String(row.error) : null,
    created_at: formatTs(row.created_at),
    sent_at: formatTsNullable(row.sent_at),
  };
}

export async function scheduleMessage(userId: number, input: {
  recipient: string;
  recipientLabel?: string;
  message: string;
  sendAt: string;
}): Promise<ScheduledMessage> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO scheduled_messages (user_id, recipient, recipient_label, message, send_at)
    VALUES (
      ${userId},
      ${input.recipient},
      ${input.recipientLabel ?? null},
      ${input.message},
      ${toTsParam(input.sendAt)}
    )
    RETURNING id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
  `;
  return mapScheduledMessage(rows[0]);
}

export async function listScheduledMessages(
  userId: number,
  options: { includeDone?: boolean; limit?: number } = {}
): Promise<ScheduledMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = options.includeDone
    ? await sql<Record<string, unknown>[]>`
        SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
        FROM scheduled_messages
        WHERE user_id = ${userId}
        ORDER BY send_at DESC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
        FROM scheduled_messages
        WHERE user_id = ${userId} AND status = 'pending'
        ORDER BY send_at ASC
        LIMIT ${limit}
      `;
  return rows.map(mapScheduledMessage);
}

export async function getDueScheduledMessages(userId: number, limit = 10): Promise<ScheduledMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
    FROM scheduled_messages
    WHERE user_id = ${userId} AND status = 'pending' AND send_at <= NOW()
    ORDER BY send_at ASC
    LIMIT ${limit}
  `;
  return rows.map(mapScheduledMessage);
}

export async function cancelScheduledMessage(userId: number, id: number): Promise<ScheduledMessage | null> {
  const existing = await sql<Record<string, unknown>[]>`
    SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
    FROM scheduled_messages WHERE user_id = ${userId} AND id = ${id}
  `;
  const row = existing[0];
  if (!row) return null;
  const mapped = mapScheduledMessage(row);
  if (mapped.status !== "pending") {
    throw new Error(`Impossible d'annuler : statut actuel = ${mapped.status}.`);
  }

  await sql`UPDATE scheduled_messages SET status = 'cancelled' WHERE user_id = ${userId} AND id = ${id}`;

  const updated = await sql<Record<string, unknown>[]>`
    SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
    FROM scheduled_messages WHERE user_id = ${userId} AND id = ${id}
  `;
  return mapScheduledMessage(updated[0]);
}

export async function markScheduledSent(userId: number, id: number): Promise<void> {
  await sql`
    UPDATE scheduled_messages
    SET status = 'sent', sent_at = NOW(), error = NULL
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function markScheduledFailed(userId: number, id: number, error: string): Promise<void> {
  await sql`
    UPDATE scheduled_messages
    SET status = 'failed', error = ${error.slice(0, 500)}, sent_at = NOW()
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function getContactThread(userId: number, phone: string, limit = 100): Promise<WhatsAppMessage[]> {
  const trimmed = phone.trim();
  const chatId = trimmed.includes("@") ? trimmed : `${trimmed.replace(/\D/g, "")}@c.us`;
  return getContactChatHistory(userId, chatId, limit);
}

export interface DailyBilan {
  date: string;
  incoming: number;
  outgoing: number;
  uniqueContacts: number;
  contactsByStatus: Record<string, number>;
  scheduledPending: number;
  scheduledSentToday: number;
  topConversations: Array<{
    phone: string;
    name: string | null;
    messageCount: number;
    lastMessage: string;
    lastAt: string;
  }>;
}

export async function getDailyBilan(userId: number, date?: string): Promise<DailyBilan> {
  const day =
    date?.trim() ||
    formatLocalDateTime(new Date()).slice(0, 10);

  const [counts] = await sql<
    Array<{ incoming: number | null; outgoing: number | null; uniqueContacts: number | null }>
  >`
    SELECT
      SUM(CASE WHEN direction = 'entrant' THEN 1 ELSE 0 END)::int as incoming,
      SUM(CASE WHEN direction = 'sortant' THEN 1 ELSE 0 END)::int as outgoing,
      COUNT(DISTINCT contact_phone)::int as uniqueContacts
    FROM messages
    WHERE user_id = ${userId} AND created_at::date = ${day}::date
  `;

  const statusRows = await sql<Array<{ status: string; n: number }>>`
    SELECT status, COUNT(*)::int as n FROM contacts WHERE user_id = ${userId} GROUP BY status
  `;

  const contactsByStatus: Record<string, number> = {
    nouveau: 0,
    en_conversation: 0,
    interesse: 0,
    stop: 0,
  };
  for (const row of statusRows) {
    contactsByStatus[row.status] = Number(row.n);
  }

  const [scheduledPendingRow] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int as n FROM scheduled_messages WHERE user_id = ${userId} AND status = 'pending'
  `;

  const [scheduledSentTodayRow] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int as n FROM scheduled_messages
    WHERE user_id = ${userId} AND status = 'sent' AND COALESCE(sent_at, send_at)::date = ${day}::date
  `;

  const topRows = await sql<
    Array<{
      phone: string;
      name: string | null;
      messageCount: number;
      lastMessage: string;
      lastAt: Date | string;
    }>
  >`
    SELECT m.contact_phone as phone,
           (SELECT name FROM contacts c WHERE c.user_id = ${userId} AND c.phone = m.contact_phone) as name,
           COUNT(*)::int as "messageCount",
           (SELECT body FROM messages m2
              WHERE m2.user_id = ${userId} AND m2.contact_phone = m.contact_phone
              ORDER BY m2.id DESC LIMIT 1) as "lastMessage",
           MAX(m.created_at) as "lastAt"
    FROM messages m
    WHERE m.user_id = ${userId} AND m.created_at::date = ${day}::date
    GROUP BY m.contact_phone
    ORDER BY "messageCount" DESC
    LIMIT 15
  `;

  return {
    date: day,
    incoming: Number(counts?.incoming ?? 0),
    outgoing: Number(counts?.outgoing ?? 0),
    uniqueContacts: Number(counts?.uniqueContacts ?? 0),
    contactsByStatus,
    scheduledPending: Number(scheduledPendingRow?.n ?? 0),
    scheduledSentToday: Number(scheduledSentTodayRow?.n ?? 0),
    topConversations: topRows.map((r) => ({
      phone: r.phone,
      name: r.name,
      messageCount: Number(r.messageCount),
      lastMessage: r.lastMessage,
      lastAt: formatTs(r.lastAt),
    })),
  };
}

export const AUTOMATION_TYPES = [
  "group_prospect",
  "contact_prospect",
  "keyword_sales",
  "custom_followup",
] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];
export const AUTOMATION_STATUSES = ["draft", "active", "paused", "completed", "failed"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];
export const TARGET_STATUSES = ["pending", "contacted", "replied", "interested", "stopped", "error"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export interface AutomationConfig {
  mode?: "outbound_prospect" | "inbound_closing";
  origin?: string;
  groupId?: string;
  groupName?: string;
  contactTargets?: Array<{ id: string; label?: string }>;
  initialMessage?: string;
  maxMembers?: number;
  maxPerDay?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  enableAutoReply?: boolean;
  conversationGuide?: string;
  keywords?: string[];
  triggerPhrases?: string[];
  productName?: string;
  price?: string;
  salesScript?: string;
  followUpInstructions?: string;
  closingGoal?: "payment" | "delivery" | "link" | "appointment";
  /** Lien concret (Calendly, paiement, landing…) — jamais de placeholder. */
  closingLink?: string;
  relance?: { enabled: boolean; delaysDays: number[]; hour?: number; messages?: string[] };
  stopOnDissatisfaction?: boolean;
  stopOnUnknownQuestion?: boolean;
  personalizeMessages?: boolean;
  abVariants?: Array<{ id: string; message: string }>;
  sequenceSteps?: Array<{ delayDays: number; message: string; condition?: string }>;
  mediaUrl?: string;
  mediaType?: "image" | "document" | "audio";
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

export interface AutomationStats {
  contacted?: number;
  pending?: number;
  replied?: number;
  interested?: number;
  stopped?: number;
  errors?: number;
  messagesHandled?: number;
  outboundUsed?: number;
  lastActionAt?: string;
  lastReportDate?: string;
  report?: string;
  conversions?: number;
  revenueFcfa?: number;
  autoStopped?: number;
  abResults?: Record<string, { sent: number; replied: number; interested: number }>;
  openAiCostEstimateFcfa?: number;
}

export interface Automation {
  id: number;
  name: string;
  type: AutomationType;
  status: AutomationStatus;
  config: AutomationConfig;
  stats: AutomationStats;
  summary: string | null;
  budget_fcfa: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationTarget {
  id: number;
  automation_id: number;
  target_id: string;
  target_label: string | null;
  status: TargetStatus;
  last_action_at: string | null;
  notes: string | null;
  ab_variant: string | null;
  created_at: string;
}

export interface AutomationLog {
  id: number;
  automation_id: number;
  level: "info" | "success" | "warning" | "error";
  message: string;
  created_at: string;
}

function parseAutomationRow(row: {
  id: number;
  name: string;
  type: string;
  status: string;
  config_json: string;
  stats_json: string;
  summary: string | null;
  budget_fcfa: number;
  created_at: unknown;
  updated_at: unknown;
}): Automation {
  let config: AutomationConfig = {};
  let stats: AutomationStats = {};
  try {
    config = JSON.parse(row.config_json || "{}") as AutomationConfig;
  } catch {
    /* ignore */
  }
  try {
    stats = JSON.parse(row.stats_json || "{}") as AutomationStats;
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type as AutomationType,
    status: row.status as AutomationStatus,
    config,
    stats,
    summary: row.summary,
    budget_fcfa: row.budget_fcfa,
    created_at: formatTs(row.created_at),
    updated_at: formatTs(row.updated_at),
  };
}

function mapAutomationTarget(row: Record<string, unknown>): AutomationTarget {
  return {
    id: Number(row.id),
    automation_id: Number(row.automation_id),
    target_id: String(row.target_id),
    target_label: row.target_label != null ? String(row.target_label) : null,
    status: row.status as TargetStatus,
    last_action_at: formatTsNullable(row.last_action_at),
    notes: row.notes != null ? String(row.notes) : null,
    ab_variant: row.ab_variant != null ? String(row.ab_variant) : null,
    created_at: formatTs(row.created_at),
  };
}

function mapAutomationLog(row: Record<string, unknown>): AutomationLog {
  return {
    id: Number(row.id),
    automation_id: Number(row.automation_id),
    level: row.level as AutomationLog["level"],
    message: String(row.message),
    created_at: formatTs(row.created_at),
  };
}

async function recomputeAutomationStats(userId: number, automationId: number): Promise<AutomationStats> {
  const rows = await sql<Array<{ status: string; n: number }>>`
    SELECT status, COUNT(*)::int as n FROM automation_targets
    WHERE user_id = ${userId} AND automation_id = ${automationId} GROUP BY status
  `;

  const stats: AutomationStats = {
    pending: 0,
    contacted: 0,
    replied: 0,
    interested: 0,
    stopped: 0,
    errors: 0,
  };

  for (const row of rows) {
    const n = Number(row.n);
    if (row.status === "pending") stats.pending = n;
    else if (row.status === "contacted") stats.contacted = n;
    else if (row.status === "replied") stats.replied = n;
    else if (row.status === "interested") stats.interested = n;
    else if (row.status === "stopped") stats.stopped = n;
    else if (row.status === "error") stats.errors = n;
  }

  const auto = await getAutomation(userId, automationId);
  if (auto) {
    stats.messagesHandled = auto.stats.messagesHandled ?? 0;
    stats.outboundUsed = auto.stats.outboundUsed ?? 0;
    stats.report = auto.stats.report;
    stats.lastActionAt = auto.stats.lastActionAt;
    stats.autoStopped = auto.stats.autoStopped;
    stats.lastReportDate = auto.stats.lastReportDate;
    stats.conversions = auto.stats.conversions;
    stats.revenueFcfa = auto.stats.revenueFcfa;
  }

  await sql`
    UPDATE automations SET stats_json = ${JSON.stringify(stats)}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${automationId}
  `;

  return stats;
}

export async function createAutomation(userId: number, input: {
  name: string;
  type: AutomationType;
  config: AutomationConfig;
  summary?: string;
  budgetFcfa?: number;
  status?: AutomationStatus;
}): Promise<Automation> {
  const rows = await sql<
    Array<Parameters<typeof parseAutomationRow>[0]>
  >`
    INSERT INTO automations (user_id, name, type, status, config_json, stats_json, summary, budget_fcfa)
    VALUES (
      ${userId},
      ${input.name.trim()},
      ${input.type},
      ${input.status ?? "active"},
      ${JSON.stringify(input.config)},
      '{}',
      ${input.summary?.trim() || null},
      ${input.budgetFcfa ?? 0}
    )
    RETURNING id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
  `;

  const id = rows[0].id;
  await addAutomationLog(userId, id, "info", `Automatisation créée : ${input.name}`);
  return (await getAutomation(userId, id))!;
}

export async function getAutomation(userId: number, id: number): Promise<Automation | null> {
  const rows = await sql<Array<Parameters<typeof parseAutomationRow>[0]>>`
    SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
    FROM automations WHERE user_id = ${userId} AND id = ${id}
  `;
  return rows[0] ? parseAutomationRow(rows[0]) : null;
}

export async function listAutomations(
  userId: number,
  options: { status?: AutomationStatus; limit?: number } = {}
): Promise<Automation[]> {
  const limit = options.limit ?? 100;
  const rows = options.status
    ? await sql<Array<Parameters<typeof parseAutomationRow>[0]>>`
        SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
        FROM automations
        WHERE user_id = ${userId} AND status = ${options.status}
        ORDER BY id DESC
        LIMIT ${limit}
      `
    : await sql<Array<Parameters<typeof parseAutomationRow>[0]>>`
        SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
        FROM automations
        WHERE user_id = ${userId}
        ORDER BY id DESC
        LIMIT ${limit}
      `;
  return rows.map(parseAutomationRow);
}

export async function listActiveAutomations(userId: number): Promise<Automation[]> {
  return listAutomations(userId, { status: "active", limit: 50 });
}

export async function updateAutomationStatus(
  userId: number,
  id: number,
  status: AutomationStatus
): Promise<Automation | null> {
  await sql`UPDATE automations SET status = ${status}, updated_at = NOW() WHERE user_id = ${userId} AND id = ${id}`;
  await addAutomationLog(userId, id, "info", `Statut → ${status}`);
  return getAutomation(userId, id);
}

export async function updateAutomationStats(
  userId: number,
  id: number,
  patch: Partial<AutomationStats>
): Promise<Automation | null> {
  const auto = await getAutomation(userId, id);
  if (!auto) return null;
  const stats = { ...auto.stats, ...patch };
  await sql`
    UPDATE automations SET stats_json = ${JSON.stringify(stats)}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${id}
  `;
  return getAutomation(userId, id);
}

export async function addAutomationTargets(
  userId: number,
  automationId: number,
  targets: Array<{ targetId: string; targetLabel?: string }>
): Promise<number> {
  let added = 0;
  for (const t of targets) {
    const result = await sql`
      INSERT INTO automation_targets (user_id, automation_id, target_id, target_label)
      VALUES (${userId}, ${automationId}, ${t.targetId}, ${t.targetLabel ?? null})
      ON CONFLICT (automation_id, target_id) DO NOTHING
    `;
    if (result.count > 0) added++;
  }
  await recomputeAutomationStats(userId, automationId);
  return added;
}

export async function listAutomationTargets(
  userId: number,
  automationId: number,
  options: { status?: TargetStatus; limit?: number } = {}
): Promise<AutomationTarget[]> {
  const limit = options.limit ?? 500;
  const rows = options.status
    ? await sql<Record<string, unknown>[]>`
        SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
        FROM automation_targets
        WHERE user_id = ${userId} AND automation_id = ${automationId} AND status = ${options.status}
        ORDER BY id ASC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
        FROM automation_targets
        WHERE user_id = ${userId} AND automation_id = ${automationId}
        ORDER BY id ASC
        LIMIT ${limit}
      `;
  return rows.map(mapAutomationTarget);
}

export async function updateAutomationTarget(
  userId: number,
  automationId: number,
  targetId: string,
  patch: { status?: TargetStatus; notes?: string }
): Promise<void> {
  if (patch.status && patch.notes !== undefined) {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW(), status = ${patch.status}, notes = ${patch.notes}
      WHERE user_id = ${userId} AND automation_id = ${automationId} AND target_id = ${targetId}
    `;
  } else if (patch.status) {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW(), status = ${patch.status}
      WHERE user_id = ${userId} AND automation_id = ${automationId} AND target_id = ${targetId}
    `;
  } else if (patch.notes !== undefined) {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW(), notes = ${patch.notes}
      WHERE user_id = ${userId} AND automation_id = ${automationId} AND target_id = ${targetId}
    `;
  } else {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW()
      WHERE user_id = ${userId} AND automation_id = ${automationId} AND target_id = ${targetId}
    `;
  }
  await recomputeAutomationStats(userId, automationId);
}

export async function getNextPendingTarget(userId: number, automationId: number): Promise<AutomationTarget | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
    FROM automation_targets
    WHERE user_id = ${userId} AND automation_id = ${automationId} AND status = 'pending'
    ORDER BY id ASC LIMIT 1
  `;
  return rows[0] ? mapAutomationTarget(rows[0]) : null;
}

export async function addAutomationLog(
  userId: number,
  automationId: number,
  level: AutomationLog["level"],
  message: string
): Promise<AutomationLog> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO automation_logs (user_id, automation_id, level, message)
    VALUES (${userId}, ${automationId}, ${level}, ${message})
    RETURNING id, automation_id, level, message, created_at
  `;
  return mapAutomationLog(rows[0]);
}

export async function listAutomationLogs(
  userId: number,
  automationId: number,
  limit = 50
): Promise<AutomationLog[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, automation_id, level, message, created_at
    FROM automation_logs WHERE user_id = ${userId} AND automation_id = ${automationId}
    ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map(mapAutomationLog);
}

export async function getAutomationDetail(userId: number, id: number): Promise<{
  automation: Automation;
  targets: AutomationTarget[];
  logs: AutomationLog[];
} | null> {
  const automation = await getAutomation(userId, id);
  if (!automation) return null;
  const targets = await listAutomationTargets(userId, id);
  const logs = await listAutomationLogs(userId, id, 30);
  const stats = await recomputeAutomationStats(userId, id);
  automation.stats = stats;
  return { automation, targets, logs };
}

export async function updateAutomationConfig(
  userId: number,
  id: number,
  config: AutomationConfig
): Promise<Automation | null> {
  await sql`
    UPDATE automations SET config_json = ${JSON.stringify(config)}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${id}
  `;
  return getAutomation(userId, id);
}

export async function findMatchingKeywordAutomations(userId: number, text: string): Promise<Automation[]> {
  const active = (await listActiveAutomations(userId)).filter(
    (a) => a.type === "keyword_sales" || a.config.mode === "inbound_closing"
  );
  return active.filter((a) => {
    const phrases = a.config.triggerPhrases ?? a.config.keywords ?? [];
    return matchesAnyTriggerPhrase(text, phrases);
  });
}

/** Calcule la prochaine date d'exécution d'une relance (jours + heure locale APP_TIMEZONE). */
export function computeSequenceNextAt(delayDays: number, sendHour?: number): Date {
  const now = new Date();
  const nextAt = new Date(now);
  nextAt.setDate(nextAt.getDate() + delayDays);
  if (typeof sendHour === "number" && sendHour >= 0 && sendHour <= 23) {
    nextAt.setHours(sendHour, 0, 0, 0);
    // Si l'heure cible est déjà passée aujourd'hui, décaler au lendemain.
    if (nextAt <= now) {
      nextAt.setDate(nextAt.getDate() + 1);
    }
  }
  return nextAt;
}

export async function getRelanceHourForAutomation(
  userId: number,
  automationId: number | null | undefined
): Promise<number | undefined> {
  if (!automationId) return undefined;
  const auto = await getAutomation(userId, automationId);
  return auto?.config.relance?.hour;
}

export async function incrementAutoStopped(userId: number, automationId: number): Promise<void> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return;
  await updateAutomationStats(userId, automationId, {
    autoStopped: (auto.stats.autoStopped ?? 0) + 1,
    lastActionAt: new Date().toISOString(),
  });
}

/** Incrémente le compteur « messages traités » d'une campagne (réponse IA à un prospect). */
export async function incrementMessagesHandled(userId: number, automationId: number): Promise<void> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return;
  await updateAutomationStats(userId, automationId, {
    messagesHandled: (auto.stats.messagesHandled ?? 0) + 1,
    lastActionAt: new Date().toISOString(),
  });
}

export async function deleteAutomation(userId: number, id: number): Promise<boolean> {
  const auto = await getAutomation(userId, id);
  if (!auto) return false;
  await sql`DELETE FROM automation_logs WHERE user_id = ${userId} AND automation_id = ${id}`;
  await sql`DELETE FROM automation_targets WHERE user_id = ${userId} AND automation_id = ${id}`;
  await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
    WHERE user_id = ${userId} AND automation_id = ${id} AND status = 'active'
  `;
  await sql`
    DELETE FROM send_queue
    WHERE user_id = ${userId} AND automation_id = ${id} AND status = 'pending'
  `;
  await sql`DELETE FROM automations WHERE user_id = ${userId} AND id = ${id}`;
  return true;
}

export async function listProspectedContacts(
  userId: number,
  options: { automationId?: number; limit?: number } = {}
): Promise<
  Array<{
    automationId: number;
    automationName: string;
    targetId: string;
    targetLabel: string | null;
    status: TargetStatus;
    lastActionAt: string | null;
  }>
> {
  const limit = options.limit ?? 200;
  const autos = options.automationId
    ? [await getAutomation(userId, options.automationId)].filter(Boolean) as Automation[]
    : await listAutomations(userId, { limit: 50 });

  const out: Array<{
    automationId: number;
    automationName: string;
    targetId: string;
    targetLabel: string | null;
    status: TargetStatus;
    lastActionAt: string | null;
  }> = [];

  for (const auto of autos) {
    if (!auto || auto.type !== "group_prospect") continue;
    const targets = await listAutomationTargets(userId, auto.id, { limit });
    for (const t of targets) {
      if (t.status === "pending") continue;
      out.push({
        automationId: auto.id,
        automationName: auto.name,
        targetId: t.target_id,
        targetLabel: t.target_label,
        status: t.status,
        lastActionAt: t.last_action_at,
      });
    }
  }
  return out;
}

export interface QueueItem {
  id: number;
  recipient: string;
  recipient_label: string | null;
  message: string | null;
  media_url: string | null;
  media_type: string | null;
  priority: number;
  send_at: string;
  status: string;
  automation_id: number | null;
  sequence_id: number | null;
  ab_variant: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

function mapQueueItem(row: Record<string, unknown>): QueueItem {
  return {
    id: Number(row.id),
    recipient: String(row.recipient),
    recipient_label: row.recipient_label != null ? String(row.recipient_label) : null,
    message: row.message != null ? String(row.message) : null,
    media_url: row.media_url != null ? String(row.media_url) : null,
    media_type: row.media_type != null ? String(row.media_type) : null,
    priority: Number(row.priority),
    send_at: formatTs(row.send_at),
    status: String(row.status),
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
    sequence_id: row.sequence_id != null ? Number(row.sequence_id) : null,
    ab_variant: row.ab_variant != null ? String(row.ab_variant) : null,
    error: row.error != null ? String(row.error) : null,
    created_at: formatTs(row.created_at),
    sent_at: formatTsNullable(row.sent_at),
  };
}

export async function enqueueSend(userId: number, input: {
  recipient: string;
  recipientLabel?: string;
  message?: string;
  mediaUrl?: string;
  mediaType?: string;
  priority?: number;
  sendAt?: string;
  automationId?: number;
  sequenceId?: number;
  abVariant?: string;
}): Promise<QueueItem> {
  const sendAt = input.sendAt ?? formatLocalDateTime(new Date());
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO send_queue (
      user_id, recipient, recipient_label, message, media_url, media_type, priority, send_at,
      automation_id, sequence_id, ab_variant
    )
    VALUES (
      ${userId},
      ${input.recipient},
      ${input.recipientLabel ?? null},
      ${input.message ?? null},
      ${input.mediaUrl ?? null},
      ${input.mediaType ?? null},
      ${input.priority ?? 5},
      ${toTsParam(sendAt)},
      ${input.automationId ?? null},
      ${input.sequenceId ?? null},
      ${input.abVariant ?? null}
    )
    RETURNING *
  `;
  return mapQueueItem(rows[0]);
}

export async function getDueQueueItems(userId: number, limit = 3): Promise<QueueItem[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM send_queue
    WHERE user_id = ${userId} AND status = 'pending' AND send_at <= NOW()
    ORDER BY priority DESC, send_at ASC LIMIT ${limit}
  `;
  return rows.map(mapQueueItem);
}

export async function markQueueSent(userId: number, id: number): Promise<void> {
  await sql`UPDATE send_queue SET status = 'sent', sent_at = NOW() WHERE user_id = ${userId} AND id = ${id}`;
}

export async function markQueueFailed(userId: number, id: number, error: string): Promise<void> {
  await sql`UPDATE send_queue SET status = 'failed', error = ${error} WHERE user_id = ${userId} AND id = ${id}`;
}

export async function rescheduleSendQueueItem(userId: number, id: number, sendAt: string): Promise<void> {
  await sql`UPDATE send_queue SET send_at = ${toTsParam(sendAt)} WHERE user_id = ${userId} AND id = ${id}`;
}

export async function cancelPendingSendQueue(userId: number): Promise<number> {
  const result = await sql`
    UPDATE send_queue SET status = 'cancelled', error = 'Annulé manuellement'
    WHERE user_id = ${userId} AND status = 'pending'
  `;
  return Number(result.count);
}

export async function pauseAllActiveAutomations(userId: number): Promise<number> {
  const result = await sql`
    UPDATE automations SET status = 'paused', updated_at = NOW() WHERE user_id = ${userId} AND status = 'active'
  `;
  return Number(result.count);
}

export interface SequenceStep {
  delayDays: number;
  message: string;
  condition?: "no_reply" | "always";
  mediaUrl?: string;
  mediaType?: string;
}

export interface ContactSequence {
  id: number;
  contact_phone: string;
  automation_id: number | null;
  name: string;
  steps: SequenceStep[];
  current_step: number;
  status: string;
  next_step_at: string | null;
  created_at: string;
}

function mapContactSequence(row: Record<string, unknown>): ContactSequence {
  let steps: SequenceStep[] = [];
  try {
    steps = JSON.parse(String(row.steps_json || "[]")) as SequenceStep[];
  } catch {
    /* ignore */
  }
  return {
    id: Number(row.id),
    contact_phone: String(row.contact_phone),
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
    name: String(row.name),
    steps,
    current_step: Number(row.current_step ?? 0),
    status: String(row.status),
    next_step_at: formatTsNullable(row.next_step_at),
    created_at: formatTs(row.created_at),
  };
}

export async function createContactSequence(userId: number, input: {
  contactPhone: string;
  name: string;
  steps: SequenceStep[];
  automationId?: number;
}): Promise<ContactSequence> {
  const phone = normalizeContactPhone(input.contactPhone);
  const firstDelay = input.steps[0]?.delayDays ?? 0;
  const sendHour = await getRelanceHourForAutomation(userId, input.automationId);
  const nextAt = computeSequenceNextAt(firstDelay, sendHour);
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO contact_sequences (user_id, contact_phone, automation_id, name, steps_json, next_step_at)
    VALUES (
      ${userId},
      ${phone},
      ${input.automationId ?? null},
      ${input.name},
      ${JSON.stringify(input.steps)},
      ${toTsParam(formatLocalDateTime(nextAt))}
    )
    RETURNING *
  `;
  return mapContactSequence(rows[0]);
}

export async function getContactSequence(userId: number, id: number): Promise<ContactSequence | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM contact_sequences WHERE user_id = ${userId} AND id = ${id}
  `;
  return rows[0] ? mapContactSequence(rows[0]) : null;
}

export async function listDueSequences(userId: number, limit = 20): Promise<ContactSequence[]> {
  const rows = await sql<Array<{ id: number }>>`
    SELECT id FROM contact_sequences
    WHERE user_id = ${userId} AND status = 'active' AND next_step_at IS NOT NULL AND next_step_at <= NOW()
    ORDER BY next_step_at ASC LIMIT ${limit}
  `;
  const sequences = await Promise.all(rows.map((r) => getContactSequence(userId, r.id)));
  return sequences.filter(Boolean) as ContactSequence[];
}

export async function advanceSequence(userId: number, id: number): Promise<void> {
  const seq = await getContactSequence(userId, id);
  if (!seq) return;
  const nextStep = seq.current_step + 1;
  if (nextStep >= seq.steps.length) {
    await sql`UPDATE contact_sequences SET status = 'completed', next_step_at = NULL WHERE user_id = ${userId} AND id = ${id}`;
    return;
  }
  const delay = seq.steps[nextStep]?.delayDays ?? 1;
  const sendHour = await getRelanceHourForAutomation(userId, seq.automation_id);
  const nextAt = computeSequenceNextAt(delay, sendHour);
  await sql`
    UPDATE contact_sequences SET current_step = ${nextStep}, next_step_at = ${toTsParam(formatLocalDateTime(nextAt))}
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function cancelSequencesForContact(userId: number, phone: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
    WHERE user_id = ${userId} AND contact_phone = ${chatId} AND status = 'active'
  `;
}

export interface GroupReplyRule {
  id: number;
  group_id: string;
  group_label: string | null;
  keywords: string[];
  reply_guide: string | null;
  automation_id: number | null;
  status: string;
  created_at: string;
}

function mapGroupReplyRule(row: Record<string, unknown>): GroupReplyRule {
  let keywords: string[] = [];
  try {
    keywords = JSON.parse(String(row.keywords_json || "[]")) as string[];
  } catch {
    /* ignore */
  }
  return {
    id: Number(row.id),
    group_id: String(row.group_id),
    group_label: row.group_label != null ? String(row.group_label) : null,
    keywords,
    reply_guide: row.reply_guide != null ? String(row.reply_guide) : null,
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
    status: String(row.status),
    created_at: formatTs(row.created_at),
  };
}

export async function createGroupReplyRule(userId: number, input: {
  groupId: string;
  groupLabel?: string;
  keywords: string[];
  replyGuide?: string;
  automationId?: number;
}): Promise<GroupReplyRule> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO group_reply_rules (user_id, group_id, group_label, keywords_json, reply_guide, automation_id)
    VALUES (
      ${userId},
      ${input.groupId},
      ${input.groupLabel ?? null},
      ${JSON.stringify(input.keywords)},
      ${input.replyGuide ?? null},
      ${input.automationId ?? null}
    )
    RETURNING *
  `;
  return mapGroupReplyRule(rows[0]);
}

export async function getGroupReplyRule(userId: number, id: number): Promise<GroupReplyRule | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM group_reply_rules WHERE user_id = ${userId} AND id = ${id}
  `;
  return rows[0] ? mapGroupReplyRule(rows[0]) : null;
}

export async function listActiveGroupReplyRules(userId: number): Promise<GroupReplyRule[]> {
  const rows = await sql<Array<{ id: number }>>`
    SELECT id FROM group_reply_rules WHERE user_id = ${userId} AND status = 'active'
  `;
  const rules = await Promise.all(rows.map((r) => getGroupReplyRule(userId, r.id)));
  return rules.filter(Boolean) as GroupReplyRule[];
}

export async function findGroupReplyRule(userId: number, groupId: string, text: string): Promise<GroupReplyRule | null> {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  for (const rule of await listActiveGroupReplyRules(userId)) {
    if (rule.group_id !== groupId) continue;
    if (!rule.keywords.length) return rule;
    const match = rule.keywords.some((kw) => {
      const k = kw
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      return k && normalized.includes(k);
    });
    if (match) return rule;
  }
  return null;
}

export interface HandoffEvent {
  id: number;
  contact_phone: string;
  contact_name: string | null;
  reason: string;
  summary: string | null;
  suggested_reply: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

function mapHandoffEvent(row: Record<string, unknown>): HandoffEvent {
  return {
    id: Number(row.id),
    contact_phone: String(row.contact_phone),
    contact_name: row.contact_name != null ? String(row.contact_name) : null,
    reason: String(row.reason),
    summary: row.summary != null ? String(row.summary) : null,
    suggested_reply: row.suggested_reply != null ? String(row.suggested_reply) : null,
    status: String(row.status),
    created_at: formatTs(row.created_at),
    resolved_at: formatTsNullable(row.resolved_at),
  };
}

export async function createHandoffEvent(userId: number, input: {
  contactPhone: string;
  contactName?: string;
  reason: string;
  summary?: string;
  suggestedReply?: string;
}): Promise<HandoffEvent> {
  const phone = normalizeContactPhone(input.contactPhone);
  await setContactHandoff(userId, phone, "pending");
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO handoff_events (user_id, contact_phone, contact_name, reason, summary, suggested_reply)
    VALUES (
      ${userId},
      ${phone},
      ${input.contactName ?? null},
      ${input.reason},
      ${input.summary ?? null},
      ${input.suggestedReply ?? null}
    )
    RETURNING *
  `;
  return mapHandoffEvent(rows[0]);
}

export async function listPendingHandoffs(userId: number, limit = 30): Promise<HandoffEvent[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM handoff_events WHERE user_id = ${userId} AND status = 'pending' ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map(mapHandoffEvent);
}

export async function resolveHandoff(userId: number, id: number, status: "resolved" | "dismissed"): Promise<void> {
  const rows = await sql<Array<{ contact_phone: string }>>`
    SELECT contact_phone FROM handoff_events WHERE user_id = ${userId} AND id = ${id}
  `;
  await sql`
    UPDATE handoff_events SET status = ${status}, resolved_at = NOW() WHERE user_id = ${userId} AND id = ${id}
  `;
  if (rows[0]) await setContactHandoff(userId, rows[0].contact_phone, null);
}

export async function updateAutomationTargetAb(
  userId: number,
  automationId: number,
  targetId: string,
  abVariant: string
): Promise<void> {
  await sql`
    UPDATE automation_targets SET ab_variant = ${abVariant}, last_action_at = NOW()
    WHERE user_id = ${userId} AND automation_id = ${automationId} AND target_id = ${targetId}
  `;
}
