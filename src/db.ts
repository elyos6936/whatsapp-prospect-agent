import { sql } from "./pg.js";
import { config } from "./config.js";

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

async function getSettingRaw(key: string): Promise<string> {
  const rows = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value ?? "";
}

async function setSettingRaw(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = NOW()
  `;
}

async function getSetting(key: string): Promise<string> {
  return getSettingRaw(key);
}

async function setSetting(key: string, value: string): Promise<void> {
  await setSettingRaw(key, value);
}

async function upsertContactInternal(input: {
  phone: string;
  name?: string | null;
  notes?: string | null;
  status?: ContactStatus;
  autoReply?: boolean;
}): Promise<void> {
  const existing = await sql<{ id: number }[]>`
    SELECT id FROM contacts WHERE phone = ${input.phone}
  `;

  const autoReply =
    input.autoReply === undefined ? null : input.autoReply ? 1 : 0;

  if (!existing.length) {
    await sql`
      INSERT INTO contacts (phone, name, notes, status, auto_reply)
      VALUES (
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
    WHERE phone = ${input.phone}
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

export async function getAppSettings(): Promise<AppSettings> {
  return {
    openai_api_key: (await getSetting("openai_api_key")) || config.envOpenAiKey,
    evolution_api_base_url:
      (await getSetting("evolution_api_base_url")) ||
      config.envEvolutionBaseUrl ||
      config.defaultEvolutionBaseUrl,
    evolution_api_key: (await getSetting("evolution_api_key")) || config.envEvolutionApiKey,
    evolution_instance_name:
      (await getSetting("evolution_instance_name")) || config.envEvolutionInstance,
    business_owner_name: (await getSetting("business_owner_name")) || "",
    business_offer: (await getSetting("business_offer")) || "",
    business_price: (await getSetting("business_price")) || "",
  };
}

export async function saveOpenAiKey(key: string): Promise<void> {
  await setSetting("openai_api_key", key.trim());
}

export async function saveEvolutionSettings(input: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}): Promise<void> {
  await setSetting(
    "evolution_api_base_url",
    (input.baseUrl.trim() || config.defaultEvolutionBaseUrl).replace(/\/$/, "")
  );
  await setSetting("evolution_api_key", input.apiKey.trim());
  await setSetting("evolution_instance_name", input.instanceName.trim());
}

export async function saveBusinessProfile(input: {
  ownerName?: string;
  offer?: string;
  price?: string;
}): Promise<void> {
  if (input.ownerName !== undefined) await setSetting("business_owner_name", input.ownerName.trim());
  if (input.offer !== undefined) await setSetting("business_offer", input.offer.trim());
  if (input.price !== undefined) await setSetting("business_price", input.price.trim());
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

export async function saveAgentMessage(role: AgentRole, content: string): Promise<AgentMessage> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_conversation (role, content)
    VALUES (${role}, ${content})
    RETURNING id, role, content, created_at
  `;
  return mapAgentMessage(rows[0]);
}

export async function getRecentAgentMessages(limit = 50): Promise<AgentMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, role, content, created_at
    FROM agent_conversation
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentMessage).reverse();
}

export async function getAgentMessagesSince(sinceId = 0, limit = 50): Promise<AgentMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, role, content, created_at
    FROM agent_conversation
    WHERE id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentMessage);
}

export async function clearAgentConversation(): Promise<void> {
  await sql`DELETE FROM agent_conversation`;
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

export async function saveWhatsAppMessage(input: {
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
    INSERT INTO messages (contact_phone, sender_name, direction, body, green_api_id, counts_toward_quota)
    VALUES (
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

export async function whatsAppMessageExists(greenApiId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM messages WHERE green_api_id = ${greenApiId} LIMIT 1`;
  return rows.length > 0;
}

export async function getIncomingMessagesSince(sinceId = 0, limit = 50): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE direction = 'entrant' AND id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function getRecentIncomingMessages(limit = 30): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE direction = 'entrant'
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage).reverse();
}

