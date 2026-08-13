import { sql } from "./pg.js";
import { config, evolutionInstanceName } from "./config.js";
import { getUserById } from "./users.js";
import { matchesAnyTriggerPhrase } from "./phrase-matching.js";

export const DAILY_OUTBOUND_LIMIT = 25; // legacy — plafonds réels = niveau / essai
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
      await sql`ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS purpose TEXT`;
      await sql`ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS campaign_memory_id BIGINT`;
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

/** Intention du fil choisie à la création — force le briefing / type de campagne. */
export type AgentThreadPurpose = "prospection" | "support" | "groupes";

export function normalizeThreadPurpose(raw: unknown): AgentThreadPurpose | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "prospection" || v === "support" || v === "groupes") return v;
  return null;
}

export interface AgentThread {
  id: number;
  user_id: number;
  title: string;
  description?: string | null;
  /** null = fils legacy (heuristique chat). */
  purpose?: AgentThreadPurpose | null;
  automation_id: number | null;
  /** Mémoire explicitement liée à ce fil (null = pas encore connectée). */
  campaign_memory_id?: number | null;
  campaign_memory_name?: string | null;
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
  const memName =
    row.campaign_memory_name != null ? String(row.campaign_memory_name).trim() : "";
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    title: sanitizeThreadTitle(String(row.title)),
    description: desc || null,
    purpose: normalizeThreadPurpose(row.purpose),
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
    campaign_memory_id:
      row.campaign_memory_id != null ? Number(row.campaign_memory_id) : null,
    campaign_memory_name: memName || null,
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
      t.id, t.user_id, t.title, t.description, t.purpose, t.automation_id,
      t.campaign_memory_id, t.created_at, t.updated_at,
      a.status AS automation_status,
      a.name AS automation_name,
      cm.name AS campaign_memory_name
    FROM agent_threads t
    LEFT JOIN automations a ON a.id = t.automation_id AND a.user_id = t.user_id
    LEFT JOIN campaign_memories cm ON cm.id = t.campaign_memory_id AND cm.user_id = t.user_id
    WHERE t.user_id = ${userId}
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT ${limit}
  `;
  return rows.map(mapAgentThread);
}

export async function getAgentThread(userId: number, threadId: number): Promise<AgentThread | null> {
  await ensureAgentThreadsSchema().catch(() => {});
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      t.id, t.user_id, t.title, t.description, t.purpose, t.automation_id,
      t.campaign_memory_id, t.created_at, t.updated_at,
      a.status AS automation_status,
      a.name AS automation_name,
      cm.name AS campaign_memory_name
    FROM agent_threads t
    LEFT JOIN automations a ON a.id = t.automation_id AND a.user_id = t.user_id
    LEFT JOIN campaign_memories cm ON cm.id = t.campaign_memory_id AND cm.user_id = t.user_id
    WHERE t.user_id = ${userId} AND t.id = ${threadId}
    LIMIT 1
  `;
  return rows[0] ? mapAgentThread(rows[0]) : null;
}

export async function createAgentThread(
  userId: number,
  title = "Automatisation",
  description?: string | null,
  purpose?: AgentThreadPurpose | null
): Promise<AgentThread> {
  await ensureAgentThreadsSchema().catch(() => {});
  const cleanTitle = sanitizeThreadTitle(title);
  const cleanDesc = description?.trim().slice(0, 280) || null;
  const cleanPurpose = normalizeThreadPurpose(purpose);
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_threads (user_id, title, description, purpose)
    VALUES (${userId}, ${cleanTitle}, ${cleanDesc}, ${cleanPurpose})
    RETURNING id, user_id, title, description, purpose, automation_id, created_at, updated_at
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
    RETURNING id, user_id, title, description, purpose, automation_id, created_at, updated_at
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
  let safeContent = content;
  if (role === "assistant") {
    const { userSafeAssistantText, containsDsmlToolMarkup } = await import(
      "./dsml-tool-calls.js"
    );
    if (containsDsmlToolMarkup(content)) {
      console.warn(
        `[db] strip DSML avant persistance (thread=${threadId}): ${content.slice(0, 80)}…`,
      );
    }
    safeContent = userSafeAssistantText(
      content,
      "Je finalise l'action… Relance-moi si rien ne bouge.",
    );
  }
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO agent_conversation (user_id, thread_id, role, content)
    VALUES (${userId}, ${threadId}, ${role}, ${safeContent})
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
  // Lifetime level : tous les sortants comptabilisés
  if (input.direction === "sortant" && countsTowardQuota === 1) {
    void import("./users.js")
      .then((m) => m.recordOutboundMessageSent(userId))
      .catch((err) => console.warn("[outreach] recordOutboundMessageSent:", err));
  }
  return mapWhatsAppMessage(rows[0]);
}

