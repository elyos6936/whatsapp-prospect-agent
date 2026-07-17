import { sql } from "./pg.js";
import { config, evolutionInstanceName } from "./config.js";
import { getUserById } from "./users.js";
import { matchesAnyTriggerPhrase } from "./phrase-matching.js";

export const DAILY_OUTBOUND_LIMIT = 25;
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

let agentThreadsSchemaReady: Promise<void> | null = null;

/** Schéma fils agent — best-effort si la migration SQL n'a pas encore été appliquée. */
export async function ensureAgentThreadsSchema(): Promise<void> {
  if (!agentThreadsSchemaReady) {
    agentThreadsSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agent_threads (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'Automatisation',
          automation_id BIGINT REFERENCES automations(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_agent_threads_user ON agent_threads(user_id, updated_at DESC)`;
      await sql`ALTER TABLE agent_conversation ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES agent_threads(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE automations ADD COLUMN IF NOT EXISTS agent_thread_id BIGINT REFERENCES agent_threads(id) ON DELETE SET NULL`;
      await sql`ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS description TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS idx_agent_conversation_thread ON agent_conversation(user_id, thread_id, id)`;

      // Backfill : 1 fil par user avec messages orphelins
      await sql`
        INSERT INTO agent_threads (user_id, title, updated_at)
        SELECT DISTINCT ac.user_id, 'Automatisation', NOW()
        FROM agent_conversation ac
        WHERE ac.user_id IS NOT NULL
          AND ac.thread_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM agent_threads t WHERE t.user_id = ac.user_id)
      `;
      await sql`
        UPDATE agent_conversation ac
        SET thread_id = t.id
        FROM agent_threads t
        WHERE ac.user_id = t.user_id
          AND ac.thread_id IS NULL
          AND t.id = (SELECT MIN(t2.id) FROM agent_threads t2 WHERE t2.user_id = ac.user_id)
      `;
    })().catch((err) => {
      agentThreadsSchemaReady = null;
      throw err;
    });
  }
  await agentThreadsSchemaReady;
}

export interface AgentThread {
  id: number;
  user_id: number;
  title: string;
  description?: string | null;
  automation_id: number | null;
  created_at: string;
  updated_at: string;
  automation_status?: string | null;
  automation_name?: string | null;
}

function sanitizeThreadTitle(raw: string): string {
  let clean = String(raw ?? "").trim() || "Automatisation";
  clean = clean.replace(/\s*#\d+\s*$/g, "").trim();
  if (/^campagne\s*\d+$/i.test(clean) || /^automatisation\s*\d+$/i.test(clean)) {
    return "Automatisation";
  }
  return clean || "Automatisation";
}

function mapAgentThread(row: Record<string, unknown>): AgentThread {
  const desc = row.description != null ? String(row.description).trim() : "";
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    title: sanitizeThreadTitle(String(row.title)),
    description: desc || null,
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
    created_at: formatTs(row.created_at),
    updated_at: formatTs(row.updated_at),
    automation_status: row.automation_status != null ? String(row.automation_status) : null,
    automation_name: row.automation_name != null ? String(row.automation_name) : null,
  };
}

export async function listAgentThreads(userId: number, limit = 50): Promise<AgentThread[]> {
  await ensureAgentThreadsSchema().catch(() => {});
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      t.id, t.user_id, t.title, t.description, t.automation_id, t.created_at, t.updated_at,
      a.status AS automation_status,
      a.name AS automation_name
    FROM agent_threads t
    LEFT JOIN automations a ON a.id = t.automation_id AND a.user_id = t.user_id
    WHERE t.user_id = ${userId}
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentThread);
}

export async function getAgentThread(userId: number, threadId: number): Promise<AgentThread | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      t.id, t.user_id, t.title, t.description, t.automation_id, t.created_at, t.updated_at,
      a.status AS automation_status,
      a.name AS automation_name
    FROM agent_threads t
    LEFT JOIN automations a ON a.id = t.automation_id AND a.user_id = t.user_id
    WHERE t.user_id = ${userId} AND t.id = ${threadId}
    LIMIT 1
  `;
  return rows[0] ? mapAgentThread(rows[0]) : null;
}

export async function createAgentThread(
  userId: number,
  title = "Automatisation",
  description?: string | null
): Promise<AgentThread> {
  await ensureAgentThreadsSchema().catch(() => {});
  const cleanTitle = sanitizeThreadTitle(title);
  const cleanDesc = description?.trim().slice(0, 280) || null;
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_threads (user_id, title, description)
    VALUES (${userId}, ${cleanTitle}, ${cleanDesc})
    RETURNING id, user_id, title, description, automation_id, created_at, updated_at
  `;
  return mapAgentThread(rows[0]);
}

export async function ensureDefaultAgentThread(userId: number): Promise<AgentThread> {
  const existing = await listAgentThreads(userId, 1);
  if (existing[0]) return existing[0];
  return createAgentThread(userId);
}

export async function updateAgentThreadTitle(userId: number, threadId: number, title: string): Promise<AgentThread | null> {
  let clean = title.trim() || "Automatisation";
  clean = clean.replace(/\s*#\d+\s*$/g, "").trim();
  if (/^campagne\s*\d+$/i.test(clean) || /^automatisation\s*\d+$/i.test(clean)) {
    clean = "Automatisation";
  }
  if (!clean) clean = "Automatisation";
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE agent_threads
    SET title = ${clean}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${threadId}
    RETURNING id, user_id, title, description, automation_id, created_at, updated_at
  `;
  const thread = rows[0] ? mapAgentThread(rows[0]) : null;
  if (thread?.automation_id) {
    await sql`
      UPDATE automations SET name = ${clean}, updated_at = NOW()
      WHERE user_id = ${userId} AND id = ${thread.automation_id}
    `;
  }
  return thread;
}

export async function touchAgentThread(userId: number, threadId: number): Promise<void> {
  await sql`
    UPDATE agent_threads SET updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
}

export async function deleteAgentThread(userId: number, threadId: number): Promise<boolean> {
  const thread = await getAgentThread(userId, threadId);
  if (!thread) return false;
  const automationId = thread.automation_id;
  // Délier avant suppression cascade / FK
  await sql`
    UPDATE automations SET agent_thread_id = NULL
    WHERE user_id = ${userId} AND agent_thread_id = ${threadId}
  `;
  await sql`DELETE FROM agent_threads WHERE user_id = ${userId} AND id = ${threadId}`;
  if (automationId) {
    await deleteAutomation(userId, automationId);
  }
  return true;
}

export async function threadHasCampaign(userId: number, threadId: number): Promise<boolean> {
  const thread = await getAgentThread(userId, threadId);
  return Boolean(thread?.automation_id);
}

export async function resolveThreadIdForAutomation(userId: number, automationId: number): Promise<number | null> {
  const rows = await sql<{ agent_thread_id: number | null }[]>`
    SELECT agent_thread_id FROM automations WHERE user_id = ${userId} AND id = ${automationId} LIMIT 1
  `;
  if (rows[0]?.agent_thread_id) return Number(rows[0].agent_thread_id);
  const fallback = await sql<{ id: number }[]>`
    SELECT id FROM agent_threads WHERE user_id = ${userId} AND automation_id = ${automationId} LIMIT 1
  `;
  return fallback[0] ? Number(fallback[0].id) : null;
}

export async function linkAutomationToThread(
  userId: number,
  threadId: number,
  automationId: number,
  title?: string
): Promise<void> {
  const name = title?.trim();
  await sql`
    UPDATE agent_threads
    SET automation_id = ${automationId},
        title = COALESCE(${name ?? null}, title),
        updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
  await sql`
    UPDATE automations
    SET agent_thread_id = ${threadId}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${automationId}
  `;
}

export async function automationBelongsToThread(
  userId: number,
  threadId: number,
  automationId: number
): Promise<boolean> {
  const thread = await getAgentThread(userId, threadId);
  if (!thread) return false;
  if (thread.automation_id === automationId) return true;
  const rows = await sql`SELECT 1 FROM automations WHERE user_id = ${userId} AND id = ${automationId} AND agent_thread_id = ${threadId} LIMIT 1`;
  return rows.length > 0;
}

export async function saveAgentMessage(
  userId: number,
  threadId: number,
  role: AgentRole,
  content: string
): Promise<AgentMessage> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_conversation (user_id, thread_id, role, content)
    VALUES (${userId}, ${threadId}, ${role}, ${content})
    RETURNING id, role, content, created_at
  `;
  await touchAgentThread(userId, threadId);
  return mapAgentMessage(rows[0]);
}

export async function saveAgentMessageForAutomation(
  userId: number,
  automationId: number,
  role: AgentRole,
  content: string
): Promise<AgentMessage | null> {
  const threadId = await resolveThreadIdForAutomation(userId, automationId);
  if (!threadId) return null;
  return saveAgentMessage(userId, threadId, role, content);
}

export async function getRecentAgentMessages(
  userId: number,
  threadId: number,
  limit = 50
): Promise<AgentMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, role, content, created_at
    FROM agent_conversation
    WHERE user_id = ${userId} AND thread_id = ${threadId}
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentMessage).reverse();
}

export async function getAgentMessagesSince(
  userId: number,
  threadId: number,
  sinceId = 0,
  limit = 50
): Promise<AgentMessage[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, role, content, created_at
    FROM agent_conversation
    WHERE user_id = ${userId} AND thread_id = ${threadId} AND id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentMessage);
}

export async function clearAgentConversation(userId: number, threadId: number): Promise<void> {
  await sql`DELETE FROM agent_conversation WHERE user_id = ${userId} AND thread_id = ${threadId}`;
  await touchAgentThread(userId, threadId);
}

export interface WhatsAppMessage {
  id: number;
  contact_phone: string;
  sender_name: string | null;
  direction: "entrant" | "sortant";
  body: string;
  green_api_id: string | null;
  automation_id: number | null;
  created_at: string;
}

export interface ContactAutomationState {
  id: number;
  user_id: number;
  phone: string;
  automation_id: number;
  memory_summary: string | null;
  memory_updated_at: string | null;
  lead_score: number;
  handoff_status: string | null;
  conversation_epoch_at: string;
  created_at: string;
  updated_at: string;
}

function mapWhatsAppMessage(row: Record<string, unknown>): WhatsAppMessage {
  return {
    id: Number(row.id),
    contact_phone: String(row.contact_phone),
    sender_name: row.sender_name != null ? String(row.sender_name) : null,
    direction: row.direction as WhatsAppMessage["direction"],
    body: String(row.body),
    green_api_id: row.green_api_id != null ? String(row.green_api_id) : null,
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
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
  automationId?: number | null;
}): Promise<WhatsAppMessage> {
  await ensureContactAutomationStateSchema().catch(() => {});
  const countsTowardQuota =
    input.direction === "sortant" ? (input.countsTowardQuota !== false ? 1 : 0) : 1;
  const automationIdRaw =
    input.automationId != null ? Number(input.automationId) : NaN;
  const automationId = Number.isFinite(automationIdRaw)
    ? Math.floor(automationIdRaw)
    : null;
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO messages (user_id, contact_phone, sender_name, direction, body, green_api_id, counts_toward_quota, automation_id)
    VALUES (
      ${userId},
      ${input.contactPhone},
      ${input.senderName ?? null},
      ${input.direction},
      ${input.body},
      ${input.greenApiId ?? null},
      ${countsTowardQuota},
      ${automationId}
    )
    RETURNING id, contact_phone, sender_name, direction, body, green_api_id, automation_id, created_at
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

export async function getContactChatHistory(
  userId: number,
  chatId: string,
  limit = 12,
  automationId?: number | null
): Promise<WhatsAppMessage[]> {
  await ensureConversationEpochColumns().catch(() => {});
  await ensureContactAutomationStateSchema().catch(() => {});
  const digits = chatId.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const contact = await findContactForChat(userId, chatId).catch(() => null);

  const scopedAutoIdRaw =
    automationId != null ? Number(automationId) : NaN;
  const scopedAutoId = Number.isFinite(scopedAutoIdRaw)
    ? Math.floor(scopedAutoIdRaw)
    : null;

  let epoch: string | null = null;
  if (scopedAutoId != null) {
    try {
      const state = await getContactAutomationState(userId, chatId, scopedAutoId);
      epoch = state?.conversation_epoch_at ?? null;
    } catch {
      epoch = null;
    }
  } else {
    epoch = contact?.conversation_epoch_at ?? null;
  }

  // Isolation stricte : uniquement les messages tagués de cette automatisation
  let rows: Record<string, unknown>[];
  if (scopedAutoId != null) {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, automation_id, created_at
      FROM messages
      WHERE user_id = ${userId}
        AND automation_id = ${scopedAutoId}
        AND (contact_phone = ${chatId}
         OR (${digits} != '' AND (
           contact_phone = ${digits} || '@c.us'
           OR contact_phone = ${digits} || '@lid'
           OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
         )))
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else if (epoch) {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, automation_id, created_at
      FROM messages
      WHERE user_id = ${userId}
        AND created_at >= ${toTsParam(epoch)}
        AND (contact_phone = ${chatId}
         OR (${digits} != '' AND (
           contact_phone = ${digits} || '@c.us'
           OR contact_phone = ${digits} || '@lid'
           OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
         )))
      ORDER BY id DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql<Record<string, unknown>[]>`
      SELECT id, contact_phone, sender_name, direction, body, green_api_id, automation_id, created_at
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
  }
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
  /** Début de la conversation courante (nouvelle campagne) — historique LLM ignoré avant. */
  conversation_epoch_at: string | null;
  /** Campagne à laquelle appartient l'époque courante (relances = même id → contexte gardé). */
  conversation_campaign_id: number | null;
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
    conversation_epoch_at: formatTsNullable(row.conversation_epoch_at),
    conversation_campaign_id:
      row.conversation_campaign_id != null ? Number(row.conversation_campaign_id) : null,
    created_at: formatTs(row.created_at),
    updated_at: formatTs(row.updated_at),
  };
}

