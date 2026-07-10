import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "agent.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS agent_conversation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_phone TEXT NOT NULL,
    sender_name TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('entrant', 'sortant')),
    body TEXT NOT NULL,
    green_api_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'nouveau'
      CHECK (status IN ('nouveau', 'en_conversation', 'interesse', 'stop')),
    auto_reply INTEGER NOT NULL DEFAULT 0 CHECK (auto_reply IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    recipient_label TEXT,
    message TEXT NOT NULL,
    send_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sent_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(contact_phone);
  CREATE INDEX IF NOT EXISTS idx_agent_conversation_created ON agent_conversation(created_at);
  CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
  CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_messages(status, send_at);

  CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('group_prospect', 'keyword_sales', 'custom_followup')),
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'completed', 'failed')),
    config_json TEXT NOT NULL DEFAULT '{}',
    stats_json TEXT NOT NULL DEFAULT '{}',
    summary TEXT,
    budget_fcfa INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS automation_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL,
    target_id TEXT NOT NULL,
    target_label TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'contacted', 'replied', 'interested', 'stopped', 'error')),
    last_action_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(automation_id, target_id),
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS automation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_automations_status ON automations(status);
  CREATE INDEX IF NOT EXISTS idx_automation_targets_auto ON automation_targets(automation_id, status);
  CREATE INDEX IF NOT EXISTS idx_automation_logs_auto ON automation_logs(automation_id, created_at);

  CREATE TABLE IF NOT EXISTS contact_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_phone TEXT NOT NULL,
    automation_id INTEGER,
    name TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    current_step INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    next_step_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS send_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    recipient_label TEXT,
    message TEXT,
    media_url TEXT,
    media_type TEXT,
    priority INTEGER NOT NULL DEFAULT 5,
    send_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    automation_id INTEGER,
    sequence_id INTEGER,
    ab_variant TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS group_reply_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    group_label TEXT,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    reply_guide TEXT,
    automation_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS handoff_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_phone TEXT NOT NULL,
    contact_name TEXT,
    reason TEXT NOT NULL,
    summary TEXT,
    suggested_reply TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'resolved', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_contact_sequences_phone ON contact_sequences(contact_phone, status);
  CREATE INDEX IF NOT EXISTS idx_send_queue_pending ON send_queue(status, priority DESC, send_at);
  CREATE INDEX IF NOT EXISTS idx_group_reply_rules_group ON group_reply_rules(group_id, status);
  CREATE INDEX IF NOT EXISTS idx_handoff_pending ON handoff_events(status, created_at);