export async function whatsAppMessageExists(userId: number, greenApiId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM messages WHERE user_id = ${userId} AND green_api_id = ${greenApiId} LIMIT 1`;
  return rows.length > 0;
}

/** Un seul aller-retour au lieu de N EXISTS sur le poller. */
export async function existingWhatsAppMessageIds(
  userId: number,
  greenApiIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(greenApiIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await sql<{ green_api_id: string }[]>`
    SELECT green_api_id FROM messages
    WHERE user_id = ${userId} AND green_api_id IN ${sql(ids)}
  `;
  return new Set(rows.map((r) => String(r.green_api_id)));
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

/** Compte les messages d'une campagne sur une fenêtre [from, toExclusive). */
export async function countAutomationMessagesInRange(
  userId: number,
  automationId: number,
  from: Date,
  toExclusive: Date
): Promise<{ outbound: number; inbound: number }> {
  const rows = await sql<Array<{ direction: string; n: number }>>`
    SELECT direction, COUNT(*)::int as n
    FROM messages
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND created_at >= ${from}
      AND created_at < ${toExclusive}
    GROUP BY direction
  `;
  let outbound = 0;
  let inbound = 0;
  for (const row of rows) {
    if (row.direction === "sortant") outbound = Number(row.n);
    else if (row.direction === "entrant") inbound = Number(row.n);
  }
  return { outbound, inbound };
}

export async function countUserMessagesInRange(
  userId: number,
  from: Date,
  toExclusive: Date
): Promise<{ outbound: number; inbound: number }> {
  const rows = await sql<Array<{ direction: string; n: number }>>`
    SELECT direction, COUNT(*)::int as n
    FROM messages
    WHERE user_id = ${userId}
      AND created_at >= ${from}
      AND created_at < ${toExclusive}
    GROUP BY direction
  `;
  let outbound = 0;
  let inbound = 0;
  for (const row of rows) {
    if (row.direction === "sortant") outbound = Number(row.n);
    else if (row.direction === "entrant") inbound = Number(row.n);
  }
  return { outbound, inbound };
}

export type CampaignAnalyticsDay = {
  date: string;
  /** Personnes distinctes ayant écrit ce jour (messages entrants). */
  discussing: number;
  /** Nouveaux atteints (1er message sortant campagne ce jour). */
  newlyReached: number;
  /** Nouvelles réponses (1er message entrant campagne ce jour). */
  newlyAnswered: number;
  /** Cibles passées intéressées ce jour (last_action_at). */
  newlyInterested: number;
  inboundMessages: number;
  outboundMessages: number;
};

export type CampaignAnalytics = {
  from: string;
  to: string;
  summary: {
    /** Personnes distinctes ayant écrit au moins 1 fois dans la période. */
    discussing: number;
    /** Lifetime (hors filtre) — même définition. */
    discussingLifetime: number;
    inboundMessages: number;
    outboundMessages: number;
    newlyReached: number;
    newlyAnswered: number;
    newlyInterested: number;
  };
  series: CampaignAnalyticsDay[];
};

function startOfUtcDayFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0));
}

function addUtcDaysDate(d: Date, days: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function dateKeyUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Normalise une clé jour renvoyée par Postgres (string, Date, ISO…). */
function normalizeAnalyticsDayKey(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return dateKeyUtc(raw);
  }
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1]!;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return dateKeyUtc(d);
  return null;
}

/**
 * Analytics campagne sur [from, toExclusive) :
 * - discussing = COUNT DISTINCT contacts ayant écrit (entrant) — pas messagesHandled
 * - séries journalières pour graphes de temporalité
 */
export function resolveCampaignAnalyticsWindow(opts: {
  range?: string;
  from?: string;
  to?: string;
  campaignCreatedAt?: string;
  now?: Date;
}): { from: Date; toExclusive: Date; range: string } {
  const now = opts.now ?? new Date();
  const endExclusive = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );

  const parseKey = (raw?: string): Date | null => {
    const s = raw?.trim();
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const customFrom = parseKey(opts.from);
  const customTo = parseKey(opts.to);
  if (customFrom && customTo) {
    const toEx = addUtcDaysDate(customTo, 1);
    if (toEx > customFrom) {
      return { from: customFrom, toExclusive: toEx, range: "custom" };
    }
  }

  const range = (opts.range || "30d").toLowerCase();
  if (range === "all") {
    let from = parseKey(opts.campaignCreatedAt?.slice(0, 10));
    if (!from && opts.campaignCreatedAt) {
      const d = new Date(
        opts.campaignCreatedAt.includes("T")
          ? opts.campaignCreatedAt
          : opts.campaignCreatedAt.replace(" ", "T")
      );
      if (!Number.isNaN(d.getTime())) {
        from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      }
    }
    if (!from) {
      from = addUtcDaysDate(endExclusive, -365);
    }
    return { from, toExclusive: endExclusive, range: "all" };
  }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const from = addUtcDaysDate(endExclusive, -days);
  return { from, toExclusive: endExclusive, range: `${days}d` };
}

/**
 * Analytics campagne sur [from, toExclusive) :
 * - discussing = COUNT DISTINCT contacts ayant écrit (entrant) — pas messagesHandled
 * - séries journalières pour graphes de temporalité
 */
export async function getCampaignAnalytics(
  userId: number,
  automationId: number,
  from: Date,
  toExclusive: Date
): Promise<CampaignAnalytics> {
  await ensureContactAutomationStateSchema().catch(() => {});

  const [discussingRow] = await sql<Array<{ n: number }>>`
    SELECT COUNT(DISTINCT contact_phone)::int AS n
    FROM messages
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND direction = 'entrant'
      AND created_at >= ${from}
      AND created_at < ${toExclusive}
  `;

  const [discussingLifetimeRow] = await sql<Array<{ n: number }>>`
    SELECT COUNT(DISTINCT contact_phone)::int AS n
    FROM messages
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND direction = 'entrant'
  `;

  const msgCounts = await countAutomationMessagesInRange(
    userId,
    automationId,
    from,
    toExclusive
  );

  const [reachedRow] = await sql<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT contact_phone, MIN(created_at) AS first_at
      FROM messages
      WHERE user_id = ${userId}
        AND automation_id = ${automationId}
        AND direction = 'sortant'
        AND COALESCE(counts_toward_quota, 1) = 1
      GROUP BY contact_phone
    ) t
    WHERE first_at >= ${from} AND first_at < ${toExclusive}
  `;

  const [answeredRow] = await sql<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT contact_phone, MIN(created_at) AS first_at
      FROM messages
      WHERE user_id = ${userId}
        AND automation_id = ${automationId}
        AND direction = 'entrant'
      GROUP BY contact_phone
    ) t
    WHERE first_at >= ${from} AND first_at < ${toExclusive}
  `;

  const [interestedRow] = await sql<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n
    FROM automation_targets
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND status = 'interested'
      AND last_action_at IS NOT NULL
      AND last_action_at >= ${from}
      AND last_action_at < ${toExclusive}
  `;

  const dailyMsgs = await sql<
    Array<{ d: string; direction: string; msgs: number; people: number }>
  >`
    SELECT
      to_char((created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d,
      direction,
      COUNT(*)::int AS msgs,
      COUNT(DISTINCT contact_phone)::int AS people
    FROM messages
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND created_at >= ${from}
      AND created_at < ${toExclusive}
    GROUP BY 1, direction
    ORDER BY d ASC
  `;

  const dailyFirstOut = await sql<Array<{ d: string; n: number }>>`
    SELECT to_char((first_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
    FROM (
      SELECT contact_phone, MIN(created_at) AS first_at
      FROM messages
      WHERE user_id = ${userId}
        AND automation_id = ${automationId}
        AND direction = 'sortant'
        AND COALESCE(counts_toward_quota, 1) = 1
      GROUP BY contact_phone
    ) t
    WHERE first_at >= ${from} AND first_at < ${toExclusive}
    GROUP BY 1
    ORDER BY d ASC
  `;

  const dailyFirstIn = await sql<Array<{ d: string; n: number }>>`
    SELECT to_char((first_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
    FROM (
      SELECT contact_phone, MIN(created_at) AS first_at
      FROM messages
      WHERE user_id = ${userId}
        AND automation_id = ${automationId}
        AND direction = 'entrant'
      GROUP BY contact_phone
    ) t
    WHERE first_at >= ${from} AND first_at < ${toExclusive}
    GROUP BY 1
    ORDER BY d ASC
  `;

  const dailyInterested = await sql<Array<{ d: string; n: number }>>`
    SELECT to_char((last_action_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
    FROM automation_targets
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND status = 'interested'
      AND last_action_at IS NOT NULL
      AND last_action_at >= ${from}
      AND last_action_at < ${toExclusive}
    GROUP BY 1
    ORDER BY d ASC
  `;

  const byDay = new Map<string, CampaignAnalyticsDay>();
  const ensure = (key: string): CampaignAnalyticsDay => {
    let row = byDay.get(key);
    if (!row) {
      row = {
        date: key,
        discussing: 0,
        newlyReached: 0,
        newlyAnswered: 0,
        newlyInterested: 0,
        inboundMessages: 0,
        outboundMessages: 0,
      };
      byDay.set(key, row);
    }
    return row;
  };

  for (const row of dailyMsgs) {
    const key = normalizeAnalyticsDayKey(row.d);
    if (!key) continue;
    const day = ensure(key);
    if (row.direction === "entrant") {
      day.inboundMessages = Number(row.msgs);
      day.discussing = Number(row.people);
    } else if (row.direction === "sortant") {
      day.outboundMessages = Number(row.msgs);
    }
  }
  for (const row of dailyFirstOut) {
    const key = normalizeAnalyticsDayKey(row.d);
    if (key) ensure(key).newlyReached = Number(row.n);
  }
  for (const row of dailyFirstIn) {
    const key = normalizeAnalyticsDayKey(row.d);
    if (key) ensure(key).newlyAnswered = Number(row.n);
  }
  for (const row of dailyInterested) {
    const key = normalizeAnalyticsDayKey(row.d);
    if (key) ensure(key).newlyInterested = Number(row.n);
  }

  // Remplir tous les jours de la fenêtre (zéros inclus) — clés UTC alignées SQL
  const fromKey = dateKeyUtc(from);
  const lastInclusive = addUtcDaysDate(toExclusive, -1);
  const toKey = dateKeyUtc(lastInclusive);
  let cursor = startOfUtcDayFromKey(fromKey);
  const end = startOfUtcDayFromKey(toKey);
  const series: CampaignAnalyticsDay[] = [];
  // Garde-fou : max 366 jours
  for (let i = 0; i < 370 && cursor.getTime() <= end.getTime(); i++) {
    const key = dateKeyUtc(cursor);
    series.push(ensure(key));
    cursor = addUtcDaysDate(cursor, 1);
  }

  return {
    from: fromKey,
    to: toKey,
    summary: {
      discussing: Number(discussingRow?.n ?? 0),
      discussingLifetime: Number(discussingLifetimeRow?.n ?? 0),
      inboundMessages: msgCounts.inbound,
      outboundMessages: msgCounts.outbound,
      newlyReached: Number(reachedRow?.n ?? 0),
      newlyAnswered: Number(answeredRow?.n ?? 0),
      newlyInterested: Number(interestedRow?.n ?? 0),
    },
    series,
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

/**
 * Dernier message WhatsApp du contact, toutes campagnes confondues
 * (anti double-opener sur le même fil).
 */
export async function getAbsoluteLastMessageForContact(
  userId: number,
  chatId: string
): Promise<WhatsAppMessage | null> {
  const digits = chatId.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, contact_phone, sender_name, direction, body, green_api_id, automation_id, created_at
    FROM messages
    WHERE user_id = ${userId}
      AND (contact_phone = ${chatId}
       OR (${digits} != '' AND (
         contact_phone = ${digits} || '@c.us'
         OR contact_phone = ${digits} || '@lid'
         OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
       )))
    ORDER BY id DESC
    LIMIT 1
  `;
  return rows[0] ? mapWhatsAppMessage(rows[0]) : null;
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

function canonicalizeContactDigits(digits: string): string {
  let d = digits.replace(/\D/g, "");
  // Bénin : +229 01 XX XX XX XX (13 chiffres) → +229XXXXXXXX
  if (d.startsWith("22901") && (d.length === 13 || d.length === 14)) {
    d = `229${d.slice(5)}`;
  }
  return d;
}

function normalizeContactPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.endsWith("@g.us")) {
    throw new Error("Les groupes WhatsApp ne peuvent pas être enregistrés comme contacts de prospection.");
  }
  if (trimmed.endsWith("@lid")) return trimmed;
  if (trimmed.endsWith("@c.us")) {
    const digits = canonicalizeContactDigits(trimmed.replace(/@c\.us/gi, ""));
    if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
    if (digits.length >= 8) return `${digits}@lid`;
    return trimmed;
  }
  if (trimmed.endsWith("@s.whatsapp.net")) {
    const digits = canonicalizeContactDigits(trimmed.replace(/@s\.whatsapp\.net/gi, ""));
    if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
    if (digits.length >= 8) return `${digits}@lid`;
  }
  if (trimmed.includes("@")) {
    const digits = canonicalizeContactDigits(trimmed.replace(/@\w+/g, ""));
    if (digits.length >= 8 && digits.length <= 13) return `${digits}@c.us`;
    if (digits.length >= 8) return `${digits}@lid`;
    return trimmed;
  }
  const digits = canonicalizeContactDigits(trimmed);
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

/** Dernier pushName WhatsApp vu sur un message entrant de ce chat. */
export async function getLatestInboundSenderName(
  userId: number,
  chatId: string,
): Promise<string | null> {
  const digits = chatId.replace(/\D/g, "").slice(0, 15);
  const rows = await sql`
    SELECT sender_name
    FROM messages
    WHERE user_id = ${userId}
      AND direction = 'entrant'
      AND sender_name IS NOT NULL
      AND TRIM(sender_name) <> ''
      AND (
        contact_phone = ${chatId}
        OR contact_phone LIKE ${"%" + digits + "%"}
      )
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const name = rows[0]?.sender_name != null ? String(rows[0].sender_name).trim() : "";
  return name || null;
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
          status = 'en_conversation',
          auto_reply = 1,
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
        status = 'en_conversation',
        auto_reply = 1,
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

/** Pointeur routage réponses auto → campagne courante (n'efface pas les états des autres campagnes). */
export async function setConversationCampaignId(
  userId: number,
  phone: string,
  automationId: number
): Promise<void> {
  await ensureConversationEpochColumns();
  const chatId = normalizeContactPhone(phone);
  await sql`
    UPDATE contacts
    SET conversation_campaign_id = ${automationId},
        updated_at = NOW()
    WHERE user_id = ${userId} AND phone = ${chatId}
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
  // Compat anciens appels : renvoie le plafond « nouveaux fils sortants » du jour
  const caps = await getUserDailyConversationCaps(userId);
  return caps.outbound;
}

function outboundQuotaBonusKey(): string {
  return `outbound_quota_bonus_${formatLocalDateTime(new Date()).slice(0, 10)}`;
}

function newConversationsKey(kind: "outbound" | "inbound"): string {
  const day = formatLocalDateTime(new Date()).slice(0, 10);
  return `new_${kind}_conversations_${day}`;
}

export async function getOutboundQuotaBonus(userId: number): Promise<number> {
  const n = Number((await getSetting(userId, outboundQuotaBonusKey())) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function trialGroupExtractKey(): string {
  return `trial_group_extract_${formatLocalDateTime(new Date()).slice(0, 10)}`;
}

function parseTrialGroupExtractIds(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { groupIds?: unknown }).groupIds)) {
      return ((parsed as { groupIds: unknown[] }).groupIds).map(String).filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Essai : 1 groupe WhatsApp distinct extractible / jour (relecture du même groupe OK).
 * Abonnement actif / expiré hors essai → pas de plafond.
 */
export async function tryConsumeTrialGroupExtract(
  userId: number,
  groupId: string
): Promise<{ ok: true; reused: boolean } | { ok: false; reason: string; limit: number }> {
  const { getUserById } = await import("./users.js");
  const { TRIAL_MAX_GROUP_EXTRACTS_PER_DAY } = await import("./outreach-level.js");
  const user = await getUserById(userId);
  if (!user || user.subscription_status !== "trial") {
    return { ok: true, reused: false };
  }

  const gid = String(groupId || "").trim();
  if (!gid) {
    return {
      ok: false,
      reason: "Groupe invalide pour l'extraction.",
      limit: TRIAL_MAX_GROUP_EXTRACTS_PER_DAY,
    };
  }

  const key = trialGroupExtractKey();
  const used = parseTrialGroupExtractIds(await getSetting(userId, key));
  if (used.includes(gid)) {
    return { ok: true, reused: true };
  }
  if (used.length >= TRIAL_MAX_GROUP_EXTRACTS_PER_DAY) {
    return {
      ok: false,
      reason:
        `Essai gratuit : extraction limitée à ${TRIAL_MAX_GROUP_EXTRACTS_PER_DAY} groupe WhatsApp par jour. ` +
        `Vous avez déjà extrait un groupe aujourd'hui — réessayez demain, ou activez votre abonnement pour extraire sans limite.`,
      limit: TRIAL_MAX_GROUP_EXTRACTS_PER_DAY,
    };
  }

  used.push(gid);
  await setSetting(userId, key, JSON.stringify({ groupIds: used }));
  return { ok: true, reused: false };
}