let conversationEpochColumnsReady: Promise<void> | null = null;

/** Colonnes epoch conversation — best-effort si la migration SQL n'a pas encore été appliquée. */
export async function ensureConversationEpochColumns(): Promise<void> {
  if (!conversationEpochColumnsReady) {
    conversationEpochColumnsReady = (async () => {
      await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conversation_epoch_at TIMESTAMPTZ`;
      await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conversation_campaign_id BIGINT`;
    })().catch((err) => {
      conversationEpochColumnsReady = null;
      throw err;
    });
  }
  await conversationEpochColumnsReady;
}

let contactAutomationStateReady: Promise<void> | null = null;

/** Table mémoire par automatisation + colonne messages.automation_id. */
export async function ensureContactAutomationStateSchema(): Promise<void> {
  if (!contactAutomationStateReady) {
    contactAutomationStateReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS contact_automation_state (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          phone TEXT NOT NULL,
          automation_id BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          memory_summary TEXT,
          memory_updated_at TIMESTAMPTZ,
          lead_score INTEGER NOT NULL DEFAULT 0,
          handoff_status TEXT,
          conversation_epoch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, phone, automation_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_contact_automation_state_auto
        ON contact_automation_state (user_id, automation_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_contact_automation_state_phone
        ON contact_automation_state (user_id, phone)
      `;
      await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS automation_id BIGINT`;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_messages_automation
        ON messages (user_id, automation_id, contact_phone)
      `;
    })().catch((err) => {
      contactAutomationStateReady = null;
      throw err;
    });
  }
  await contactAutomationStateReady;
}

function mapContactAutomationState(row: Record<string, unknown>): ContactAutomationState {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    phone: String(row.phone),
    automation_id: Number(row.automation_id),
    memory_summary: row.memory_summary != null ? String(row.memory_summary) : null,
    memory_updated_at: formatTsNullable(row.memory_updated_at),
    lead_score: Number(row.lead_score ?? 0),
    handoff_status: row.handoff_status != null ? String(row.handoff_status) : null,
    conversation_epoch_at: formatTs(row.conversation_epoch_at),
    created_at: formatTs(row.created_at),
    updated_at: formatTs(row.updated_at),
  };
}

export async function getContactAutomationState(
  userId: number,
  phone: string,
  automationId: number
): Promise<ContactAutomationState | null> {
  await ensureContactAutomationStateSchema();
  const chatId = normalizeContactPhone(phone);
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, user_id, phone, automation_id, memory_summary, memory_updated_at,
           lead_score, handoff_status, conversation_epoch_at, created_at, updated_at
    FROM contact_automation_state
    WHERE user_id = ${userId} AND phone = ${chatId} AND automation_id = ${automationId}
    LIMIT 1
  `;
  return rows[0] ? mapContactAutomationState(rows[0]) : null;
}

export async function updateContactAutomationMemory(
  userId: number,
  phone: string,
  automationId: number,
  summary: string
): Promise<void> {
  await ensureContactAutomationStateSchema();
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contact_automation_state
    SET memory_summary = ${summary.trim()},
        memory_updated_at = NOW(),
        updated_at = NOW()
    WHERE user_id = ${userId} AND phone = ${chatId} AND automation_id = ${automationId}
  `;
}

export async function updateContactAutomationLeadScore(
  userId: number,
  phone: string,
  automationId: number,
  score: number
): Promise<void> {
  await ensureContactAutomationStateSchema();
  const chatId = normalizeContactPhone(phone);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  await sql`
    UPDATE contact_automation_state
    SET lead_score = ${clamped}, updated_at = NOW()
    WHERE user_id = ${userId} AND phone = ${chatId} AND automation_id = ${automationId}
  `;
}

/** IDs déjà cibles de CETTE automatisation uniquement (pas inter-campagnes). */
export async function getAutomationTargetIds(
  userId: number,
  automationId: number
): Promise<Set<string>> {
  const targets = await listAutomationTargets(userId, automationId, { limit: 5000 });
  return new Set(targets.map((t) => t.target_id));
}

async function lookupContactRow(userId: number, chatId: string): Promise<Contact | null> {
  await ensureConversationEpochColumns().catch(() => {});
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, phone, name, notes, status, auto_reply,
           COALESCE(lead_score, 0) as lead_score,
           memory_summary, memory_updated_at, handoff_status,
           conversation_epoch_at, conversation_campaign_id,
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
          conversation_epoch_at, conversation_campaign_id,
          created_at, updated_at
        FROM contacts
        WHERE user_id = ${userId} AND status = ${options.status}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
    : await sql<Record<string, unknown>[]>`
        SELECT id, phone, name, notes, status, auto_reply,
          COALESCE(lead_score, 0) as lead_score, memory_summary, memory_updated_at, handoff_status,
          conversation_epoch_at, conversation_campaign_id,
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

/** Efface le résumé LLM (sans toucher à l'époque) — ex. pause de campagne. */
export async function clearContactMemory(userId: number, phone: string): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  await ensureConversationEpochColumns().catch(() => {});
  await sql`
    UPDATE contacts
    SET memory_summary = NULL, memory_updated_at = NULL, updated_at = NOW()
    WHERE user_id = ${userId} AND phone = ${chatId}
  `;
}

/**
 * Démarre / reprend une conversation pour une campagne :
 * - même automatisation → réutilise la mémoire isolée (relance)
 * - nouvelle automatisation → crée un état vide SANS effacer les autres autos
 * - contacts.conversation_campaign_id = pointeur « campagne active » pour le routage des réponses
 */
export async function beginFreshCampaignConversation(
  userId: number,
  phone: string,
  automationId: number
): Promise<{ fresh: boolean }> {
  await ensureConversationEpochColumns();
  await ensureContactAutomationStateSchema();
  const chatId = normalizeContactPhone(phone);

  await saveContact(userId, { phone: chatId, status: "en_conversation", autoReply: true });

  const existing = await getContactAutomationState(userId, chatId, automationId);
  if (existing) {
    await sql`
      UPDATE contacts
      SET conversation_campaign_id = ${automationId},
          conversation_epoch_at = ${toTsParam(existing.conversation_epoch_at)},
          memory_summary = ${existing.memory_summary},
          lead_score = ${existing.lead_score},
          status = CASE WHEN status = 'stop' THEN status ELSE 'en_conversation' END,
          updated_at = NOW()
      WHERE user_id = ${userId} AND phone = ${chatId}
    `;
    return { fresh: false };
  }

  await sql`
    INSERT INTO contact_automation_state (
      user_id, phone, automation_id, memory_summary, lead_score,
      conversation_epoch_at, created_at, updated_at
    )
    VALUES (
      ${userId},
      ${chatId},
      ${automationId},
      NULL,
      0,
      NOW() - INTERVAL '5 minutes',
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id, phone, automation_id) DO NOTHING
  `;

  await sql`
    UPDATE contacts
    SET memory_summary = NULL,
        memory_updated_at = NULL,
        lead_score = 0,
        handoff_status = NULL,
        conversation_epoch_at = NOW() - INTERVAL '5 minutes',
        conversation_campaign_id = ${automationId},
        status = CASE WHEN status = 'stop' THEN status ELSE 'en_conversation' END,
        updated_at = NOW()
    WHERE user_id = ${userId} AND phone = ${chatId}
  `;
  console.log(`🆕 Conversation neuve → ${chatId} (campagne #${automationId}) — mémoire isolée`);
  return { fresh: true };
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

/** Liste explicite de contacts exclus (réglage), distincte du statut conversation « stop ». */
export async function getBlockedContactIds(userId: number): Promise<string[]> {
  try {
    const list = JSON.parse((await getSetting(userId, "blocked_contacts")) || "[]") as unknown;
    if (!Array.isArray(list)) return [];
    return list.map((x) => String(x ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function isContactBlocked(userId: number, chatId: string): Promise<boolean> {
  const contact = await findContactForChat(userId, chatId);
  if (contact) return contact.status === "stop";
  const list = await getBlockedContactIds(userId);
  return list.includes(chatId);
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

  // 1) Mapping LID déjà connu
  const mapped = await sql<{ phone: string }[]>`
    SELECT phone FROM contacts
    WHERE user_id = ${userId} AND (whatsapp_lid = ${lid} OR whatsapp_lid = ${`${lidDigits}@lid`})
    LIMIT 1
  `;
  if (mapped[0]?.phone) return mapped[0].phone;

  // 2) Nom unique parmi les cibles de campagnes ACTIVES
  if (senderName?.trim()) {
    const byNameCampaign = await sql<{ phone: string }[]>`
      SELECT DISTINCT t.target_id as phone
      FROM automation_targets t
      JOIN automations a ON a.id = t.automation_id AND a.user_id = t.user_id AND a.status = 'active'
      JOIN contacts c ON c.user_id = t.user_id AND c.phone = t.target_id
      WHERE t.user_id = ${userId}
        AND t.status IN ('contacted', 'replied', 'interested', 'pending')
        AND c.name = ${senderName.trim()}
        AND c.status != 'stop'
      LIMIT 2
    `;
    if (byNameCampaign.length === 1) return byNameCampaign[0].phone;

    const byName = await sql<{ phone: string }[]>`
      SELECT phone FROM contacts
      WHERE user_id = ${userId} AND auto_reply = 1 AND status != 'stop' AND name = ${senderName.trim()}
      LIMIT 2
    `;
    if (byName.length === 1) return byName[0].phone;
  }

  // 3) Une seule cible contactée récemment dans une campagne active
  const campaignRecent = await sql<{ phone: string }[]>`
    SELECT t.target_id as phone
    FROM automation_targets t
    JOIN automations a ON a.id = t.automation_id AND a.user_id = t.user_id AND a.status = 'active'
    JOIN messages m ON m.user_id = t.user_id
      AND m.contact_phone = t.target_id
      AND m.direction = 'sortant'
      AND m.created_at >= NOW() - INTERVAL '72 hours'
    WHERE t.user_id = ${userId}
      AND t.status IN ('contacted', 'replied', 'interested')
    GROUP BY t.target_id
    HAVING COUNT(*) >= 1
    ORDER BY MAX(m.created_at) DESC
    LIMIT 3
  `;
  if (campaignRecent.length === 1) return campaignRecent[0].phone;

  // 4) Un seul contact auto_reply avec envoi récent (hors rafale)
  const recentOut = await sql<{ phone: string }[]>`
    SELECT m.contact_phone as phone
    FROM messages m
    JOIN contacts c ON c.user_id = m.user_id AND c.phone = m.contact_phone AND c.auto_reply = 1 AND c.status != 'stop'
    WHERE m.user_id = ${userId}
      AND m.direction = 'sortant'
      AND m.created_at >= NOW() - INTERVAL '15 minutes'
    GROUP BY m.contact_phone
    ORDER BY MAX(m.created_at) DESC
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
  const base = await getDailyOutboundLimit(userId);
  const bonus = await getOutboundQuotaBonus(userId);
  // Warmup : comptes récents plafonnés même si limite user plus haute
  let warmCap = base;
  try {
    const { getUserById } = await import("./users.js");
    const { warmupDailyCap } = await import("./anti-ban.js");
    const user = await getUserById(userId);
    if (user?.created_at) {
      const created = new Date(user.created_at.includes("T") ? user.created_at : user.created_at.replace(" ", "T"));
      if (!Number.isNaN(created.getTime())) {
        const days = (Date.now() - created.getTime()) / 86_400_000;
        warmCap = Math.min(base, warmupDailyCap(days));
      }
    }
  } catch {
    /* best effort */
  }
  return warmCap + bonus;
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

export async function getContactThread(
  userId: number,
  phone: string,
  limit = 100,
  automationId?: number | null
): Promise<WhatsAppMessage[]> {
  const trimmed = phone.trim();
  const chatId = trimmed.includes("@") ? trimmed : `${trimmed.replace(/\D/g, "")}@c.us`;
  return getContactChatHistory(userId, chatId, limit, automationId);
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
export const TARGET_STATUSES = [
  "pending",
  "queued",
  "contacted",
  "replied",
  "interested",
  "stopped",
  "error",
] as const;
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
  /** Stickers / emojis autorisés dans les réponses campagne. Défaut false. */
  stickersEnabled?: boolean;
  abVariants?: Array<{ id: string; message: string }>;
  sequenceSteps?: Array<{ delayDays: number; message: string; condition?: string }>;
  mediaUrl?: string;
  mediaType?: "image" | "document" | "audio";
  quietHoursStart?: number;
  quietHoursEnd?: number;
  /** ISO ou datetime locale : ne pas démarrer les openers avant cette date. */
  scheduledStartAt?: string;
  /** Plan graphique (nodes/edges) pour la carte visuelle — généré côté serveur. */
  /** ISO — simulation validée via le bouton UI (lancement). */
  simulationValidatedAt?: string;
  visualPlan?: {
    version: 1;
    title: string;
    updatedAt: string;
    automationId?: number;
    type?: string;
    nodes: Array<{ id: string; label: string; subtitle?: string; kind: string }>;
    edges: Array<{ from: string; to: string; label?: string }>;
  };
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
  /** ISO — dernier envoi email Resend du rapport quotidien. */
  emailReportSentAt?: string;
  report?: string;
  /** True une fois tous les premiers messages partis (campagne reste active). */
  openersDone?: boolean;
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
    id: Number(row.id),
    name: row.name,
    type: row.type as AutomationType,
    status: row.status as AutomationStatus,
    config,
    stats,
    summary: row.summary,
    budget_fcfa: Number(row.budget_fcfa),
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
    if (row.status === "pending" || row.status === "queued") stats.pending = (stats.pending ?? 0) + n;
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
    stats.emailReportSentAt = auto.stats.emailReportSentAt;
    stats.conversions = auto.stats.conversions;
    stats.revenueFcfa = auto.stats.revenueFcfa;
    stats.openersDone = auto.stats.openersDone;
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

/** Coupe tous les envois liés à une campagne (file, relances, réponses auto contact). */
export async function haltAutomationMessaging(
  userId: number,
  automationId: number
): Promise<{ cancelledQueue: number; cancelledSequences: number; disabledContacts: number }> {
  const queueResult = await sql`
    UPDATE send_queue SET status = 'cancelled', error = 'Campagne mise en pause'
    WHERE user_id = ${userId} AND automation_id = ${automationId} AND status = 'pending'
  `;
  const seqResult = await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
    WHERE user_id = ${userId} AND automation_id = ${automationId} AND status = 'active'
  `;
  const targets = await listAutomationTargets(userId, automationId, { limit: 2000 });
  let disabledContacts = 0;
  for (const t of targets) {
    try {
      await setContactAutoReply(userId, t.target_id, false);
      await saveContact(userId, {
        phone: t.target_id,
        name: t.target_label ?? undefined,
        autoReply: false,
      });
      await clearContactMemory(userId, t.target_id);
      disabledContacts++;
    } catch {
      /* best effort */
    }
  }
  await addAutomationLog(
    userId,
    automationId,
    "info",
    `Envois coupés : ${Number(queueResult.count)} file, ${Number(seqResult.count)} relance(s), ${disabledContacts} réponse(s) auto off.`
  );
  return {
    cancelledQueue: Number(queueResult.count),
    cancelledSequences: Number(seqResult.count),
    disabledContacts,
  };
}

/** Réactive les réponses auto pour TOUS les prospects non stoppés (campagne active = auto-reply obligatoire). */
export async function resumeAutomationMessaging(
  userId: number,
  automationId: number
): Promise<{ enabledContacts: number }> {
  const targets = await listAutomationTargets(userId, automationId, { limit: 5000 });
  let enabledContacts = 0;
  for (const t of targets) {
    if (t.status === "stopped" || t.status === "error") continue;
    try {
      await setContactAutoReply(userId, t.target_id, true);
      await saveContact(userId, {
        phone: t.target_id,
        name: t.target_label ?? undefined,
        status: t.status === "interested" ? "interesse" : "en_conversation",
        autoReply: true,
      });
      enabledContacts++;
    } catch {
      /* best effort */
    }
  }
  return { enabledContacts };
}

/** Pause utilisateur : statut paused + plus aucun message automatique + auto-reply OFF. */
export async function pauseAutomation(userId: number, id: number): Promise<Automation | null> {
  const updated = await updateAutomationStatus(userId, id, "paused");
  if (!updated) return null;
  // Auto-reply désactivé pour cette campagne
  await updateAutomationConfig(userId, id, {
    ...updated.config,
    enableAutoReply: false,
  });
  await haltAutomationMessaging(userId, id);
  return getAutomation(userId, id);
}

/** Reprise : active + auto-reply OBLIGATOIRE pour les prospects de la campagne. */
export async function resumeAutomation(userId: number, id: number): Promise<Automation | null> {
  const current = await getAutomation(userId, id);
  if (!current) return null;
  await updateAutomationConfig(userId, id, {
    ...current.config,
    enableAutoReply: true,
  });
  // Réactive aussi l'interrupteur GLOBAL (peut être OFF après un arrêt d'urgence)
  await setAutoReplyEnabled(userId, true);
  const updated = await updateAutomationStatus(userId, id, "active");
  if (!updated) return null;
  await resumeAutomationMessaging(userId, id);
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

/**
 * Trouve une cible de campagne pour un chatId (phone/@c.us/@lid).
 * Résout aussi les JID @lid via contacts.whatsapp_lid.
 */
export async function findMatchingAutomationTarget(
  userId: number,
  automationId: number,
  chatId: string,
  statuses?: TargetStatus[]
): Promise<AutomationTarget | null> {
  const raw = chatId.trim();
  const isLid = /@lid$/i.test(raw);
  let phoneHint = raw;

  if (isLid) {
    const resolved = await findProspectPhoneForLidReply(userId, raw);
    if (resolved) phoneHint = resolved;
  }

  const digits = phoneHint.replace(/\D/g, "");
  const lidNorm = isLid
    ? raw
    : digits.length >= 8
      ? `${digits}@lid`
      : "";

  const allowed = new Set(
    statuses?.length
      ? statuses
      : (["pending", "contacted", "replied", "interested"] as TargetStatus[])
  );

  const rows = await sql<Record<string, unknown>[]>`
    SELECT t.id, t.automation_id, t.target_id, t.target_label, t.status, t.last_action_at, t.notes, t.ab_variant, t.created_at
    FROM automation_targets t
    LEFT JOIN contacts c ON c.user_id = t.user_id AND c.phone = t.target_id
    WHERE t.user_id = ${userId}
      AND t.automation_id = ${automationId}
      AND (
        t.target_id = ${phoneHint}
        OR t.target_id = ${raw}
        OR (${digits.length >= 8} AND regexp_replace(t.target_id, '\\D', '', 'g') = ${digits})
        OR (${isLid} AND (c.whatsapp_lid = ${raw} OR c.whatsapp_lid = ${lidNorm}))
      )
    ORDER BY t.id ASC
    LIMIT 20
  `;

  for (const row of rows) {
    const mapped = mapAutomationTarget(row);
    if (allowed.has(mapped.status)) {
      // Mémoriser le LID pour les prochains messages
      if (isLid && mapped.target_id) {
        try {
          await setContactWhatsappLid(userId, mapped.target_id, raw);
        } catch {
          /* best effort */
        }
      }
      return mapped;
    }
  }
  return null;
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

/**
 * Claim atomique : pending → queued pour éviter 2 openers sur le même prospect
 * (race entre ticks moteur 15s).
 */
export async function claimNextPendingTarget(
  userId: number,
  automationId: number
): Promise<AutomationTarget | null> {
  // Débloque les claims abandonnés (crash entre claim et envoi)
  await sql`
    UPDATE automation_targets
    SET status = 'pending'
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND status = 'queued'
      AND last_action_at < NOW() - INTERVAL '3 minutes'
  `;
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE automation_targets
    SET status = 'queued', last_action_at = NOW()
    WHERE id = (
      SELECT id FROM automation_targets
      WHERE user_id = ${userId}
        AND automation_id = ${automationId}
        AND status = 'pending'
      ORDER BY id ASC
      LIMIT 1
    )
    RETURNING id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
  `;
  return rows[0] ? mapAutomationTarget(rows[0]) : null;
}

export async function addAutomationLog(
  userId: number,
  automationId: number,
  level: AutomationLog["level"],
  message: string
): Promise<AutomationLog> {
  // Anti-spam journal : ne pas répéter la même erreur toutes les 15 s
  if (level === "error" || level === "warning") {
    const recent = await sql<Record<string, unknown>[]>`
      SELECT id, automation_id, level, message, created_at
      FROM automation_logs
      WHERE user_id = ${userId}
        AND automation_id = ${automationId}
        AND level = ${level}
        AND message = ${message}
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY id DESC
      LIMIT 1
    `;
    if (recent[0]) return mapAutomationLog(recent[0]);
  }
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

/** Met à jour nom / résumé / budget sans toucher au type. */
export async function updateAutomationMeta(
  userId: number,
  id: number,
  patch: { name?: string; summary?: string; budgetFcfa?: number }
): Promise<Automation | null> {
  const current = await getAutomation(userId, id);
  if (!current) return null;
  const name = patch.name?.trim() || current.name;
  const summary =
    patch.summary !== undefined ? patch.summary.trim() || null : current.summary;
  const budget =
    patch.budgetFcfa != null && Number.isFinite(patch.budgetFcfa)
      ? patch.budgetFcfa
      : current.budget_fcfa;
  await sql`
    UPDATE automations
    SET name = ${name}, summary = ${summary}, budget_fcfa = ${budget}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${id}
  `;
  return getAutomation(userId, id);
}

/**
 * Trouve un brouillon / campagne réutilisable pour éviter les doublons.
 * Priorité : automation_id explicite → même groupe → même type brouillon unique.
 */
export async function findReusableAutomation(
  userId: number,
  type: AutomationType,
  opts: { automationId?: number; groupId?: string; name?: string; threadId?: number } = {}
): Promise<Automation | null> {
  if (opts.automationId != null && Number.isFinite(opts.automationId)) {
    const byId = await getAutomation(userId, opts.automationId);
    if (byId && byId.type === type) return byId;
  }

  if (opts.threadId != null) {
    const thread = await getAgentThread(userId, opts.threadId);
    if (!thread) return null;
    if (thread.automation_id) {
      const linked = await getAutomation(userId, thread.automation_id);
      if (linked && linked.type === type) return linked;
    }
    return null;
  }

  const open = await listAutomations(userId, { limit: 100 });
  const candidates = open.filter(
    (a) =>
      a.type === type &&
      (a.status === "draft" || a.status === "paused" || a.status === "active")
  );

  if (opts.groupId) {
    const byGroup = candidates.find((a) => a.config.groupId === opts.groupId);
    if (byGroup) return byGroup;
  }

  if (opts.name?.trim()) {
    const needle = opts.name.trim().toLowerCase();
    const byName = candidates.find((a) => a.name.trim().toLowerCase() === needle);
    if (byName) return byName;
  }

  const drafts = candidates.filter((a) => a.status === "draft");
  if (drafts.length === 1) return drafts[0];

  return null;
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
    if (!auto) continue;
    if (auto.type !== "group_prospect" && auto.type !== "contact_prospect") continue;
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

export async function listRecentCampaignOpeners(
  userId: number,
  automationId: number,
  limit = 30
): Promise<string[]> {
  const rows = await sql<{ message: string | null }[]>`
    SELECT message FROM send_queue
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND sequence_id IS NULL
      AND status IN ('sent', 'pending', 'processing')
      AND message IS NOT NULL
      AND length(trim(message)) > 0
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => String(r.message ?? "").trim()).filter(Boolean);
}

export async function cancelPendingSendQueueForRecipient(
  userId: number,
  recipient: string
): Promise<number> {
  const digits = recipient.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const result = await sql`
    UPDATE send_queue
    SET status = 'cancelled', error = 'Doublon / remplacé'
    WHERE user_id = ${userId}
      AND status = 'pending'
      AND (
        recipient = ${recipient}
        OR (${digits} != '' AND replace(replace(recipient, '@c.us', ''), '@lid', '') = ${digits})
      )
  `;
  return Number(result.count);
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
  // Anti-doublon : une seule ligne pending par destinataire (sauf urgence manuelle).
  if ((input.priority ?? 5) < 10) {
    await cancelPendingSendQueueForRecipient(userId, input.recipient);
  }
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
  const rows = await sql<Array<{ id: number }>>`
    SELECT id FROM automations
    WHERE user_id = ${userId} AND status = 'active'
  `;
  for (const row of rows) {
    await pauseAutomation(userId, Number(row.id));
  }
  return rows.length;
}

export interface SequenceStep {
  delayDays: number;
  message: string;
  /** no_reply = tant que le prospect n'a pas répondu ; stale_after_reply = silence après un échange ; always = toujours */
  condition?: "no_reply" | "stale_after_reply" | "always";
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
  // Une seule séquence active par contact
  await cancelSequencesForContact(userId, phone);
  // Jamais de relance le jour même (delayDays 0 = spam)
  const safeSteps = input.steps.map((s) => ({
    ...s,
    delayDays: Math.max(1, Number(s.delayDays) || 1),
  }));
  const firstDelay = safeSteps[0]?.delayDays ?? 1;
  const sendHour = await getRelanceHourForAutomation(userId, input.automationId);
  const nextAt = computeSequenceNextAt(firstDelay, sendHour);
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO contact_sequences (user_id, contact_phone, automation_id, name, steps_json, next_step_at)
    VALUES (
      ${userId},
      ${phone},
      ${input.automationId ?? null},
      ${input.name},
      ${JSON.stringify(safeSteps)},
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

/** Repousse une séquence (ex. entrant encore non traité par l'auto-reply). */
export async function postponeSequence(
  userId: number,
  id: number,
  hours = 2
): Promise<void> {
  const next = new Date(Date.now() + Math.max(1, hours) * 3600_000);
  await sql`
    UPDATE contact_sequences
    SET next_step_at = ${next}
    WHERE user_id = ${userId} AND id = ${id} AND status = 'active'
  `;
}

/** Remet en file les séquences actives coincées sans next_step_at. */
export async function repairStuckSequences(userId: number): Promise<number> {
  const result = await sql`
    UPDATE contact_sequences
    SET next_step_at = NOW() + INTERVAL '15 minutes'
    WHERE user_id = ${userId}
      AND status = 'active'
      AND next_step_at IS NULL
  `;
  return Number(result.count ?? 0);
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