`);

export const DAILY_OUTBOUND_LIMIT = 30;
export const CONTACT_STATUSES = ["nouveau", "en_conversation", "interesse", "stop"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** Migrations légères pour bases déjà créées */
function migrateSchema(): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
    .all() as { name: string }[];

  if (tables.length > 0) {
    const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "sender_name")) {
      db.exec("ALTER TABLE messages ADD COLUMN sender_name TEXT");
      console.log("📦 Migration : colonne sender_name ajoutée à messages");
    }
  }

  const contactTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'")
    .all() as { name: string }[];

  if (contactTables.length > 0) {
    const cols = db.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "updated_at")) {
      db.exec(`ALTER TABLE contacts ADD COLUMN updated_at TEXT`);
      db.exec(`UPDATE contacts SET updated_at = COALESCE(created_at, datetime('now', 'localtime')) WHERE updated_at IS NULL`);
      console.log("📦 Migration : colonne updated_at ajoutée à contacts");
    }
    if (!cols.some((c) => c.name === "notes")) {
      db.exec("ALTER TABLE contacts ADD COLUMN notes TEXT");
      console.log("📦 Migration : colonne notes ajoutée à contacts");
    }
    if (!cols.some((c) => c.name === "auto_reply")) {
      db.exec("ALTER TABLE contacts ADD COLUMN auto_reply INTEGER NOT NULL DEFAULT 0");
      console.log("📦 Migration : colonne auto_reply ajoutée à contacts");
    }
    if (!cols.some((c) => c.name === "lead_score")) {
      db.exec("ALTER TABLE contacts ADD COLUMN lead_score INTEGER NOT NULL DEFAULT 0");
      console.log("📦 Migration : colonne lead_score ajoutée à contacts");
    }
    if (!cols.some((c) => c.name === "memory_summary")) {
      db.exec("ALTER TABLE contacts ADD COLUMN memory_summary TEXT");
      console.log("📦 Migration : colonne memory_summary ajoutée à contacts");
    }
    if (!cols.some((c) => c.name === "memory_updated_at")) {
      db.exec("ALTER TABLE contacts ADD COLUMN memory_updated_at TEXT");
      console.log("📦 Migration : colonne memory_updated_at ajoutée à contacts");
    }
    if (!cols.some((c) => c.name === "handoff_status")) {
      db.exec("ALTER TABLE contacts ADD COLUMN handoff_status TEXT");
      console.log("📦 Migration : colonne handoff_status ajoutée à contacts");
    }
  }

  const targetTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='automation_targets'")
    .all() as { name: string }[];
  if (targetTables.length > 0) {
    const tcols = db.prepare("PRAGMA table_info(automation_targets)").all() as { name: string }[];
    if (!tcols.some((c) => c.name === "ab_variant")) {
      db.exec("ALTER TABLE automation_targets ADD COLUMN ab_variant TEXT");
      console.log("📦 Migration : colonne ab_variant ajoutée à automation_targets");
    }
  }

  // Migrer l'ancienne liste JSON blocked_contacts → status stop
  try {
    const raw = getSettingRaw("blocked_contacts");
    if (raw && raw !== "[]") {
      const list = JSON.parse(raw) as string[];
      for (const chatId of list) {
        if (!chatId) continue;
        upsertContactInternal({
          phone: chatId,
          status: "stop",
          autoReply: false,
        });
      }
      setSettingRaw("blocked_contacts", "[]");
      console.log(`📦 Migration : ${list.length} contact(s) STOP migrés`);
    }
  } catch {
    /* ignore */
  }

  // Contacts prospectés avant le correctif auto_reply : réactiver une seule fois
  try {
    if (!getSettingRaw("migration_auto_reply_prospect_fix_v1")) {
      const fixed = db
        .prepare(
          `UPDATE contacts SET auto_reply = 1, updated_at = datetime('now', 'localtime')
           WHERE auto_reply = 0
             AND status IN ('nouveau', 'en_conversation')
             AND phone IN (
               SELECT DISTINCT contact_phone FROM messages WHERE direction = 'sortant'
             )`
        )
        .run();
      setSettingRaw("migration_auto_reply_prospect_fix_v1", "1");
      if (fixed.changes > 0) {
        console.log(`📦 Migration : auto_reply activé pour ${fixed.changes} contact(s) prospecté(s)`);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    if (!getSettingRaw("migration_drop_video_graphis_v1")) {
      db.exec("DROP TABLE IF EXISTS video_jobs");
      db.exec("DROP TABLE IF EXISTS video_agent_conversation");
      db.exec("DROP TABLE IF EXISTS graphis_jobs");
      db.exec("DROP TABLE IF EXISTS graphis_agent_conversation");
      for (const key of [
        "kie_api_key",
        "anthropic_api_key",
        "graphis_brand_json",
      ]) {
        db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      }
      setSettingRaw("migration_drop_video_graphis_v1", "1");
      console.log("📦 Migration : modules Montage Vidéo et Graphis supprimés de la base");
    }
  } catch {
    /* ignore */
  }

  try {
    if (!getSettingRaw("migration_drop_meta_youtube_v1")) {
      db.exec("DROP TABLE IF EXISTS youtube_watch_developed_ideas");
      db.exec("DROP TABLE IF EXISTS youtube_watch_runs");
      db.exec("DROP TABLE IF EXISTS youtube_watch_channels");
      db.exec("DROP TABLE IF EXISTS ads_agent_conversation");
      for (const key of [
        "meta_access_token",
        "meta_ad_account_id",
        "meta_page_id",
        "meta_whatsapp_number",
      ]) {
        db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      }
      setSettingRaw("migration_drop_meta_youtube_v1", "1");
      console.log("📦 Migration : modules Meta Ads et Veille YouTube supprimés de la base");
    }
  } catch {
    /* ignore */
  }
}

function getSettingRaw(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

function setSettingRaw(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now', 'localtime'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(key, value);
}

function upsertContactInternal(input: {
  phone: string;
  name?: string | null;
  notes?: string | null;
  status?: ContactStatus;
  autoReply?: boolean;
}): void {
  const existing = db
    .prepare("SELECT id FROM contacts WHERE phone = ?")
    .get(input.phone) as { id: number } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO contacts (phone, name, notes, status, auto_reply)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.phone,
      input.name ?? null,
      input.notes ?? null,
      input.status ?? "nouveau",
      input.autoReply === undefined ? 0 : input.autoReply ? 1 : 0
    );
    return;
  }

  db.prepare(
    `UPDATE contacts SET
       name = COALESCE(?, name),
       notes = COALESCE(?, notes),
       status = COALESCE(?, status),
       auto_reply = COALESCE(?, auto_reply),
       updated_at = datetime('now', 'localtime')
     WHERE phone = ?`
  ).run(
    input.name ?? null,
    input.notes ?? null,
    input.status ?? null,
    input.autoReply === undefined ? null : input.autoReply ? 1 : 0,
    input.phone
  );
}

migrateSchema();

export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  id: number;
  role: AgentRole;
  content: string;
  created_at: string;
}

export interface AppSettings {
  openai_api_key: string;
  green_api_id_instance: string;
  green_api_token: string;
  green_api_base_url: string;
  evolution_api_base_url: string;
  evolution_api_key: string;
  evolution_instance_name: string;
  business_owner_name: string;
  business_offer: string;
  business_price: string;
}

function getSetting(key: string): string {
  return getSettingRaw(key);
}

function setSetting(key: string, value: string): void {
  setSettingRaw(key, value);
}

export function getAppSettings(): AppSettings {
  return {
    openai_api_key: getSetting("openai_api_key") || config.envOpenAiKey,
    green_api_id_instance: getSetting("green_api_id_instance") || config.envGreenApiId,
    green_api_token: getSetting("green_api_token") || config.envGreenApiToken,
    green_api_base_url:
      getSetting("green_api_base_url") || config.envGreenApiBaseUrl || config.defaultGreenApiBaseUrl,
    evolution_api_base_url:
      getSetting("evolution_api_base_url") || config.envEvolutionBaseUrl || config.defaultEvolutionBaseUrl,
    evolution_api_key: getSetting("evolution_api_key") || config.envEvolutionApiKey,
    evolution_instance_name: getSetting("evolution_instance_name") || config.envEvolutionInstance,
    business_owner_name: getSetting("business_owner_name") || "",
    business_offer: getSetting("business_offer") || "",
    business_price: getSetting("business_price") || "",
  };
}

export function saveOpenAiKey(key: string): void {
  setSetting("openai_api_key", key.trim());
}

export function saveGreenApiSettings(input: {
  idInstance: string;
  apiToken: string;
  baseUrl: string;
}): void {
  setSetting("green_api_id_instance", input.idInstance.trim());
  setSetting("green_api_token", input.apiToken.trim());
  setSetting(
    "green_api_base_url",
    (input.baseUrl.trim() || config.defaultGreenApiBaseUrl).replace(/\/$/, "")
  );
}

export function saveEvolutionSettings(input: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}): void {
  setSetting(
    "evolution_api_base_url",
    (input.baseUrl.trim() || config.defaultEvolutionBaseUrl).replace(/\/$/, "")
  );
  setSetting("evolution_api_key", input.apiKey.trim());
  setSetting("evolution_instance_name", input.instanceName.trim());
}

export function saveBusinessProfile(input: {
  ownerName?: string;
  offer?: string;
  price?: string;
}): void {
  if (input.ownerName !== undefined) setSetting("business_owner_name", input.ownerName.trim());
  if (input.offer !== undefined) setSetting("business_offer", input.offer.trim());
  if (input.price !== undefined) setSetting("business_price", input.price.trim());
}

export function maskSecret(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

export function saveAgentMessage(role: AgentRole, content: string): AgentMessage {
  const result = db
    .prepare("INSERT INTO agent_conversation (role, content) VALUES (?, ?)")
    .run(role, content);

  return db
    .prepare("SELECT id, role, content, created_at FROM agent_conversation WHERE id = ?")
    .get(result.lastInsertRowid) as unknown as AgentMessage;
}

export function getRecentAgentMessages(limit = 50): AgentMessage[] {
  const rows = db
    .prepare(
      `SELECT id, role, content, created_at
       FROM agent_conversation
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as AgentMessage[];

  return rows.reverse();
}