export async function getTrialGroupExtractSnapshot(userId: number): Promise<{
  trial: boolean;
  usedToday: number;
  limit: number;
  remainingToday: number;
  groupIdsToday: string[];
}> {
  const { getUserById } = await import("./users.js");
  const { TRIAL_MAX_GROUP_EXTRACTS_PER_DAY } = await import("./outreach-level.js");
  const user = await getUserById(userId);
  const trial = user?.subscription_status === "trial";
  if (!trial) {
    return {
      trial: false,
      usedToday: 0,
      limit: TRIAL_MAX_GROUP_EXTRACTS_PER_DAY,
      remainingToday: TRIAL_MAX_GROUP_EXTRACTS_PER_DAY,
      groupIdsToday: [],
    };
  }
  const groupIdsToday = parseTrialGroupExtractIds(await getSetting(userId, trialGroupExtractKey()));
  const usedToday = groupIdsToday.length;
  return {
    trial: true,
    usedToday,
    limit: TRIAL_MAX_GROUP_EXTRACTS_PER_DAY,
    remainingToday: Math.max(0, TRIAL_MAX_GROUP_EXTRACTS_PER_DAY - usedToday),
    groupIdsToday,
  };
}

/** Plafonds journaliers (nouveaux fils) selon niveau — ou illimités côté niveau en essai. */
export async function getUserDailyConversationCaps(
  userId: number
): Promise<{ inbound: number; outbound: number; trial: boolean; level: number }> {
  const { getUserById } = await import("./users.js");
  const { dailyCapsForLevel, TRIAL_MAX_CONVERSATIONS } = await import("./outreach-level.js");
  const user = await getUserById(userId);
  if (!user || user.subscription_status === "trial") {
    // Essai : le plafond à vie (TRIAL_MAX_CONVERSATIONS) remplace le système de niveau
    return {
      inbound: TRIAL_MAX_CONVERSATIONS,
      outbound: TRIAL_MAX_CONVERSATIONS,
      trial: true,
      level: user?.outreach_level ?? 1,
    };
  }
  const caps = dailyCapsForLevel(user.outreach_level);
  return { ...caps, trial: false, level: user.outreach_level };
}