export async function getWhatsAppMessagesSince(sinceId = 0, limit = 50): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function listIncomingMessages(
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
      WHERE direction = 'entrant' AND contact_phone = ${chatId} AND created_at::date = CURRENT_DATE
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else if (options.contactPhone) {
    const phone = options.contactPhone.trim();
    const chatId = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@c.us`;
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE direction = 'entrant' AND contact_phone = ${chatId}
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else if (options.todayOnly) {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE direction = 'entrant' AND created_at::date = CURRENT_DATE
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
      FROM messages
      WHERE direction = 'entrant'
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  }

  return rows.map(mapWhatsAppMessage).reverse();
}

export async function getWhatsAppMessageStats(): Promise<{
  totalIncoming: number;
  totalOutgoing: number;
  incomingToday: number;
  outgoingToday: number;
}> {
  const [totalIncomingRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages WHERE direction = 'entrant'
  `;
  const [totalOutgoingRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages WHERE direction = 'sortant'
  `;
  const [incomingTodayRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages
    WHERE direction = 'entrant' AND created_at::date = CURRENT_DATE
  `;
  const [outgoingTodayRow] = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int as c FROM messages
    WHERE direction = 'sortant' AND created_at::date = CURRENT_DATE
  `;
  return {
    totalIncoming: Number(totalIncomingRow?.c ?? 0),
    totalOutgoing: Number(totalOutgoingRow?.c ?? 0),
    incomingToday: Number(incomingTodayRow?.c ?? 0),
    outgoingToday: Number(outgoingTodayRow?.c ?? 0),
  };
}

export async function listAllIncomingMessages(limit = 100): Promise<WhatsAppMessage[]> {
  const safe = Math.min(Math.max(limit, 1), 500);
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE direction = 'entrant'
    ORDER BY id DESC
    LIMIT ${safe}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function getContactChatHistory(chatId: string, limit = 12): Promise<WhatsAppMessage[]> {
  const digits = chatId.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
    FROM messages
    WHERE contact_phone = ${chatId}
       OR (${digits} != '' AND (
         contact_phone = ${digits} || '@c.us'
         OR contact_phone = ${digits} || '@lid'
         OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
       ))
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage).reverse();
}

export async function isAutoReplyEnabled(): Promise<boolean> {
  const v = await getSetting("whatsapp_auto_reply");
  return v !== "0";
}

export async function setAutoReplyEnabled(enabled: boolean): Promise<void> {
  await setSetting("whatsapp_auto_reply", enabled ? "1" : "0");
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

async function lookupContactRow(chatId: string): Promise<Contact | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, phone, name, notes, status, auto_reply,
           COALESCE(lead_score, 0) as lead_score,
           memory_summary, memory_updated_at, handoff_status,
           created_at, updated_at
    FROM contacts WHERE phone = ${chatId} OR whatsapp_lid = ${chatId}
  `;
  return rows[0] ? mapContact(rows[0]) : null;
}

async function findContactForChat(chatId: string): Promise<Contact | null> {
  const trimmed = chatId.trim();
  try {
    const normalized = normalizeContactPhone(trimmed);
    const direct = await lookupContactRow(normalized);
    if (direct) return direct;
  } catch {
    /* try digit fallback */
  }
  const digits = trimmed.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return lookupContactRow(`${digits}@c.us`);
}

export async function getContact(phone: string): Promise<Contact | null> {
  const trimmed = phone.trim();
  if (trimmed.endsWith("@g.us")) return null;
  return findContactForChat(trimmed);
}

export async function listContacts(
  options: { status?: ContactStatus; limit?: number } = {}
): Promise<Contact[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const rows = options.status
    ? await sql<Record<string, unknown>[]>`
        SELECT id, phone, name, notes, status, auto_reply,
          COALESCE(lead_score, 0) as lead_score, memory_summary, memory_updated_at, handoff_status,
          created_at, updated_at
        FROM contacts
        WHERE status = ${options.status}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, phone, name, notes, status, auto_reply,
          COALESCE(lead_score, 0) as lead_score, memory_summary, memory_updated_at, handoff_status,
          created_at, updated_at
        FROM contacts
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `;
  return rows.map(mapContact);
}

export async function updateContactLeadScore(phone: string, score: number): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  await sql`
    UPDATE contacts SET lead_score = ${clamped}, updated_at = NOW() WHERE phone = ${chatId}
  `;
  if (clamped >= 70) {
    await sql`
      UPDATE contacts SET status = 'interesse', updated_at = NOW()
      WHERE phone = ${chatId} AND status != 'stop'
    `;
  }
}

export async function updateContactMemory(phone: string, summary: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contacts SET memory_summary = ${summary.trim()}, memory_updated_at = NOW(),
      updated_at = NOW() WHERE phone = ${chatId}
  `;
}

export async function setContactHandoff(phone: string, status: string | null): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contacts SET handoff_status = ${status}, updated_at = NOW() WHERE phone = ${chatId}
  `;
}

export async function saveContact(input: {
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

  await upsertContactInternal({
    phone: chatId,
    name: input.name,
    notes: input.notes,
    status: input.status,
    autoReply: input.autoReply,
  });

  const contact = await getContact(chatId);
  if (!contact) throw new Error("Impossible d'enregistrer le contact.");
  return contact;
}

export async function touchIncomingContact(chatId: string, senderName?: string): Promise<Contact> {
  const existing = await getContact(chatId);
  if (!existing) {
    return saveContact({
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

  return saveContact(updates);
}

export async function setContactAutoReply(phone: string, enabled: boolean): Promise<Contact> {
  return saveContact({ phone, autoReply: enabled });
}

export async function blockContact(chatId: string): Promise<Contact> {
  return saveContact({ phone: chatId, status: "stop", autoReply: false });
}

export async function unblockContact(chatId: string): Promise<Contact> {
  const existing = await getContact(chatId);
  const nextStatus: ContactStatus =
    existing && existing.status === "stop" ? "en_conversation" : existing?.status ?? "en_conversation";
  return saveContact({ phone: chatId, status: nextStatus });
}

export async function isContactBlocked(chatId: string): Promise<boolean> {
  const contact = await findContactForChat(chatId);
  if (contact) return contact.status === "stop";
  try {
    const list = JSON.parse((await getSetting("blocked_contacts")) || "[]") as string[];
    return list.includes(chatId);
  } catch {
    return false;
  }
}

export async function shouldAutoReplyContact(chatId: string): Promise<boolean> {
  if (!(await isAutoReplyEnabled())) return false;
  if (await isContactBlocked(chatId)) return false;
  const contact = await findContactForChat(chatId);
  if (!contact) return false;
  return contact.auto_reply === 1;
}

export async function setContactWhatsappLid(phone: string, lid: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  const lidNorm = lid.includes("@") ? lid.trim() : `${lid.replace(/\D/g, "")}@lid`;
  await sql`
    UPDATE contacts SET whatsapp_lid = ${lidNorm}, updated_at = NOW() WHERE phone = ${chatId}
  `;
}

export async function findProspectPhoneForLidReply(
  lidOrPseudo: string,
  senderName?: string
): Promise<string | null> {
  const lidDigits = lidOrPseudo.replace(/@c\.us|@lid|@s\.whatsapp\.net/gi, "").replace(/\D/g, "");
  const lid = lidOrPseudo.includes("@") ? lidOrPseudo.trim() : `${lidDigits}@lid`;

  const mapped = await sql<{ phone: string }[]>`
    SELECT phone FROM contacts WHERE whatsapp_lid = ${lid} OR whatsapp_lid = ${`${lidDigits}@lid`}
    LIMIT 1
  `;
  if (mapped[0]?.phone) return mapped[0].phone;

  if (senderName?.trim()) {
    const byName = await sql<{ phone: string }[]>`
      SELECT phone FROM contacts
      WHERE auto_reply = 1 AND status != 'stop' AND name = ${senderName.trim()}
      LIMIT 2
    `;
    if (byName.length === 1) return byName[0].phone;
  }

  const recentOut = await sql<{ phone: string }[]>`
    SELECT m.contact_phone as phone
    FROM messages m
    JOIN contacts c ON c.phone = m.contact_phone AND c.auto_reply = 1 AND c.status != 'stop'
    WHERE m.direction = 'sortant'
      AND m.created_at >= NOW() - INTERVAL '15 minutes'
    ORDER BY m.created_at DESC
    LIMIT 2
  `;
  if (recentOut.length === 1) return recentOut[0].phone;

  return null;
}

export async function findUnansweredInboundMessages(limit = 30): Promise<WhatsAppMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT m.id, m.contact_phone, m.sender_name, m.direction, m.body, m.green_api_id, m.created_at
    FROM messages m
    WHERE m.direction = 'entrant'
      AND m.created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY m.id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapWhatsAppMessage);
}

export async function hasOutboundReplyAfter(
  inboundId: number,
  ...phones: string[]
): Promise<boolean> {
  const ids = phones.filter(Boolean);
  if (ids.length === 0) return false;
  const rows = await sql`
    SELECT 1 FROM messages
    WHERE direction = 'sortant' AND id > ${inboundId} AND contact_phone IN ${sql(ids)}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getDailyOutboundLimit(): Promise<number> {
  const raw = await getSetting("daily_outbound_limit");
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 5) return Math.min(Math.floor(n), 500);
  return DAILY_OUTBOUND_LIMIT;
}

function outboundQuotaBonusKey(): string {
  return `outbound_quota_bonus_${formatLocalDateTime(new Date()).slice(0, 10)}`;
}

export async function getOutboundQuotaBonus(): Promise<number> {
  const n = Number((await getSetting(outboundQuotaBonusKey())) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function getEffectiveOutboundLimit(): Promise<number> {
  return (await getDailyOutboundLimit()) + (await getOutboundQuotaBonus());
}

export async function setDailyOutboundLimit(limit: number): Promise<number> {
  const safe = Math.min(Math.max(Math.floor(limit), 5), 500);
  await setSetting("daily_outbound_limit", String(safe));
  return safe;
}

export async function resetOutboundQuotaForToday(extra = 15): Promise<{
  sent: number;
  limit: number;
  bonus: number;
  effectiveLimit: number;
}> {
  const sent = await countOutboundToday();
  const limit = await getDailyOutboundLimit();
  const needed = Math.max(0, sent - limit);
  const bonus = needed + extra;
  await setSetting(outboundQuotaBonusKey(), String(bonus));
  return { sent, limit, bonus, effectiveLimit: limit + bonus };
}

export async function countOutboundToday(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int as n FROM messages
    WHERE direction = 'sortant'
      AND COALESCE(counts_toward_quota, 1) = 1
      AND created_at::date = CURRENT_DATE
  `;
  return Number(row?.n ?? 0);
}

export async function canSendOutbound(): Promise<
  { ok: true } | { ok: false; reason: string; sent: number; limit: number }
> {
  const sent = await countOutboundToday();
  const limit = (await getDailyOutboundLimit()) + (await getOutboundQuotaBonus());
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

export async function assertCanSendTo(chatId: string): Promise<void> {
  if (!chatId.endsWith("@g.us") && (await isContactBlocked(chatId))) {
    throw new Error(
      `Contact ${chatId} est en statut STOP. Aucun envoi possible. Débloquez-le d'abord si vraiment nécessaire.`
    );
  }
  const check = await canSendOutbound();
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

export async function scheduleMessage(input: {
  recipient: string;
  recipientLabel?: string;
  message: string;
  sendAt: string;
}): Promise<ScheduledMessage> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO scheduled_messages (recipient, recipient_label, message, send_at)
    VALUES (
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
  options: { includeDone?: boolean; limit?: number } = {}
): Promise<ScheduledMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = options.includeDone
    ? await sql<Record<string, unknown>[]>`
        SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
        FROM scheduled_messages
        ORDER BY send_at DESC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
        FROM scheduled_messages
        WHERE status = 'pending'
        ORDER BY send_at ASC
        LIMIT ${limit}
      `;
  return rows.map(mapScheduledMessage);
}

export async function getDueScheduledMessages(limit = 10): Promise<ScheduledMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
    FROM scheduled_messages
    WHERE status = 'pending' AND send_at <= NOW()
    ORDER BY send_at ASC
    LIMIT ${limit}
  `;
  return rows.map(mapScheduledMessage);
}

export async function cancelScheduledMessage(id: number): Promise<ScheduledMessage | null> {
  const existing = await sql<Record<string, unknown>[]>`
    SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
    FROM scheduled_messages WHERE id = ${id}
  `;
  const row = existing[0];
  if (!row) return null;
  const mapped = mapScheduledMessage(row);
  if (mapped.status !== "pending") {
    throw new Error(`Impossible d'annuler : statut actuel = ${mapped.status}.`);
  }

  await sql`UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ${id}`;

  const updated = await sql<Record<string, unknown>[]>`
    SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
    FROM scheduled_messages WHERE id = ${id}
  `;
  return mapScheduledMessage(updated[0]);
}

export async function markScheduledSent(id: number): Promise<void> {
  await sql`
    UPDATE scheduled_messages
    SET status = 'sent', sent_at = NOW(), error = NULL
    WHERE id = ${id}
  `;
}

export async function markScheduledFailed(id: number, error: string): Promise<void> {
  await sql`
    UPDATE scheduled_messages
    SET status = 'failed', error = ${error.slice(0, 500)}, sent_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getContactThread(phone: string, limit = 100): Promise<WhatsAppMessage[]> {
  const trimmed = phone.trim();
  const chatId = trimmed.includes("@") ? trimmed : `${trimmed.replace(/\D/g, "")}@c.us`;
  return getContactChatHistory(chatId, limit);
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

export async function getDailyBilan(date?: string): Promise<DailyBilan> {
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
    WHERE created_at::date = ${day}::date
  `;

  const statusRows = await sql<Array<{ status: string; n: number }>>`
    SELECT status, COUNT(*)::int as n FROM contacts GROUP BY status
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
    SELECT COUNT(*)::int as n FROM scheduled_messages WHERE status = 'pending'
  `;

  const [scheduledSentTodayRow] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int as n FROM scheduled_messages
    WHERE status = 'sent' AND COALESCE(sent_at, send_at)::date = ${day}::date
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
           (SELECT name FROM contacts c WHERE c.phone = m.contact_phone) as name,
           COUNT(*)::int as "messageCount",
           (SELECT body FROM messages m2
              WHERE m2.contact_phone = m.contact_phone
              ORDER BY m2.id DESC LIMIT 1) as "lastMessage",
           MAX(m.created_at) as "lastAt"
    FROM messages m
    WHERE m.created_at::date = ${day}::date
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

export const AUTOMATION_TYPES = ["group_prospect", "keyword_sales", "custom_followup"] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];
export const AUTOMATION_STATUSES = ["active", "paused", "completed", "failed"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];
export const TARGET_STATUSES = ["pending", "contacted", "replied", "interested", "stopped", "error"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export interface AutomationConfig {
  groupId?: string;
  groupName?: string;
  initialMessage?: string;
  maxMembers?: number;
  enableAutoReply?: boolean;
  conversationGuide?: string;
  keywords?: string[];
  productName?: string;
  price?: string;
  salesScript?: string;
  followUpInstructions?: string;
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
  report?: string;
  conversions?: number;
  revenueFcfa?: number;
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

async function recomputeAutomationStats(automationId: number): Promise<AutomationStats> {
  const rows = await sql<Array<{ status: string; n: number }>>`
    SELECT status, COUNT(*)::int as n FROM automation_targets
    WHERE automation_id = ${automationId} GROUP BY status
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

  const auto = await getAutomation(automationId);
  if (auto) {
    stats.messagesHandled = auto.stats.messagesHandled ?? 0;
    stats.outboundUsed = auto.stats.outboundUsed ?? 0;
    stats.report = auto.stats.report;
    stats.lastActionAt = auto.stats.lastActionAt;
  }

  await sql`
    UPDATE automations SET stats_json = ${JSON.stringify(stats)}, updated_at = NOW()
    WHERE id = ${automationId}
  `;

  return stats;
}

export async function createAutomation(input: {
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
    INSERT INTO automations (name, type, status, config_json, stats_json, summary, budget_fcfa)
    VALUES (
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
  await addAutomationLog(id, "info", `Automatisation créée : ${input.name}`);
  return (await getAutomation(id))!;
}

export async function getAutomation(id: number): Promise<Automation | null> {
  const rows = await sql<Array<Parameters<typeof parseAutomationRow>[0]>>`
    SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
    FROM automations WHERE id = ${id}
  `;
  return rows[0] ? parseAutomationRow(rows[0]) : null;
}

export async function listAutomations(
  options: { status?: AutomationStatus; limit?: number } = {}
): Promise<Automation[]> {
  const limit = options.limit ?? 100;
  const rows = options.status
    ? await sql<Array<Parameters<typeof parseAutomationRow>[0]>>`
        SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
        FROM automations
        WHERE status = ${options.status}
        ORDER BY id DESC
        LIMIT ${limit}
      `
    : await sql<Array<Parameters<typeof parseAutomationRow>[0]>>`
        SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
        FROM automations
        ORDER BY id DESC
        LIMIT ${limit}
      `;
  return rows.map(parseAutomationRow);
}

export async function listActiveAutomations(): Promise<Automation[]> {
  return listAutomations({ status: "active", limit: 50 });
}

export async function updateAutomationStatus(
  id: number,
  status: AutomationStatus
): Promise<Automation | null> {
  await sql`UPDATE automations SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
  await addAutomationLog(id, "info", `Statut → ${status}`);
  return getAutomation(id);
}

export async function updateAutomationStats(
  id: number,
  patch: Partial<AutomationStats>
): Promise<Automation | null> {
  const auto = await getAutomation(id);
  if (!auto) return null;
  const stats = { ...auto.stats, ...patch };
  await sql`
    UPDATE automations SET stats_json = ${JSON.stringify(stats)}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return getAutomation(id);
}

export async function addAutomationTargets(
  automationId: number,
  targets: Array<{ targetId: string; targetLabel?: string }>
): Promise<number> {
  let added = 0;
  for (const t of targets) {
    const result = await sql`
      INSERT INTO automation_targets (automation_id, target_id, target_label)
      VALUES (${automationId}, ${t.targetId}, ${t.targetLabel ?? null})
      ON CONFLICT (automation_id, target_id) DO NOTHING
    `;
    if (result.count > 0) added++;
  }
  await recomputeAutomationStats(automationId);
  return added;
}

export async function listAutomationTargets(
  automationId: number,
  options: { status?: TargetStatus; limit?: number } = {}
): Promise<AutomationTarget[]> {
  const limit = options.limit ?? 500;
  const rows = options.status
    ? await sql<Record<string, unknown>[]>`
        SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
        FROM automation_targets
        WHERE automation_id = ${automationId} AND status = ${options.status}
        ORDER BY id ASC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
        FROM automation_targets
        WHERE automation_id = ${automationId}
        ORDER BY id ASC
        LIMIT ${limit}
      `;
  return rows.map(mapAutomationTarget);
}

export async function updateAutomationTarget(
  automationId: number,
  targetId: string,
  patch: { status?: TargetStatus; notes?: string }
): Promise<void> {
  if (patch.status && patch.notes !== undefined) {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW(), status = ${patch.status}, notes = ${patch.notes}
      WHERE automation_id = ${automationId} AND target_id = ${targetId}
    `;
  } else if (patch.status) {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW(), status = ${patch.status}
      WHERE automation_id = ${automationId} AND target_id = ${targetId}
    `;
  } else if (patch.notes !== undefined) {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW(), notes = ${patch.notes}
      WHERE automation_id = ${automationId} AND target_id = ${targetId}
    `;
  } else {
    await sql`
      UPDATE automation_targets
      SET last_action_at = NOW()
      WHERE automation_id = ${automationId} AND target_id = ${targetId}
    `;
  }
  await recomputeAutomationStats(automationId);
}

export async function getNextPendingTarget(automationId: number): Promise<AutomationTarget | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
    FROM automation_targets
    WHERE automation_id = ${automationId} AND status = 'pending'
    ORDER BY id ASC LIMIT 1
  `;
  return rows[0] ? mapAutomationTarget(rows[0]) : null;
}

export async function addAutomationLog(
  automationId: number,
  level: AutomationLog["level"],
  message: string
): Promise<AutomationLog> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO automation_logs (automation_id, level, message)
    VALUES (${automationId}, ${level}, ${message})
    RETURNING id, automation_id, level, message, created_at
  `;
  return mapAutomationLog(rows[0]);
}

export async function listAutomationLogs(
  automationId: number,
  limit = 50
): Promise<AutomationLog[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, automation_id, level, message, created_at
    FROM automation_logs WHERE automation_id = ${automationId}
    ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map(mapAutomationLog);
}

export async function getAutomationDetail(id: number): Promise<{
  automation: Automation;
  targets: AutomationTarget[];
  logs: AutomationLog[];
} | null> {
  const automation = await getAutomation(id);
  if (!automation) return null;
  const targets = await listAutomationTargets(id);
  const logs = await listAutomationLogs(id, 30);
  const stats = await recomputeAutomationStats(id);
  automation.stats = stats;
  return { automation, targets, logs };
}

export async function updateAutomationConfig(
  id: number,
  config: AutomationConfig
): Promise<Automation | null> {
  await sql`
    UPDATE automations SET config_json = ${JSON.stringify(config)}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return getAutomation(id);
}

export async function findMatchingKeywordAutomations(text: string): Promise<Automation[]> {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const active = (await listActiveAutomations()).filter((a) => a.type === "keyword_sales");
  return active.filter((a) => {
    const keywords = a.config.keywords ?? [];
    return keywords.some((kw) => {
      const k = kw
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      return k && normalized.includes(k);
    });
  });
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

export async function enqueueSend(input: {
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
      recipient, recipient_label, message, media_url, media_type, priority, send_at,
      automation_id, sequence_id, ab_variant
    )
    VALUES (
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

export async function getDueQueueItems(limit = 3): Promise<QueueItem[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM send_queue
    WHERE status = 'pending' AND send_at <= NOW()
    ORDER BY priority DESC, send_at ASC LIMIT ${limit}
  `;
  return rows.map(mapQueueItem);
}

export async function markQueueSent(id: number): Promise<void> {
  await sql`UPDATE send_queue SET status = 'sent', sent_at = NOW() WHERE id = ${id}`;
}

export async function markQueueFailed(id: number, error: string): Promise<void> {
  await sql`UPDATE send_queue SET status = 'failed', error = ${error} WHERE id = ${id}`;
}

export async function rescheduleSendQueueItem(id: number, sendAt: string): Promise<void> {
  await sql`UPDATE send_queue SET send_at = ${toTsParam(sendAt)} WHERE id = ${id}`;
}

export async function cancelPendingSendQueue(): Promise<number> {
  const result = await sql`
    UPDATE send_queue SET status = 'cancelled', error = 'Annulé manuellement'
    WHERE status = 'pending'
  `;
  return Number(result.count);
}

export async function pauseAllActiveAutomations(): Promise<number> {
  const result = await sql`
    UPDATE automations SET status = 'paused', updated_at = NOW() WHERE status = 'active'
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

export async function createContactSequence(input: {
  contactPhone: string;
  name: string;
  steps: SequenceStep[];
  automationId?: number;
}): Promise<ContactSequence> {
  const phone = normalizeContactPhone(input.contactPhone);
  const firstDelay = input.steps[0]?.delayDays ?? 0;
  const nextAt = new Date();
  nextAt.setDate(nextAt.getDate() + firstDelay);
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO contact_sequences (contact_phone, automation_id, name, steps_json, next_step_at)
    VALUES (
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

export async function getContactSequence(id: number): Promise<ContactSequence | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM contact_sequences WHERE id = ${id}
  `;
  return rows[0] ? mapContactSequence(rows[0]) : null;
}

export async function listDueSequences(limit = 20): Promise<ContactSequence[]> {
  const rows = await sql<Array<{ id: number }>>`
    SELECT id FROM contact_sequences
    WHERE status = 'active' AND next_step_at IS NOT NULL AND next_step_at <= NOW()
    ORDER BY next_step_at ASC LIMIT ${limit}
  `;
  const sequences = await Promise.all(rows.map((r) => getContactSequence(r.id)));
  return sequences.filter(Boolean) as ContactSequence[];
}

export async function advanceSequence(id: number): Promise<void> {
  const seq = await getContactSequence(id);
  if (!seq) return;
  const nextStep = seq.current_step + 1;
  if (nextStep >= seq.steps.length) {
    await sql`UPDATE contact_sequences SET status = 'completed', next_step_at = NULL WHERE id = ${id}`;
    return;
  }
  const delay = seq.steps[nextStep]?.delayDays ?? 1;
  const nextAt = new Date();
  nextAt.setDate(nextAt.getDate() + delay);
  await sql`
    UPDATE contact_sequences SET current_step = ${nextStep}, next_step_at = ${toTsParam(formatLocalDateTime(nextAt))}
    WHERE id = ${id}
  `;
}

export async function cancelSequencesForContact(phone: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
    WHERE contact_phone = ${chatId} AND status = 'active'
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

export async function createGroupReplyRule(input: {
  groupId: string;
  groupLabel?: string;
  keywords: string[];
  replyGuide?: string;
  automationId?: number;
}): Promise<GroupReplyRule> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO group_reply_rules (group_id, group_label, keywords_json, reply_guide, automation_id)
    VALUES (
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

export async function getGroupReplyRule(id: number): Promise<GroupReplyRule | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM group_reply_rules WHERE id = ${id}
  `;
  return rows[0] ? mapGroupReplyRule(rows[0]) : null;
}

export async function listActiveGroupReplyRules(): Promise<GroupReplyRule[]> {
  const rows = await sql<Array<{ id: number }>>`
    SELECT id FROM group_reply_rules WHERE status = 'active'
  `;
  const rules = await Promise.all(rows.map((r) => getGroupReplyRule(r.id)));
  return rules.filter(Boolean) as GroupReplyRule[];
}

export async function findGroupReplyRule(groupId: string, text: string): Promise<GroupReplyRule | null> {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  for (const rule of await listActiveGroupReplyRules()) {
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

export async function createHandoffEvent(input: {
  contactPhone: string;
  contactName?: string;
  reason: string;
  summary?: string;
  suggestedReply?: string;
}): Promise<HandoffEvent> {
  const phone = normalizeContactPhone(input.contactPhone);
  await setContactHandoff(phone, "pending");
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO handoff_events (contact_phone, contact_name, reason, summary, suggested_reply)
    VALUES (
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

export async function listPendingHandoffs(limit = 30): Promise<HandoffEvent[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM handoff_events WHERE status = 'pending' ORDER BY id DESC LIMIT ${limit}
  `;
  return rows.map(mapHandoffEvent);
}

export async function resolveHandoff(id: number, status: "resolved" | "dismissed"): Promise<void> {
  const rows = await sql<Array<{ contact_phone: string }>>`
    SELECT contact_phone FROM handoff_events WHERE id = ${id}
  `;
  await sql`
    UPDATE handoff_events SET status = ${status}, resolved_at = NOW() WHERE id = ${id}
  `;
  if (rows[0]) await setContactHandoff(rows[0].contact_phone, null);
}

export async function updateAutomationTargetAb(
  automationId: number,
  targetId: string,
  abVariant: string
): Promise<void> {
  await sql`
    UPDATE automation_targets SET ab_variant = ${abVariant}, last_action_at = NOW()
    WHERE automation_id = ${automationId} AND target_id = ${targetId}
  `;
}