export function getAgentMessagesSince(sinceId = 0, limit = 50): AgentMessage[] {
  return db
    .prepare(
      `SELECT id, role, content, created_at
       FROM agent_conversation
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(sinceId, limit) as unknown as AgentMessage[];
}

export function clearAgentConversation(): void {
  db.prepare("DELETE FROM agent_conversation").run();
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

export function saveWhatsAppMessage(input: {
  contactPhone: string;
  direction: "entrant" | "sortant";
  body: string;
  greenApiId?: string;
  senderName?: string;
}): WhatsAppMessage {
  const result = db
    .prepare(
      `INSERT INTO messages (contact_phone, sender_name, direction, body, green_api_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.contactPhone,
      input.senderName ?? null,
      input.direction,
      input.body,
      input.greenApiId ?? null
    );

  return db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages WHERE id = ?`
    )
    .get(result.lastInsertRowid) as unknown as WhatsAppMessage;
}

export function whatsAppMessageExists(greenApiId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM messages WHERE green_api_id = ?")
    .get(greenApiId);
  return Boolean(row);
}

export function getIncomingMessagesSince(sinceId = 0, limit = 50): WhatsAppMessage[] {
  return db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE direction = 'entrant' AND id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(sinceId, limit) as unknown as WhatsAppMessage[];
}

export function getRecentIncomingMessages(limit = 30): WhatsAppMessage[] {
  const rows = db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE direction = 'entrant'
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as WhatsAppMessage[];
  return rows.reverse();
}

export function getWhatsAppMessagesSince(sinceId = 0, limit = 50): WhatsAppMessage[] {
  return db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(sinceId, limit) as unknown as WhatsAppMessage[];
}

export function listIncomingMessages(options: {
  contactPhone?: string;
  todayOnly?: boolean;
  limit?: number;
} = {}): WhatsAppMessage[] {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const conditions = ["direction = 'entrant'"];
  const params: (string | number)[] = [];

  if (options.contactPhone) {
    const phone = options.contactPhone.trim();
    const chatId = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@c.us`;
    conditions.push("contact_phone = ?");
    params.push(chatId);
  }

  if (options.todayOnly) {
    conditions.push("date(created_at) = date('now', 'localtime')");
  }

  params.push(limit);

  const rows = db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE ${conditions.join(" AND ")}
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(...params) as unknown as WhatsAppMessage[];

  return rows.reverse();
}

export function getWhatsAppMessageStats(): {
  totalIncoming: number;
  totalOutgoing: number;
  incomingToday: number;
  outgoingToday: number;
} {
  const totalIncoming = (
    db.prepare("SELECT COUNT(*) as c FROM messages WHERE direction = 'entrant'").get() as { c: number }
  ).c;
  const totalOutgoing = (
    db.prepare("SELECT COUNT(*) as c FROM messages WHERE direction = 'sortant'").get() as { c: number }
  ).c;
  const incomingToday = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM messages WHERE direction = 'entrant' AND date(created_at) = date('now', 'localtime')"
      )
      .get() as { c: number }
  ).c;
  const outgoingToday = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM messages WHERE direction = 'sortant' AND date(created_at) = date('now', 'localtime')"
      )
      .get() as { c: number }
  ).c;
  return { totalIncoming, totalOutgoing, incomingToday, outgoingToday };
}

export function listAllIncomingMessages(limit = 100): WhatsAppMessage[] {
  const safe = Math.min(Math.max(limit, 1), 500);
  const rows = db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE direction = 'entrant'
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(safe) as unknown as WhatsAppMessage[];
  return rows;
}

export function getContactChatHistory(chatId: string, limit = 12): WhatsAppMessage[] {
  const digits = chatId.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  const rows = db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE contact_phone = ?
          OR (? != '' AND (
            contact_phone = ? || '@c.us'
            OR contact_phone = ? || '@lid'
            OR replace(replace(contact_phone, '@c.us', ''), '@lid', '') = ?
          ))
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(chatId, digits, digits, digits, digits, limit) as unknown as WhatsAppMessage[];
  return rows.reverse();
}