export async function getEffectiveOutboundLimit(userId: number): Promise<number> {
  const caps = await getUserDailyConversationCaps(userId);
  const bonus = await getOutboundQuotaBonus(userId);
  return caps.outbound + bonus;
}

/** Snapshot niveau / plafonds pour le contexte agent (chiffres réels, pas d'invention). */
export async function getOutreachQuotaSnapshot(userId: number): Promise<{
  subscriptionStatus: string;
  trial: boolean;
  trialConversationsUsed: number;
  trialConversationsMax: number;
  trialConversationsRemaining: number;
  outreachLevel: number;
  totalMessagesSent: number;
  messagesUntilNextLevel: number | null;
  dailyNewOutboundUsed: number;
  dailyNewOutboundCap: number;
  dailyNewOutboundRemaining: number;
  dailyNewInboundUsed: number;
  dailyNewInboundCap: number;
  dailyNewInboundRemaining: number;
  outboundBonusToday: number;
  summaryForAgent: string;
}> {
  const { getUserById } = await import("./users.js");
  const { messagesUntilNextLevel, TRIAL_MAX_CONVERSATIONS, LEVEL_DAILY_CAPS } =
    await import("./outreach-level.js");
  const user = await getUserById(userId);
  const caps = await getUserDailyConversationCaps(userId);
  const bonus = await getOutboundQuotaBonus(userId);
  const outUsed = await countNewConversationsToday(userId, "outbound");
  const inUsed = await countNewConversationsToday(userId, "inbound");
  const outCap = caps.outbound + bonus;
  const inCap = caps.inbound;
  const total = user?.total_messages_sent ?? 0;
  const level = user?.outreach_level ?? caps.level ?? 1;
  const trial = caps.trial || user?.subscription_status === "trial";
  const trialUsed = user?.trial_conversations_used ?? 0;
  const trialRemaining = Math.max(0, TRIAL_MAX_CONVERSATIONS - trialUsed);
  const untilNext = messagesUntilNextLevel(total);

  const levelTable = ([1, 2, 3, 4, 5] as const)
    .map((lv) => {
      const c = LEVEL_DAILY_CAPS[lv];
      return `L${lv}: ${c.outbound} sortants / ${c.inbound} entrants (nouveaux fils/jour)`;
    })
    .join(" · ");

  let summary: string;
  const groupExtract = await getTrialGroupExtractSnapshot(userId);

  if (trial) {
    summary =
      `Compte en ESSAI (trial). Plafond : ${TRIAL_MAX_CONVERSATIONS} nouvelles conversations à vie ` +
      `(utilisées ${trialUsed}, restantes ${trialRemaining}). ` +
      `Extraction groupes WhatsApp : ${groupExtract.limit} groupe distinct / jour ` +
      `(aujourd'hui ${groupExtract.usedToday}/${groupExtract.limit}, restantes ${groupExtract.remainingToday}). ` +
      `Les plafonds journaliers par niveau ne s'appliquent qu'après passage en abonnement actif. ` +
      `Niveau lifetime actuel (messages sortants comptés) : ${level}/5, total envoyé : ${total}` +
      (untilNext != null ? `, encore ${untilNext} message(s) sortant(s) avant le niveau suivant.` : " (niveau max).") +
      ` Aujourd'hui nouveaux fils : sortants ${outUsed}, entrants ${inUsed}. ` +
      `IMPORTANT : le plafond compte les NOUVEAUX fils (1ʳᵉ prise de contact), pas chaque message dans un fil déjà ouvert.`;
  } else {
    summary =
      `Niveau outreach ${level}/5 (lifetime messages sortants : ${total}` +
      (untilNext != null ? `, encore ${untilNext} avant le prochain niveau` : ", niveau max") +
      `). Aujourd'hui nouveaux fils sortants : ${outUsed}/${outCap}` +
      (bonus > 0 ? ` (dont bonus +${bonus})` : "") +
      ` → restants ${Math.max(0, outCap - outUsed)}. ` +
      `Nouveaux fils entrants : ${inUsed}/${inCap} → restants ${Math.max(0, inCap - inUsed)}. ` +
      `Référence niveaux : ${levelTable}. ` +
      `IMPORTANT : ces plafonds = NOUVEAUX fils uniquement (pas les réponses dans un fil déjà ouvert). ` +
      `Ne jamais inventer d'autres chiffres (15, 25, 50…) — utiliser UNIQUEMENT ces valeurs.`;
  }

  return {
    subscriptionStatus: user?.subscription_status ?? "trial",
    trial,
    trialConversationsUsed: trialUsed,
    trialConversationsMax: TRIAL_MAX_CONVERSATIONS,
    trialConversationsRemaining: trialRemaining,
    outreachLevel: level,
    totalMessagesSent: total,
    messagesUntilNextLevel: untilNext,
    dailyNewOutboundUsed: outUsed,
    dailyNewOutboundCap: outCap,
    dailyNewOutboundRemaining: Math.max(0, outCap - outUsed),
    dailyNewInboundUsed: inUsed,
    dailyNewInboundCap: inCap,
    dailyNewInboundRemaining: Math.max(0, inCap - inUsed),
    outboundBonusToday: bonus,
    summaryForAgent: summary,
  };
}

