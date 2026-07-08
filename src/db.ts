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

  CREATE TABLE IF NOT EXISTS ads_agent_conversation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
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
  business_owner_name: string;
  business_offer: string;
  business_price: string;
  meta_access_token: string;
  meta_ad_account_id: string;
  meta_page_id: string;
  meta_whatsapp_number: string;
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
    business_owner_name: getSetting("business_owner_name") || "",
    business_offer: getSetting("business_offer") || "",
    business_price: getSetting("business_price") || "",
    meta_access_token: getSetting("meta_access_token") || config.envMetaAccessToken,
    meta_ad_account_id: getSetting("meta_ad_account_id") || config.envMetaAdAccountId,
    meta_page_id: getSetting("meta_page_id") || config.envMetaPageId,
    meta_whatsapp_number: getSetting("meta_whatsapp_number") || config.envMetaWhatsappNumber,
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

export function saveBusinessProfile(input: {
  ownerName?: string;
  offer?: string;
  price?: string;
}): void {
  if (input.ownerName !== undefined) setSetting("business_owner_name", input.ownerName.trim());
  if (input.offer !== undefined) setSetting("business_offer", input.offer.trim());
  if (input.price !== undefined) setSetting("business_price", input.price.trim());
}

export function saveMetaAdsSettings(input: {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  whatsappNumber?: string;
}): void {
  setSetting("meta_access_token", input.accessToken.trim());
  let adAccountId = input.adAccountId.trim();
  if (adAccountId && !adAccountId.startsWith("act_")) {
    adAccountId = `act_${adAccountId.replace(/^act_/, "")}`;
  }
  setSetting("meta_ad_account_id", adAccountId);
  setSetting("meta_page_id", input.pageId.trim());
  if (input.whatsappNumber !== undefined) {
    setSetting("meta_whatsapp_number", input.whatsappNumber.trim());
  }
}

export function saveAdsAgentMessage(role: AgentRole, content: string): AgentMessage {
  const result = db
    .prepare("INSERT INTO ads_agent_conversation (role, content) VALUES (?, ?)")
    .run(role, content);

  return db
    .prepare("SELECT id, role, content, created_at FROM ads_agent_conversation WHERE id = ?")
    .get(result.lastInsertRowid) as unknown as AgentMessage;
}

export function getRecentAdsAgentMessages(limit = 50): AgentMessage[] {
  const rows = db
    .prepare(
      `SELECT id, role, content, created_at
       FROM ads_agent_conversation
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as AgentMessage[];

  return rows.reverse();
}

export function getAdsAgentMessagesSince(sinceId = 0, limit = 50): AgentMessage[] {
  return db
    .prepare(
      `SELECT id, role, content, created_at
       FROM ads_agent_conversation
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(sinceId, limit) as unknown as AgentMessage[];
}

export function clearAdsAgentConversation(): void {
  db.prepare("DELETE FROM ads_agent_conversation").run();
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

export function getContactChatHistory(chatId: string, limit = 12): WhatsAppMessage[] {
  const rows = db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE contact_phone = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(chatId, limit) as unknown as WhatsAppMessage[];
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
  created_at: string;
  updated_at: string;
}

function normalizeContactPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.endsWith("@g.us") || trimmed.endsWith("@lid")) {
    throw new Error("Les groupes WhatsApp ne peuvent pas être enregistrés comme contacts de prospection.");
  }
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) throw new Error("Numéro de téléphone invalide.");
  return `${digits}@c.us`;
}

export function getContact(phone: string): Contact | null {
  const trimmed = phone.trim();
  // Les groupes ne sont pas des contacts de prospection
  if (trimmed.endsWith("@g.us") || trimmed.endsWith("@lid")) return null;

  const chatId = normalizeContactPhone(trimmed);
  const row = db
    .prepare(
      `SELECT id, phone, name, notes, status, auto_reply, created_at, updated_at
       FROM contacts WHERE phone = ?`
    )
    .get(chatId) as Contact | undefined;
  return row ?? null;
}

export function listContacts(options: { status?: ContactStatus; limit?: number } = {}): Contact[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  if (options.status) {
    return db
      .prepare(
        `SELECT id, phone, name, notes, status, auto_reply, created_at, updated_at
         FROM contacts WHERE status = ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(options.status, limit) as unknown as Contact[];
  }
  return db
    .prepare(
      `SELECT id, phone, name, notes, status, auto_reply, created_at, updated_at
       FROM contacts
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(limit) as unknown as Contact[];
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
  } = { phone: chatId };

  if (senderName && !existing.name) updates.name = senderName;
  if (existing.status === "nouveau") updates.status = "en_conversation";

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
  const contact = getContact(chatId);
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
  const contact = getContact(chatId);
  // Nouveau contact sans fiche : on répond (défaut touchIncomingContact mets auto_reply=1)
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
  const chatId = trimmed.includes("@")
    ? trimmed
    : `${trimmed.replace(/\D/g, "")}@c.us`;
  return db
    .prepare(
      `SELECT id, contact_phone, sender_name, direction, body, green_api_id, created_at
       FROM messages
       WHERE contact_phone = ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(chatId, limit) as unknown as WhatsAppMessage[];
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

console.log(`📦 SQLite prêt : ${dbPath}`);