export function isAutoReplyEnabled(): boolean {
  const v = getSetting("whatsapp_auto_reply");
  return v !== "0";
}

export function setAutoReplyEnabled(enabled: boolean): void {
  setSetting("whatsapp_auto_reply", enabled ? "1" : "0");
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
  if (trimmed.endsWith("@c.us")) return trimmed;
  if (trimmed.endsWith("@lid")) {
    const digits = trimmed.replace(/@lid/gi, "").replace(/\D/g, "");
    if (digits.length >= 8) return `${digits}@c.us`;
  }
  if (trimmed.includes("@")) {
    const digits = trimmed.replace(/@\w+/g, "").replace(/\D/g, "");
    if (digits.length >= 8) return `${digits}@c.us`;
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) throw new Error("Numéro de téléphone invalide.");
  return `${digits}@c.us`;
}

function lookupContactRow(chatId: string): Contact | null {
  const row = db
    .prepare(
      `SELECT id, phone, name, notes, status, auto_reply,
              COALESCE(lead_score, 0) as lead_score,
              memory_summary, memory_updated_at, handoff_status,
              created_at, updated_at
       FROM contacts WHERE phone = ?`
    )
    .get(chatId) as Contact | undefined;
  return row ?? null;
}

function findContactForChat(chatId: string): Contact | null {
  const trimmed = chatId.trim();
  try {
    const normalized = normalizeContactPhone(trimmed);
    const direct = lookupContactRow(normalized);
    if (direct) return direct;
  } catch {
    /* try digit fallback */
  }
  const digits = trimmed.replace(/@c\.us|@lid/gi, "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return lookupContactRow(`${digits}@c.us`);
}

export function getContact(phone: string): Contact | null {
  const trimmed = phone.trim();
  if (trimmed.endsWith("@g.us")) return null;
  return findContactForChat(trimmed);
}

export function listContacts(options: { status?: ContactStatus; limit?: number } = {}): Contact[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const select = `SELECT id, phone, name, notes, status, auto_reply,
    COALESCE(lead_score, 0) as lead_score, memory_summary, memory_updated_at, handoff_status,
    created_at, updated_at FROM contacts`;
  if (options.status) {
    return db
      .prepare(`${select} WHERE status = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(options.status, limit) as unknown as Contact[];
  }
  return db.prepare(`${select} ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as Contact[];
}

export function updateContactLeadScore(phone: string, score: number): void {
  const chatId = normalizeContactPhone(phone);
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  db.prepare(
    `UPDATE contacts SET lead_score = ?, updated_at = datetime('now', 'localtime') WHERE phone = ?`
  ).run(clamped, chatId);
  if (clamped >= 70) {
    db.prepare(
      `UPDATE contacts SET status = 'interesse', updated_at = datetime('now', 'localtime')
       WHERE phone = ? AND status != 'stop'`
    ).run(chatId);
  }
}

export function updateContactMemory(phone: string, summary: string): void {
  const chatId = normalizeContactPhone(phone);
  db.prepare(
    `UPDATE contacts SET memory_summary = ?, memory_updated_at = datetime('now', 'localtime'),
     updated_at = datetime('now', 'localtime') WHERE phone = ?`
  ).run(summary.trim(), chatId);
}

export function setContactHandoff(phone: string, status: string | null): void {
  const chatId = normalizeContactPhone(phone);
  db.prepare(
    `UPDATE contacts SET handoff_status = ?, updated_at = datetime('now', 'localtime') WHERE phone = ?`
  ).run(status, chatId);
}

export function saveContact(input: {
  phone: string;
  name?: string | null;
  notes?: string | null;
  status?: ContactStatus;
  autoReply?: boolean;
}): Contact {
  const chatId = normalizeContactPhone(input.phone);
  if (input.status && !CONTACT_STATUSES.includes(input.status)) {
    throw new Error(`Statut invalide. Attendu : ${CONTACT_STATUSES.join(", ")}`);
  }

  upsertContactInternal({
    phone: chatId,
    name: input.name,
    notes: input.notes,
    status: input.status,
    autoReply: input.autoReply,
  });

  const contact = getContact(chatId);
  if (!contact) throw new Error("Impossible d'enregistrer le contact.");
  return contact;
}

/** Crée le contact s'il n'existe pas ; met à jour le nom ; passe en conversation si besoin. */
export function touchIncomingContact(chatId: string, senderName?: string): Contact {
  const existing = getContact(chatId);
  if (!existing) {
    return saveContact({
      phone: chatId,
      name: senderName || null,
      status: "en_conversation",
      autoReply: true,
    });
  }

  const updates: {
    phone: string;
    name?: string | null;
    status?: ContactStatus;
    autoReply?: boolean;
  } = { phone: chatId };

  if (senderName && !existing.name) updates.name = senderName;
  if (existing.status === "nouveau") updates.status = "en_conversation";
  // Prospect qui écrit : activer la réponse auto (sauf STOP explicite)
  if (existing.status !== "stop" && existing.auto_reply !== 1) {
    updates.autoReply = true;
  }

  return saveContact(updates);
}

export function setContactAutoReply(phone: string, enabled: boolean): Contact {
  return saveContact({ phone, autoReply: enabled });
}

export function blockContact(chatId: string): Contact {
  return saveContact({ phone: chatId, status: "stop", autoReply: false });
}

export function unblockContact(chatId: string): Contact {
  const existing = getContact(chatId);
  const nextStatus: ContactStatus =
    existing && existing.status === "stop" ? "en_conversation" : existing?.status ?? "en_conversation";
  return saveContact({ phone: chatId, status: nextStatus });
}


export function isContactBlocked(chatId: string): boolean {
  const contact = findContactForChat(chatId);
  if (contact) return contact.status === "stop";
  // Fallback ancienne liste JSON si jamais encore présente
  try {
    const list = JSON.parse(getSetting("blocked_contacts") || "[]") as string[];
    return list.includes(chatId);
  } catch {
    return false;
  }
}

/** Auto-reply pour UN contact : global ON + contact.auto_reply=1 + pas STOP. */
export function shouldAutoReplyContact(chatId: string): boolean {
  if (!isAutoReplyEnabled()) return false;
  if (isContactBlocked(chatId)) return false;
  const contact = findContactForChat(chatId);
  if (!contact) return true;
  return contact.auto_reply === 1;
}

export function countOutboundToday(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM messages
       WHERE direction = 'sortant'
         AND date(created_at) = date('now', 'localtime')`
    )
    .get() as { n: number };
  return Number(row?.n ?? 0);
}

export function canSendOutbound(): { ok: true } | { ok: false; reason: string; sent: number; limit: number } {
  const sent = countOutboundToday();
  if (sent >= DAILY_OUTBOUND_LIMIT) {
    return {
      ok: false,
      reason: `Limite journalière atteinte (${sent}/${DAILY_OUTBOUND_LIMIT} messages sortants). Réessayez demain.`,
      sent,
      limit: DAILY_OUTBOUND_LIMIT,
    };
  }
  return { ok: true };
}

export function assertCanSendTo(chatId: string): void {
  // Les groupes (@g.us) ne sont jamais en STOP — seul le quota journalier s'applique
  if (!chatId.endsWith("@g.us") && isContactBlocked(chatId)) {
    throw new Error(
      `Contact ${chatId} est en statut STOP. Aucun envoi possible. Débloquez-le d'abord si vraiment nécessaire.`
    );
  }
  const check = canSendOutbound();
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

/** Heure locale au format SQLite datetime('now','localtime') comparable. */
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Parse une heure locale "HH:MM" ou "HHhMM" → datetime du prochain créneau (aujourd'hui ou demain).
 */
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

  // Si l'heure est déjà passée (ou dans moins de 15 s), programmer demain
  if (target.getTime() <= now.getTime() + 15_000) {
    target.setDate(target.getDate() + 1);
  }

  return formatLocalDateTime(target);
}

export function scheduleMessage(input: {
  recipient: string;
  recipientLabel?: string;
  message: string;
  sendAt: string;
}): ScheduledMessage {
  const result = db
    .prepare(
      `INSERT INTO scheduled_messages (recipient, recipient_label, message, send_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.recipient, input.recipientLabel ?? null, input.message, input.sendAt);

  return db
    .prepare(
      `SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
       FROM scheduled_messages WHERE id = ?`
    )
    .get(result.lastInsertRowid) as unknown as ScheduledMessage;
}

export function listScheduledMessages(options: { includeDone?: boolean; limit?: number } = {}): ScheduledMessage[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  if (options.includeDone) {
    return db
      .prepare(
        `SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
         FROM scheduled_messages
         ORDER BY send_at DESC
         LIMIT ?`
      )
      .all(limit) as unknown as ScheduledMessage[];
  }
  return db
    .prepare(
      `SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
       FROM scheduled_messages
       WHERE status = 'pending'
       ORDER BY send_at ASC
       LIMIT ?`
    )
    .all(limit) as unknown as ScheduledMessage[];
}

export function getDueScheduledMessages(limit = 10): ScheduledMessage[] {
  const now = formatLocalDateTime(new Date());
  return db
    .prepare(
      `SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
       FROM scheduled_messages
       WHERE status = 'pending' AND send_at <= ?
       ORDER BY send_at ASC
       LIMIT ?`
    )
    .all(now, limit) as unknown as ScheduledMessage[];
}

export function cancelScheduledMessage(id: number): ScheduledMessage | null {
  const row = db
    .prepare(
      `SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
       FROM scheduled_messages WHERE id = ?`
    )
    .get(id) as ScheduledMessage | undefined;

  if (!row) return null;
  if (row.status !== "pending") {
    throw new Error(`Impossible d'annuler : statut actuel = ${row.status}.`);
  }

  db.prepare(
    `UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ?`
  ).run(id);

  return db
    .prepare(
      `SELECT id, recipient, recipient_label, message, send_at, status, error, created_at, sent_at
       FROM scheduled_messages WHERE id = ?`
    )
    .get(id) as unknown as ScheduledMessage;
}

export function markScheduledSent(id: number): void {
  db.prepare(
    `UPDATE scheduled_messages
     SET status = 'sent', sent_at = datetime('now', 'localtime'), error = NULL
     WHERE id = ?`
  ).run(id);
}

export function markScheduledFailed(id: number, error: string): void {
  db.prepare(
    `UPDATE scheduled_messages
     SET status = 'failed', error = ?, sent_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(error.slice(0, 500), id);
}

/** Conversation complète d'un contact (pour rapports). */
export function getContactThread(phone: string, limit = 100): WhatsAppMessage[] {
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

/** Bilan du jour (ou d'une date YYYY-MM-DD) pour reporting. */
export function getDailyBilan(date?: string): DailyBilan {
  const day = date?.trim() || (db.prepare(`SELECT date('now', 'localtime') as d`).get() as { d: string }).d;

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN direction = 'entrant' THEN 1 ELSE 0 END) as incoming,
         SUM(CASE WHEN direction = 'sortant' THEN 1 ELSE 0 END) as outgoing,
         COUNT(DISTINCT contact_phone) as uniqueContacts
       FROM messages
       WHERE date(created_at) = ?`
    )
    .get(day) as { incoming: number | null; outgoing: number | null; uniqueContacts: number | null };

  const statusRows = db
    .prepare(`SELECT status, COUNT(*) as n FROM contacts GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;

  const contactsByStatus: Record<string, number> = {
    nouveau: 0,
    en_conversation: 0,
    interesse: 0,
    stop: 0,
  };
  for (const row of statusRows) {
    contactsByStatus[row.status] = Number(row.n);
  }

  const scheduledPending = (
    db.prepare(`SELECT COUNT(*) as n FROM scheduled_messages WHERE status = 'pending'`).get() as {
      n: number;
    }
  ).n;

  const scheduledSentToday = (
    db
      .prepare(
        `SELECT COUNT(*) as n FROM scheduled_messages
         WHERE status = 'sent' AND date(COALESCE(sent_at, send_at)) = ?`
      )
      .get(day) as { n: number }
  ).n;

  const topConversations = db
    .prepare(
      `SELECT m.contact_phone as phone,
              (SELECT name FROM contacts c WHERE c.phone = m.contact_phone) as name,
              COUNT(*) as messageCount,
              (SELECT body FROM messages m2
                 WHERE m2.contact_phone = m.contact_phone
                 ORDER BY m2.id DESC LIMIT 1) as lastMessage,
              MAX(m.created_at) as lastAt
       FROM messages m
       WHERE date(m.created_at) = ?
       GROUP BY m.contact_phone
       ORDER BY messageCount DESC
       LIMIT 15`
    )
    .all(day) as Array<{
    phone: string;
    name: string | null;
    messageCount: number;
    lastMessage: string;
    lastAt: string;
  }>;

  return {
    date: day,
    incoming: Number(counts.incoming ?? 0),
    outgoing: Number(counts.outgoing ?? 0),
    uniqueContacts: Number(counts.uniqueContacts ?? 0),
    contactsByStatus,
    scheduledPending: Number(scheduledPending),
    scheduledSentToday: Number(scheduledSentToday),
    topConversations,
  };
}

/* ── Automatisations ── */

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
  created_at: string;
  updated_at: string;
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function recomputeAutomationStats(automationId: number): AutomationStats {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as n FROM automation_targets
       WHERE automation_id = ? GROUP BY status`
    )
    .all(automationId) as Array<{ status: string; n: number }>;

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

  const auto = getAutomation(automationId);
  if (auto) {
    stats.messagesHandled = auto.stats.messagesHandled ?? 0;
    stats.outboundUsed = auto.stats.outboundUsed ?? 0;
    stats.report = auto.stats.report;
    stats.lastActionAt = auto.stats.lastActionAt;
  }

  db.prepare(
    `UPDATE automations SET stats_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(JSON.stringify(stats), automationId);

  return stats;
}

export function createAutomation(input: {
  name: string;
  type: AutomationType;
  config: AutomationConfig;
  summary?: string;
  budgetFcfa?: number;
  status?: AutomationStatus;
}): Automation {
  const result = db
    .prepare(
      `INSERT INTO automations (name, type, status, config_json, stats_json, summary, budget_fcfa)
       VALUES (?, ?, ?, ?, '{}', ?, ?)`
    )
    .run(
      input.name.trim(),
      input.type,
      input.status ?? "active",
      JSON.stringify(input.config),
      input.summary?.trim() || null,
      input.budgetFcfa ?? 0
    );

  const id = Number(result.lastInsertRowid);
  addAutomationLog(id, "info", `Automatisation créée : ${input.name}`);
  return getAutomation(id)!;
}

export function getAutomation(id: number): Automation | null {
  const row = db
    .prepare(
      `SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
       FROM automations WHERE id = ?`
    )
    .get(id) as Parameters<typeof parseAutomationRow>[0] | undefined;
  return row ? parseAutomationRow(row) : null;
}

export function listAutomations(options: { status?: AutomationStatus; limit?: number } = {}): Automation[] {
  const limit = options.limit ?? 100;
  const base =
    `SELECT id, name, type, status, config_json, stats_json, summary, budget_fcfa, created_at, updated_at
     FROM automations`;
  const rows = options.status
    ? (db
        .prepare(`${base} WHERE status = ? ORDER BY id DESC LIMIT ?`)
        .all(options.status, limit) as Parameters<typeof parseAutomationRow>[0][])
    : (db
        .prepare(`${base} ORDER BY id DESC LIMIT ?`)
        .all(limit) as Parameters<typeof parseAutomationRow>[0][]);
  return rows.map(parseAutomationRow);
}

export function listActiveAutomations(): Automation[] {
  return listAutomations({ status: "active", limit: 50 });
}

export function updateAutomationStatus(id: number, status: AutomationStatus): Automation | null {
  db.prepare(
    `UPDATE automations SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(status, id);
  addAutomationLog(id, "info", `Statut → ${status}`);
  return getAutomation(id);
}

export function updateAutomationStats(id: number, patch: Partial<AutomationStats>): Automation | null {
  const auto = getAutomation(id);
  if (!auto) return null;
  const stats = { ...auto.stats, ...patch };
  db.prepare(
    `UPDATE automations SET stats_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(JSON.stringify(stats), id);
  return getAutomation(id);
}

export function addAutomationTargets(
  automationId: number,
  targets: Array<{ targetId: string; targetLabel?: string }>
): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO automation_targets (automation_id, target_id, target_label)
     VALUES (?, ?, ?)`
  );
  let added = 0;
  for (const t of targets) {
    const r = stmt.run(automationId, t.targetId, t.targetLabel ?? null);
    if (r.changes > 0) added++;
  }
  recomputeAutomationStats(automationId);
  return added;
}

export function listAutomationTargets(
  automationId: number,
  options: { status?: TargetStatus; limit?: number } = {}
): AutomationTarget[] {
  const limit = options.limit ?? 500;
  const base = `SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
                FROM automation_targets WHERE automation_id = ?`;
  if (options.status) {
    return db
      .prepare(`${base} AND status = ? ORDER BY id ASC LIMIT ?`)
      .all(automationId, options.status, limit) as unknown as AutomationTarget[];
  }
  return db
    .prepare(`${base} ORDER BY id ASC LIMIT ?`)
    .all(automationId, limit) as unknown as AutomationTarget[];
}

export function updateAutomationTarget(
  automationId: number,
  targetId: string,
  patch: { status?: TargetStatus; notes?: string }
): void {
  if (patch.status && patch.notes !== undefined) {
    db.prepare(
      `UPDATE automation_targets
       SET last_action_at = datetime('now', 'localtime'), status = ?, notes = ?
       WHERE automation_id = ? AND target_id = ?`
    ).run(patch.status, patch.notes, automationId, targetId);
  } else if (patch.status) {
    db.prepare(
      `UPDATE automation_targets
       SET last_action_at = datetime('now', 'localtime'), status = ?
       WHERE automation_id = ? AND target_id = ?`
    ).run(patch.status, automationId, targetId);
  } else if (patch.notes !== undefined) {
    db.prepare(
      `UPDATE automation_targets
       SET last_action_at = datetime('now', 'localtime'), notes = ?
       WHERE automation_id = ? AND target_id = ?`
    ).run(patch.notes, automationId, targetId);
  } else {
    db.prepare(
      `UPDATE automation_targets
       SET last_action_at = datetime('now', 'localtime')
       WHERE automation_id = ? AND target_id = ?`
    ).run(automationId, targetId);
  }
  recomputeAutomationStats(automationId);
}

export function getNextPendingTarget(automationId: number): AutomationTarget | null {
  return (
    db
      .prepare(
        `SELECT id, automation_id, target_id, target_label, status, last_action_at, notes, ab_variant, created_at
         FROM automation_targets
         WHERE automation_id = ? AND status = 'pending'
         ORDER BY id ASC LIMIT 1`
      )
      .get(automationId) as AutomationTarget | undefined
  ) ?? null;
}

export function addAutomationLog(
  automationId: number,
  level: AutomationLog["level"],
  message: string
): AutomationLog {
  const result = db
    .prepare(`INSERT INTO automation_logs (automation_id, level, message) VALUES (?, ?, ?)`)
    .run(automationId, level, message);
  return {
    id: Number(result.lastInsertRowid),
    automation_id: automationId,
    level,
    message,
    created_at: new Date().toISOString(),
  };
}

export function listAutomationLogs(automationId: number, limit = 50): AutomationLog[] {
  return db
    .prepare(
      `SELECT id, automation_id, level, message, created_at
       FROM automation_logs WHERE automation_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(automationId, limit) as unknown as AutomationLog[];
}

export function getAutomationDetail(id: number): {
  automation: Automation;
  targets: AutomationTarget[];
  logs: AutomationLog[];
} | null {
  const automation = getAutomation(id);
  if (!automation) return null;
  const targets = listAutomationTargets(id);
  const logs = listAutomationLogs(id, 30);
  const stats = recomputeAutomationStats(id);
  automation.stats = stats;
  return { automation, targets, logs };
}

export function updateAutomationConfig(id: number, config: AutomationConfig): Automation | null {
  db.prepare(
    `UPDATE automations SET config_json = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(JSON.stringify(config), id);
  return getAutomation(id);
}

export function findMatchingKeywordAutomations(text: string): Automation[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const active = listActiveAutomations().filter((a) => a.type === "keyword_sales");
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

/* ── File d'envoi intelligente ── */

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

export function enqueueSend(input: {
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
}): QueueItem {
  const sendAt = input.sendAt ?? formatLocalDateTime(new Date());
  const result = db
    .prepare(
      `INSERT INTO send_queue (recipient, recipient_label, message, media_url, media_type, priority, send_at, automation_id, sequence_id, ab_variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.recipient,
      input.recipientLabel ?? null,
      input.message ?? null,
      input.mediaUrl ?? null,
      input.mediaType ?? null,
      input.priority ?? 5,
      sendAt,
      input.automationId ?? null,
      input.sequenceId ?? null,
      input.abVariant ?? null
    );
  return db
    .prepare(`SELECT * FROM send_queue WHERE id = ?`)
    .get(result.lastInsertRowid) as unknown as QueueItem;
}

export function getDueQueueItems(limit = 3): QueueItem[] {
  return db
    .prepare(
      `SELECT * FROM send_queue
       WHERE status = 'pending' AND send_at <= datetime('now', 'localtime')
       ORDER BY priority DESC, send_at ASC LIMIT ?`
    )
    .all(limit) as unknown as QueueItem[];
}

export function markQueueSent(id: number): void {
  db.prepare(
    `UPDATE send_queue SET status = 'sent', sent_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(id);
}

export function markQueueFailed(id: number, error: string): void {
  db.prepare(`UPDATE send_queue SET status = 'failed', error = ? WHERE id = ?`).run(error, id);
}

/* ── Séquences multi-étapes ── */

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

export function createContactSequence(input: {
  contactPhone: string;
  name: string;
  steps: SequenceStep[];
  automationId?: number;
}): ContactSequence {
  const phone = normalizeContactPhone(input.contactPhone);
  const firstDelay = input.steps[0]?.delayDays ?? 0;
  const nextAt = new Date();
  nextAt.setDate(nextAt.getDate() + firstDelay);
  const result = db
    .prepare(
      `INSERT INTO contact_sequences (contact_phone, automation_id, name, steps_json, next_step_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      phone,
      input.automationId ?? null,
      input.name,
      JSON.stringify(input.steps),
      formatLocalDateTime(nextAt)
    );
  return getContactSequence(Number(result.lastInsertRowid))!;
}

export function getContactSequence(id: number): ContactSequence | null {
  const row = db.prepare(`SELECT * FROM contact_sequences WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
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
    next_step_at: row.next_step_at ? String(row.next_step_at) : null,
    created_at: String(row.created_at),
  };
}

export function listDueSequences(limit = 20): ContactSequence[] {
  const rows = db
    .prepare(
      `SELECT id FROM contact_sequences
       WHERE status = 'active' AND next_step_at IS NOT NULL AND next_step_at <= datetime('now', 'localtime')
       ORDER BY next_step_at ASC LIMIT ?`
    )
    .all(limit) as Array<{ id: number }>;
  return rows.map((r) => getContactSequence(r.id)).filter(Boolean) as ContactSequence[];
}

export function advanceSequence(id: number): void {
  const seq = getContactSequence(id);
  if (!seq) return;
  const nextStep = seq.current_step + 1;
  if (nextStep >= seq.steps.length) {
    db.prepare(`UPDATE contact_sequences SET status = 'completed', next_step_at = NULL WHERE id = ?`).run(id);
    return;
  }
  const delay = seq.steps[nextStep]?.delayDays ?? 1;
  const nextAt = new Date();
  nextAt.setDate(nextAt.getDate() + delay);
  db.prepare(
    `UPDATE contact_sequences SET current_step = ?, next_step_at = ? WHERE id = ?`
  ).run(nextStep, formatLocalDateTime(nextAt), id);
}

export function cancelSequencesForContact(phone: string): void {
  const chatId = normalizeContactPhone(phone);
  db.prepare(
    `UPDATE contact_sequences SET status = 'cancelled', next_step_at = NULL WHERE contact_phone = ? AND status = 'active'`
  ).run(chatId);
}

/* ── Règles groupes ── */

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

export function createGroupReplyRule(input: {
  groupId: string;
  groupLabel?: string;
  keywords: string[];
  replyGuide?: string;
  automationId?: number;
}): GroupReplyRule {
  const result = db
    .prepare(
      `INSERT INTO group_reply_rules (group_id, group_label, keywords_json, reply_guide, automation_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.groupId,
      input.groupLabel ?? null,
      JSON.stringify(input.keywords),
      input.replyGuide ?? null,
      input.automationId ?? null
    );
  return getGroupReplyRule(Number(result.lastInsertRowid))!;
}

export function getGroupReplyRule(id: number): GroupReplyRule | null {
  const row = db.prepare(`SELECT * FROM group_reply_rules WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  let keywords: string[] = [];
  try {
    keywords = JSON.parse(String(row.keywords_json || "[]")) as string[];
  } catch {
    /* ignore */
  }
  return {
    id: Number(row.id),
    group_id: String(row.group_id),
    group_label: row.group_label ? String(row.group_label) : null,
    keywords,
    reply_guide: row.reply_guide ? String(row.reply_guide) : null,
    automation_id: row.automation_id != null ? Number(row.automation_id) : null,
    status: String(row.status),
    created_at: String(row.created_at),
  };
}

export function listActiveGroupReplyRules(): GroupReplyRule[] {
  const rows = db
    .prepare(`SELECT id FROM group_reply_rules WHERE status = 'active'`)
    .all() as Array<{ id: number }>;
  return rows.map((r) => getGroupReplyRule(r.id)).filter(Boolean) as GroupReplyRule[];
}

export function findGroupReplyRule(groupId: string, text: string): GroupReplyRule | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  for (const rule of listActiveGroupReplyRules()) {
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

/* ── Handoff humain ── */

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

export function createHandoffEvent(input: {
  contactPhone: string;
  contactName?: string;
  reason: string;
  summary?: string;
  suggestedReply?: string;
}): HandoffEvent {
  const phone = normalizeContactPhone(input.contactPhone);
  setContactHandoff(phone, "pending");
  const result = db
    .prepare(
      `INSERT INTO handoff_events (contact_phone, contact_name, reason, summary, suggested_reply)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      phone,
      input.contactName ?? null,
      input.reason,
      input.summary ?? null,
      input.suggestedReply ?? null
    );
  return db
    .prepare(`SELECT * FROM handoff_events WHERE id = ?`)
    .get(result.lastInsertRowid) as unknown as HandoffEvent;
}

export function listPendingHandoffs(limit = 30): HandoffEvent[] {
  return db
    .prepare(
      `SELECT * FROM handoff_events WHERE status = 'pending' ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as unknown as HandoffEvent[];
}

export function resolveHandoff(id: number, status: "resolved" | "dismissed"): void {
  const row = db.prepare(`SELECT contact_phone FROM handoff_events WHERE id = ?`).get(id) as
    | { contact_phone: string }
    | undefined;
  db.prepare(
    `UPDATE handoff_events SET status = ?, resolved_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(status, id);
  if (row) setContactHandoff(row.contact_phone, null);
}

export function updateAutomationTargetAb(
  automationId: number,
  targetId: string,
  abVariant: string
): void {
  db.prepare(
    `UPDATE automation_targets SET ab_variant = ?, last_action_at = datetime('now', 'localtime')
     WHERE automation_id = ? AND target_id = ?`
  ).run(abVariant, automationId, targetId);
}

console.log(`📦 SQLite prêt : ${dbPath}`);