export async function setDailyOutboundLimit(userId: number, limit: number): Promise<number> {
  // Conservé pour API legacy — n'écrase plus le système de niveau
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
  const sent = await countNewConversationsToday(userId, "outbound");
  const limit = await getEffectiveOutboundLimit(userId);
  const needed = Math.max(0, sent - limit);
  const bonus = needed + extra;
  await setSetting(userId, outboundQuotaBonusKey(), String(bonus));
  return { sent, limit, bonus, effectiveLimit: limit + bonus };
}

/** @deprecated Prefer countNewConversationsToday — legacy = messages sortants du jour. */
export async function countOutboundToday(userId: number): Promise<number> {
  return countNewConversationsToday(userId, "outbound");
}

export async function countNewConversationsToday(
  userId: number,
  kind: "outbound" | "inbound"
): Promise<number> {
  const n = Number((await getSetting(userId, newConversationsKey(kind))) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function incrementNewConversationsToday(
  userId: number,
  kind: "outbound" | "inbound"
): Promise<number> {
  const key = newConversationsKey(kind);
  const cur = await countNewConversationsToday(userId, kind);
  const next = cur + 1;
  await setSetting(userId, key, String(next));
  return next;
}

async function conversationEpochForContact(
  userId: number,
  phone: string,
  automationId?: number | null
): Promise<Date> {
  await ensureConversationEpochColumns().catch(() => {});
  if (automationId != null) {
    await ensureContactAutomationStateSchema().catch(() => {});
    const state = await getContactAutomationState(userId, phone, automationId);
    if (state?.conversation_epoch_at) {
      return parseLocalDateTime(state.conversation_epoch_at);
    }
  }
  const contact = await getContact(userId, phone);
  if (contact?.conversation_epoch_at) {
    return parseLocalDateTime(contact.conversation_epoch_at);
  }
  return new Date(0);
}

/**
 * Vrai si aucun sortant comptabilisé n'existe encore dans l'époque courante
 * pour ce contact (+ automation si fournie) → démarrage d'un nouveau fil.
 */
export async function isStartingNewConversation(
  userId: number,
  chatId: string,
  automationId?: number | null
): Promise<boolean> {
  // Groupes / chaînes : pas des contacts prospects — ne jamais passer par normalizeContactPhone.
  const trimmedChat = chatId.trim();
  if (trimmedChat.endsWith("@g.us") || trimmedChat.includes("@newsletter")) {
    return false;
  }
  const phone = normalizeContactPhone(chatId);
  const digits = phone.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const epochIso = await conversationEpochForContact(userId, phone, automationId);

  const phoneMatch = sql`
    (contact_phone = ${phone}
      OR (${digits} != '' AND (
        contact_phone = ${digits} || '@c.us'
        OR contact_phone = ${digits} || '@lid'
        OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
      )))
  `;

  if (automationId != null) {
    const rows = await sql<{ x: number }[]>`
      SELECT 1 as x FROM messages
      WHERE user_id = ${userId}
        AND ${phoneMatch}
        AND direction = 'sortant'
      AND COALESCE(counts_toward_quota, 1) = 1
        AND automation_id = ${automationId}
        AND created_at >= ${epochIso}
      LIMIT 1
    `;
    return rows.length === 0;
  }

  const rows = await sql<{ x: number }[]>`
    SELECT 1 as x FROM messages
    WHERE user_id = ${userId}
      AND ${phoneMatch}
      AND direction = 'sortant'
      AND COALESCE(counts_toward_quota, 1) = 1
      AND created_at >= ${epochIso}
    LIMIT 1
  `;
  return rows.length === 0;
}

async function hasInboundInEpoch(
  userId: number,
  phone: string,
  automationId: number | null | undefined,
  epochIso: Date
): Promise<boolean> {
  const digits = phone.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const phoneMatch = sql`
    (contact_phone = ${phone}
      OR (${digits} != '' AND (
        contact_phone = ${digits} || '@c.us'
        OR contact_phone = ${digits} || '@lid'
        OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ${digits}
      )))
  `;
  if (automationId != null) {
    const rows = await sql<{ x: number }[]>`
      SELECT 1 as x FROM messages
      WHERE user_id = ${userId}
        AND ${phoneMatch}
        AND direction = 'entrant'
        AND automation_id = ${automationId}
        AND created_at >= ${epochIso}
      LIMIT 1
    `;
    return rows.length > 0;
  }
  const rows = await sql<{ x: number }[]>`
    SELECT 1 as x FROM messages
    WHERE user_id = ${userId}
      AND ${phoneMatch}
      AND direction = 'entrant'
      AND created_at >= ${epochIso}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Vrai si le prospect a déjà écrit dans l'époque courante de cette campagne
 * (ex. commande / hors-sujet avant l'opener) → ne pas coller un cold opener.
 */
export async function hasInboundInCampaignEpoch(
  userId: number,
  chatId: string,
  automationId?: number | null
): Promise<boolean> {
  const trimmedChat = chatId.trim();
  if (trimmedChat.endsWith("@g.us") || trimmedChat.includes("@newsletter")) {
    return false;
  }
  const phone = normalizeContactPhone(chatId);
  const epochIso = await conversationEpochForContact(userId, phone, automationId);
  return hasInboundInEpoch(userId, phone, automationId, epochIso);
}

/**
 * Classifie le prochain envoi : fil déjà ouvert, nouveau fil sortant (on ouvre),
 * ou nouveau fil entrant (le prospect a écrit en premier).
 */
export async function classifyNewConversationKind(
  userId: number,
  chatId: string,
  automationId?: number | null
): Promise<"none" | "outbound" | "inbound"> {
  const trimmedChat = chatId.trim();
  // Diffusion groupe / chaîne : hors quotas « nouveau fil » prospects.
  if (trimmedChat.endsWith("@g.us") || trimmedChat.includes("@newsletter")) {
    return "none";
  }
  const phone = normalizeContactPhone(chatId);
  if (!(await isStartingNewConversation(userId, phone, automationId))) {
    return "none";
  }
  const epochIso = await conversationEpochForContact(userId, phone, automationId);
  if (await hasInboundInEpoch(userId, phone, automationId, epochIso)) {
    return "inbound";
  }
  return "outbound";
}

export type NewConversationGate =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      code: "trial_exhausted" | "daily_outbound" | "daily_inbound";
      used: number;
      limit: number;
    };

/**
 * Autorise le démarrage d'un nouveau fil (entrant ou sortant).
 * Les réponses dans un fil déjà ouvert ne passent PAS par ici.
 */
export async function canStartNewConversation(
  userId: number,
  kind: "outbound" | "inbound"
): Promise<NewConversationGate> {
  const { getUserById } = await import("./users.js");
  const { TRIAL_MAX_CONVERSATIONS } = await import("./outreach-level.js");
  const user = await getUserById(userId);
  if (!user) {
    return {
      ok: false,
      reason: "Compte introuvable.",
      code: "trial_exhausted",
      used: 0,
      limit: 0,
    };
  }

  if (user.subscription_status === "expired") {
    return {
      ok: false,
      reason:
        "Abonnement terminé. Renouvelez depuis Paramètres → Facturation (carte ou Mobile Money) pour continuer.",
      code: "trial_exhausted",
      used: user.trial_conversations_used,
      limit: 0,
    };
  }

  if (user.subscription_status === "trial") {
    if (user.trial_conversations_used >= TRIAL_MAX_CONVERSATIONS) {
      return {
        ok: false,
        reason: `Essai gratuit terminé (${TRIAL_MAX_CONVERSATIONS} conversations). Activez votre abonnement pour continuer.`,
        code: "trial_exhausted",
        used: user.trial_conversations_used,
        limit: TRIAL_MAX_CONVERSATIONS,
      };
    }
    // Essai : pas de plafond jour niveau — seulement le 20 à vie (consommé à l'enregistrement)
    return { ok: true };
  }

  const caps = await getUserDailyConversationCaps(userId);
  const used = await countNewConversationsToday(userId, kind);
  const bonus = kind === "outbound" ? await getOutboundQuotaBonus(userId) : 0;
  const limit = (kind === "outbound" ? caps.outbound : caps.inbound) + bonus;
  if (used >= limit) {
    return {
      ok: false,
      reason:
        kind === "outbound"
          ? `Limite du jour atteinte (${used}/${limit} nouveaux fils sortants, niveau ${caps.level}). L'envoi sera repris demain.`
          : `Limite du jour atteinte (${used}/${limit} nouveaux fils entrants, niveau ${caps.level}). Reprise demain.`,
      code: kind === "outbound" ? "daily_outbound" : "daily_inbound",
      used,
      limit,
    };
  }
  return { ok: true };
}

/**
 * À appeler APRÈS envoi réussi quand on démarre un nouveau fil :
 * incrémente compteur jour (+ essai si trial).
 */
export async function recordNewConversationStarted(
  userId: number,
  kind: "outbound" | "inbound"
): Promise<void> {
  const { getUserById, tryConsumeTrialConversation } = await import("./users.js");
  const user = await getUserById(userId);
  if (user?.subscription_status === "trial") {
    const ok = await tryConsumeTrialConversation(userId);
    if (!ok) return;
  }
  await incrementNewConversationsToday(userId, kind);
}

export async function canSendOutbound(userId: number): Promise<
  { ok: true } | { ok: false; reason: string; sent: number; limit: number }
> {
  // Compat : traite comme démarrage de nouveau fil sortant
  const gate = await canStartNewConversation(userId, "outbound");
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, sent: gate.used, limit: gate.limit };
  }
  return { ok: true };
}

export async function assertCanSendTo(
  userId: number,
  chatId: string,
  opts?: {
    automationId?: number | null;
    /** Force le check même si un sortant existe déjà (rare). */
    forceKind?: "outbound" | "inbound";
  }
): Promise<void> {
  // Groupes / chaînes : pas de STOP contact ni de plafond « nouveau fil » prospect.
  // (Le contrôle admin groupe est fait côté Evolution avant l'envoi.)
  if (chatId.endsWith("@g.us") || chatId.includes("@newsletter")) {
    return;
  }
  if (await isContactBlocked(userId, chatId)) {
    throw new Error(
      `Contact ${chatId} est en statut STOP. Aucun envoi possible. Débloquez-le d'abord si vraiment nécessaire.`
    );
  }
  const kind =
    opts?.forceKind ??
    (await classifyNewConversationKind(userId, chatId, opts?.automationId ?? null));
  if (kind === "none") return; // fil déjà ouvert : pas de plafond jour / essai

  const gate = await canStartNewConversation(userId, kind);
  if (!gate.ok) throw new Error(gate.reason);
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
  "group_broadcast",
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
  mode?: "outbound_prospect" | "inbound_closing" | "group_broadcast";
  origin?: string;
  groupId?: string;
  groupName?: string;
  /** Diffusions : plusieurs groupes (@g.us) où le compte est admin. */
  groupTargets?: Array<{ id: string; label?: string }>;
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
  /**
   * Support / closing entrant : répondre à TOUS les messages privés
   * (pas seulement les phrases déclencheurs). Groupes / broadcast exclus.
   */
  inboundCatchAll?: boolean;
  /**
   * Mots/phrases qui stoppent l'IA et passent la main à l'humain
   * (messages entrants). Vide / absent = pas de stop par mot-clé.
   */
  handoffKeywords?: string[];
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
  /**
   * Notification WhatsApp optionnelle à un tiers (livreur, commercial…)
   * quand l'objectif campagne est atteint. Défaut : absent / désactivé.
   */
  thirdPartyNotification?: {
    enabled: boolean;
    /** Numéro ou chatId du tiers (normalisé @c.us à l'usage). */
    phone: string;
    /** Rôle du destinataire (ex. livreur, commercial terrain). */
    role?: string;
    /** Consignes / infos à transmettre (adresse, produit, créneau…). */
    context?: string;
  };
  abVariants?: Array<{ id: string; message: string }>;
  sequenceSteps?: Array<{ delayDays: number; message: string; condition?: string }>;
  mediaUrl?: string;
  mediaType?: "image" | "document" | "audio";
  quietHoursStart?: number;
  quietHoursEnd?: number;
  /**
   * Closing entrant : taille d'une vague de réponses (défaut 50).
   * Les réponses sont mises en file (send_queue) et espacées.
   */
  inboundBatchSize?: number;
  /** Minutes entre le début de deux vagues (min 60, défaut 120). */
  inboundWaveGapMinutes?: number;
  /** Délai min entre deux envois dans une vague (secondes, défaut 60). */
  inboundIntraMinSeconds?: number;
  /** Délai max entre deux envois dans une vague (secondes, défaut 120). */
  inboundIntraMaxSeconds?: number;
  /** ISO ou datetime locale : ne pas démarrer les openers avant cette date. */
  scheduledStartAt?: string;
  /** Plan graphique (nodes/edges) pour la carte visuelle — généré côté serveur. */
  /** ISO — simulation validée via le bouton UI (lancement). */
  simulationValidatedAt?: string;
  /**
   * Playbook synchronisé : tours de simulation + snapshots mémoire/opener.
   * Utilisé par les réponses WhatsApp prospects pour rester aligné chat/sim/mémoire.
   */
  livePlaybook?: {
    updatedAt: string;
    validatedAt?: string;
    turns: Array<{ speaker: "toi" | "prospect"; text: string; name?: string }>;
    openerSnapshot?: string;
    guideSnapshot?: string;
    memoryName?: string;
    memoryFingerprint?: string;
  };
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
  /** YYYY-MM-DD du vendredi couvert par le dernier rapport hebdomadaire. */
  lastWeeklyReportWeek?: string;
  /** ISO — dernier envoi email Resend du rapport (quotidien legacy / hebdo). */
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
    stats.lastWeeklyReportWeek = auto.stats.lastWeeklyReportWeek;
    stats.emailReportSentAt = auto.stats.emailReportSentAt;
    stats.conversions = auto.stats.conversions;
    stats.revenueFcfa = auto.stats.revenueFcfa;
    stats.openersDone = auto.stats.openersDone;
    // Ne JAMAIS écraser la rotation A/B (sinon toujours v1 au prochain envoi).
    stats.abResults = auto.stats.abResults;
    stats.openAiCostEstimateFcfa = auto.stats.openAiCostEstimateFcfa;
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
  // Pas de log « Statut → paused » : trop technique. Les actions métier
  // (pause / activation / échec) journalisent déjà un message lisible.
  return getAutomation(userId, id);
}

/** Coupe tous les envois liés à une campagne (file, relances, réponses auto contact). */
export async function haltAutomationMessaging(
  userId: number,
  automationId: number
): Promise<{ cancelledQueue: number; cancelledSequences: number; disabledContacts: number }> {
  const queueResult = await sql`
    UPDATE send_queue SET status = 'cancelled', error = 'Campagne mise en pause', claimed_at = NULL
    WHERE user_id = ${userId} AND automation_id = ${automationId} AND status IN ('pending', 'processing')
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
    `Envois arrêtés : ${Number(queueResult.count)} message(s) en file annulé(s), ${Number(seqResult.count)} relance(s) coupée(s), réponses auto désactivées pour ${disabledContacts} contact(s).`
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
    // Jamais traiter un @g.us comme contact prospect
    if (t.target_id.endsWith("@g.us") || t.target_id.includes("@newsletter")) continue;
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
  await addAutomationLog(userId, id, "info", "Campagne mise en pause.");
  return getAutomation(userId, id);
}

/**
 * Met en pause toutes les campagnes actives sauf `exceptId`.
 * Une seule campagne active à la fois (évite les messages mélangés sur WhatsApp).
 */
export async function pauseOtherActiveAutomations(
  userId: number,
  exceptId: number
): Promise<Array<{ id: number; name: string }>> {
  const active = await listActiveAutomations(userId);
  const paused: Array<{ id: number; name: string }> = [];
  for (const auto of active) {
    if (auto.id === exceptId) continue;
    const updated = await pauseAutomation(userId, auto.id);
    if (updated) paused.push({ id: updated.id, name: updated.name });
  }
  return paused;
}

/** Reprise : active + auto-reply pour les prospects (sauf diffusion groupes). */
export async function resumeAutomation(userId: number, id: number): Promise<Automation | null> {
  const current = await getAutomation(userId, id);
  if (!current) return null;
  // Une seule campagne active : l'ancienne passe en pause
  await pauseOtherActiveAutomations(userId, id);
  const isGroupBroadcast =
    current.type === "group_broadcast" || current.config.mode === "group_broadcast";
  await updateAutomationConfig(userId, id, {
    ...current.config,
    enableAutoReply: isGroupBroadcast ? false : true,
  });
  // Réactive aussi l'interrupteur GLOBAL (peut être OFF après un arrêt d'urgence)
  if (!isGroupBroadcast) {
    await setAutoReplyEnabled(userId, true);
  }
  const updated = await updateAutomationStatus(userId, id, "active");
  if (!updated) return null;

  // Cibles effacées (nettoyage DB) ou jamais chargées → re-bootstrap
  const existingTargets = await listAutomationTargets(userId, id, { limit: 1 });
  if (
    existingTargets.length === 0 &&
    (updated.type === "group_prospect" ||
      updated.type === "contact_prospect" ||
      updated.type === "group_broadcast")
  ) {
    const {
      bootstrapGroupProspectTargets,
      bootstrapContactProspectTargets,
      bootstrapGroupBroadcastTargets,
    } = await import("./automation-engine.js");
    const { requireEvolutionConnected } = await import("./evolutionapi.js");
    try {
      await requireEvolutionConnected(userId, "la reprise de la campagne");
      if (updated.type === "group_prospect") {
        await bootstrapGroupProspectTargets(userId, id);
      } else if (updated.type === "group_broadcast") {
        await bootstrapGroupBroadcastTargets(userId, id);
      } else {
        await bootstrapContactProspectTargets(userId, id);
      }
    } catch (err) {
      await pauseAutomation(userId, id);
      throw err;
    }
  }

  await resumeAutomationMessaging(userId, id);
  await addAutomationLog(userId, id, "info", "Campagne réactivée — réponses auto reprises.");
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

/** Plafond journalier : COUNT SQL, pas 1000 lignes cibles. */
export async function countAutomationTargetsActionedOnLocalDay(
  userId: number,
  automationId: number,
  localDay = formatLocalDateTime(new Date()).slice(0, 10)
): Promise<number> {
  const start = parseLocalDateTime(`${localDay} 00:00:00`);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  const rows = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n
    FROM automation_targets
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND status NOT IN ('pending', 'queued')
      AND last_action_at IS NOT NULL
      AND last_action_at >= ${start}
      AND last_action_at < ${end}
  `;
  return Number(rows[0]?.n ?? 0);
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

export async function updateAutomationTargetLabel(
  userId: number,
  automationId: number,
  targetId: string,
  label: string,
): Promise<void> {
  const trimmed = label.trim().slice(0, 120);
  if (!trimmed) return;
  await sql`
    UPDATE automation_targets
    SET target_label = ${trimmed}
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND target_id = ${targetId}
  `;
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
}

/** Statuts cibles encore actifs (éligibles à un stop campagne). */
export const ACTIVE_TARGET_STATUSES_FOR_STOP: TargetStatus[] = [
  "pending",
  "queued",
  "contacted",
  "replied",
  "interested",
];

/**
 * Stoppe la cible automation + annule les séquences de cette campagne uniquement.
 * Ne touche pas contacts.status ni blocked_contacts.
 * Crée la cible si absente (closing entrant sans target préalable).
 */
export async function stopAutomationTargetForContact(
  userId: number,
  automationId: number,
  phone: string,
  notes: string
): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  let target = await findMatchingAutomationTarget(
    userId,
    automationId,
    chatId,
    ACTIVE_TARGET_STATUSES_FOR_STOP
  );
  if (!target) {
    target = await findMatchingAutomationTarget(userId, automationId, chatId, [
      ...TARGET_STATUSES,
    ]);
  }
  if (!target) {
    await addAutomationTargets(userId, automationId, [{ targetId: chatId }]);
    target = await findMatchingAutomationTarget(userId, automationId, chatId, [
      ...TARGET_STATUSES,
    ]);
  }
  if (target) {
    await updateAutomationTarget(userId, automationId, target.target_id, {
      status: "stopped",
      notes,
    });
  }
  await cancelSequencesForContact(userId, chatId, automationId);
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
  // Débloque les claims abandonnés (crash entre claim et envoi) — pas si un envoi est encore en file.
  await sql`
    UPDATE automation_targets at
    SET status = 'pending'
    WHERE at.user_id = ${userId}
      AND at.automation_id = ${automationId}
      AND at.status = 'queued'
      AND at.last_action_at < NOW() - INTERVAL '3 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM send_queue sq
        WHERE sq.user_id = at.user_id
          AND sq.automation_id = at.automation_id
          AND sq.recipient = at.target_id
          AND sq.status IN ('pending', 'processing')
      )
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
    SET status = 'cancelled', error = 'Doublon / remplacé', claimed_at = NULL
    WHERE user_id = ${userId}
      AND status IN ('pending', 'processing')
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
  /** Si true : ne pas annuler les autres pending du même destinataire (posts multi-jours groupes). */
  keepOtherPending?: boolean;
}): Promise<QueueItem> {
  // Anti-doublon : une seule ligne pending par destinataire (sauf urgence manuelle / multi-posts groupes).
  if ((input.priority ?? 5) < 10 && !input.keepOtherPending) {
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

let sendQueueClaimSchemaReady = false;

/** Statut processing + claimed_at pour claim atomique multi-workers. */
export async function ensureSendQueueClaimSchema(): Promise<void> {
  if (sendQueueClaimSchemaReady) return;
  await sql`
    ALTER TABLE send_queue DROP CONSTRAINT IF EXISTS send_queue_status_check
  `;
  await sql`
    ALTER TABLE send_queue
      ADD CONSTRAINT send_queue_status_check
      CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'))
  `.catch(() => {
    /* constraint may already exist with correct values */
  });
  await sql`
    ALTER TABLE send_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ
  `;
  sendQueueClaimSchemaReady = true;
}

/** Débloque les claims abandonnés (crash / overlap deploy). */
export async function releaseStaleProcessingQueueItems(userId: number): Promise<number> {
  await ensureSendQueueClaimSchema();
  const result = await sql`
    UPDATE send_queue
    SET status = 'pending', claimed_at = NULL
    WHERE user_id = ${userId}
      AND status = 'processing'
      AND claimed_at IS NOT NULL
      AND claimed_at < NOW() - INTERVAL '3 minutes'
  `;
  return Number(result.count);
}

/**
 * Claim atomique (FOR UPDATE SKIP LOCKED) : un seul worker traite une ligne pending.
 */
export async function claimDueQueueItems(userId: number, limit = 3): Promise<QueueItem[]> {
  await ensureSendQueueClaimSchema();
  await releaseStaleProcessingQueueItems(userId);
  const rows = await sql<Record<string, unknown>[]>`
    WITH picked AS (
      SELECT id
      FROM send_queue
      WHERE user_id = ${userId}
        AND status = 'pending'
        AND send_at <= NOW()
      ORDER BY priority DESC, send_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE send_queue sq
    SET status = 'processing', claimed_at = NOW()
    FROM picked
    WHERE sq.id = picked.id
    RETURNING sq.*
  `;
  return rows.map(mapQueueItem);
}

export async function markQueueSent(userId: number, id: number): Promise<void> {
  await sql`
    UPDATE send_queue
    SET status = 'sent', sent_at = NOW(), claimed_at = NULL
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function markQueueFailed(userId: number, id: number, error: string): Promise<void> {
  await sql`
    UPDATE send_queue
    SET status = 'failed', error = ${error}, claimed_at = NULL
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function markQueueCancelled(userId: number, id: number, reason: string): Promise<void> {
  await sql`
    UPDATE send_queue
    SET status = 'cancelled', error = ${reason}, claimed_at = NULL
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function rescheduleSendQueueItem(userId: number, id: number, sendAt: string): Promise<void> {
  await sql`
    UPDATE send_queue
    SET send_at = ${toTsParam(sendAt)}, status = 'pending', claimed_at = NULL
    WHERE user_id = ${userId} AND id = ${id}
  `;
}

export async function listPendingSendQueueForAutomation(
  userId: number,
  automationId: number
): Promise<QueueItem[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM send_queue
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND status = 'pending'
    ORDER BY send_at ASC
  `;
  return rows.map(mapQueueItem);
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

export async function cancelSequencesForContact(
  userId: number,
  phone: string,
  automationId?: number | null
): Promise<void> {
  const chatId = normalizeContactPhone(phone);
  if (automationId != null && Number.isFinite(Number(automationId))) {
    const aid = Number(automationId);
  await sql`
    UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL
      WHERE user_id = ${userId}
        AND contact_phone = ${chatId}
        AND automation_id = ${aid}
        AND status = 'active'
    `;
    return;
  }
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
