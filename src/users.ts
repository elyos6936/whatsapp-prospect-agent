import { sql } from "./pg.js";
import { userIdFromEvolutionInstance } from "./config.js";
import {
  outreachLevelFromTotalSent,
  TRIAL_MAX_CONVERSATIONS,
  type OutreachLevel,
  type SubscriptionStatus,
} from "./outreach-level.js";

export type AccountStatus = "active" | "suspended";

export interface UserRecord {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  onboarding_completed: boolean;
  onboarding_answers: Record<string, unknown> | null;
  business_owner_name: string;
  business_offer: string;
  business_price: string;
  google_contacts_prompt_done: boolean;
  total_messages_sent: number;
  outreach_level: OutreachLevel;
  subscription_status: SubscriptionStatus;
  trial_conversations_used: number;
  last_weekly_report_week: string | null;
  last_reported_outreach_level: number | null;
  account_status: AccountStatus;
  suspended_at: string | null;
  suspended_reason: string | null;
  deleted_at: string | null;
  created_at: string;
}

function mapUser(row: Record<string, unknown>): UserRecord {
  const levelRaw = Number(row.outreach_level ?? 1);
  const level = (levelRaw >= 1 && levelRaw <= 5 ? levelRaw : 1) as OutreachLevel;
  const statusRaw = String(row.subscription_status ?? "active");
  const status: SubscriptionStatus =
    statusRaw === "active" || statusRaw === "expired" ? statusRaw : "trial";
  const accountRaw = String(row.account_status ?? "active");
  const accountStatus: AccountStatus = accountRaw === "suspended" ? "suspended" : "active";
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name ?? ""),
    avatar_url: String(row.avatar_url ?? ""),
    onboarding_completed: Boolean(row.onboarding_completed),
    onboarding_answers: (row.onboarding_answers as Record<string, unknown>) ?? null,
    business_owner_name: String(row.business_owner_name ?? ""),
    business_offer: String(row.business_offer ?? ""),
    business_price: String(row.business_price ?? ""),
    google_contacts_prompt_done: Boolean(row.google_contacts_prompt_done),
    total_messages_sent: Number(row.total_messages_sent ?? 0),
    outreach_level: level,
    subscription_status: status,
    trial_conversations_used: Number(row.trial_conversations_used ?? 0),
    last_weekly_report_week:
      row.last_weekly_report_week != null ? String(row.last_weekly_report_week) : null,
    last_reported_outreach_level:
      row.last_reported_outreach_level != null
        ? Number(row.last_reported_outreach_level)
        : null,
    account_status: accountStatus,
    suspended_at: row.suspended_at != null ? String(row.suspended_at) : null,
    suspended_reason: row.suspended_reason != null ? String(row.suspended_reason) : null,
    deleted_at: row.deleted_at != null ? String(row.deleted_at) : null,
    created_at: String(row.created_at ?? ""),
  };
}

/** Accès client autorisé ? (pas suspendu, pas soft-deleted). */
export function getAccountAccessBlock(user: UserRecord | null): string | null {
  if (!user) return "Utilisateur introuvable.";
  if (user.deleted_at) return "Ce compte a été supprimé.";
  if (user.account_status !== "active") {
    return user.suspended_reason?.trim()
      ? `Compte suspendu : ${user.suspended_reason.trim()}`
      : "Compte suspendu.";
  }
  return null;
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    onboarding_completed: user.onboarding_completed,
    google_contacts_prompt_done: user.google_contacts_prompt_done,
    subscription_status: user.subscription_status,
    outreach_level: user.outreach_level,
    total_messages_sent: user.total_messages_sent,
    trial_conversations_used: user.trial_conversations_used,
    account_status: user.account_status,
    business: {
      ownerName: user.business_owner_name,
      offer: user.business_offer,
      price: user.business_price,
    },
  };
}

let schemaReady = false;

export async function ensureUserOutreachSchema(): Promise<void> {
  if (schemaReady) return;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS google_contacts_prompt_done BOOLEAN NOT NULL DEFAULT false
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS total_messages_sent INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS outreach_level INTEGER NOT NULL DEFAULT 1
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active'
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS trial_conversations_used INTEGER NOT NULL DEFAULT 0
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_weekly_report_week TEXT
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_reported_outreach_level INTEGER
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS suspended_reason TEXT
  `;
  await sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `;
  // Registre anti-abus : 1 WhatsApp = 1 compte Klanvio
  const { ensureWhatsAppPhoneRegistrySchema } = await import("./whatsapp-phone-registry.js");
  await ensureWhatsAppPhoneRegistrySchema();
  schemaReady = true;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
}): Promise<UserRecord> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO users (
      email, password_hash, name,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used
    )
    VALUES (
      ${input.email.trim().toLowerCase()}, ${input.passwordHash}, ${input.name.trim()},
      0, 1, 'active', 0
    )
    RETURNING
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
  `;
  return mapUser(rows[0]);
}

export async function createGoogleUser(input: {
  email: string;
  name: string;
  googleSub: string;
  avatarUrl?: string;
}): Promise<UserRecord> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO users (
      email, name, google_sub, avatar_url,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used
    )
    VALUES (
      ${input.email.trim().toLowerCase()},
      ${input.name.trim()},
      ${input.googleSub},
      ${input.avatarUrl?.trim() || null},
      0, 1, 'active', 0
    )
    RETURNING
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
  `;
  return mapUser(rows[0]);
}

export async function linkGoogleAccount(
  userId: number,
  input: { googleSub: string; avatarUrl?: string }
): Promise<UserRecord> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users SET
      google_sub = ${input.googleSub},
      avatar_url = COALESCE(${input.avatarUrl?.trim() || null}, avatar_url)
    WHERE id = ${userId}
    RETURNING
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
  `;
  return mapUser(rows[0]);
}

export async function getUserByEmail(
  email: string
): Promise<(UserRecord & { password_hash: string | null }) | null> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      id, email, password_hash, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
    FROM users WHERE email = ${email.trim().toLowerCase()}
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...mapUser(row),
    password_hash: row.password_hash == null ? null : String(row.password_hash),
  };
}

export async function getUserByGoogleSub(googleSub: string): Promise<UserRecord | null> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
    FROM users WHERE google_sub = ${googleSub}
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

export async function getUserById(id: number): Promise<UserRecord | null> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
    FROM users WHERE id = ${id}
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

export async function userIdFromInstanceName(instance: string): Promise<number | null> {
  return userIdFromEvolutionInstance(instance);
}

export async function listUserIds(): Promise<number[]> {
  await ensureUserOutreachSchema();
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM users
    WHERE deleted_at IS NULL AND account_status = 'active'
    ORDER BY id
  `;
  return rows.map((r) => Number(r.id));
}

export async function listActiveUserIds(): Promise<number[]> {
  await ensureUserOutreachSchema();
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM users
    WHERE onboarding_completed = true
      AND deleted_at IS NULL
      AND account_status = 'active'
    ORDER BY id
  `;
  return rows.map((r) => Number(r.id));
}

export async function completeOnboarding(
  userId: number,
  input: {
    answers: Record<string, unknown>;
    business_owner_name?: string;
    business_offer?: string;
    business_price?: string;
  }
): Promise<UserRecord> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users SET
      onboarding_completed = true,
      onboarding_answers = ${JSON.stringify(input.answers)}::jsonb,
      business_owner_name = COALESCE(${input.business_owner_name?.trim() ?? null}, business_owner_name),
      business_offer = COALESCE(${input.business_offer?.trim() ?? null}, business_offer),
      business_price = COALESCE(${input.business_price?.trim() ?? null}, business_price)
    WHERE id = ${userId}
    RETURNING
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
  `;
  return mapUser(rows[0]);
}

export async function saveUserBusinessProfile(
  userId: number,
  input: { ownerName?: string; offer?: string; price?: string }
): Promise<void> {
  await sql`
    UPDATE users SET
      business_owner_name = COALESCE(${input.ownerName?.trim() ?? null}, business_owner_name),
      business_offer = COALESCE(${input.offer?.trim() ?? null}, business_offer),
      business_price = COALESCE(${input.price?.trim() ?? null}, business_price)
    WHERE id = ${userId}
  `;
}

export async function markGoogleContactsPromptDone(userId: number): Promise<UserRecord | null> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users SET google_contacts_prompt_done = true
    WHERE id = ${userId}
    RETURNING
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

/** Incrémente le compteur lifetime sortant + recalcule le niveau. */
export async function recordOutboundMessageSent(
  userId: number
): Promise<{ total: number; level: OutreachLevel; leveledUp: boolean }> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users
    SET total_messages_sent = total_messages_sent + 1
    WHERE id = ${userId}
    RETURNING total_messages_sent, outreach_level
  `;
  const total = Number(rows[0]?.total_messages_sent ?? 0);
  const prevLevel = Number(rows[0]?.outreach_level ?? 1) as OutreachLevel;
  const nextLevel = outreachLevelFromTotalSent(total);
  if (nextLevel !== prevLevel) {
    await sql`UPDATE users SET outreach_level = ${nextLevel} WHERE id = ${userId}`;
    return { total, level: nextLevel, leveledUp: nextLevel > prevLevel };
  }
  return { total, level: prevLevel, leveledUp: false };
}

/**
 * Réserve une conversation d'essai (atomique).
 * Compte actif / expiré → toujours OK (pas de plafond essai).
 */
export async function tryConsumeTrialConversation(userId: number): Promise<boolean> {
  await ensureUserOutreachSchema();
  const user = await getUserById(userId);
  if (!user) return false;
  if (user.subscription_status !== "trial") return true;

  const rows = await sql<{ trial_conversations_used: number }[]>`
    UPDATE users
    SET trial_conversations_used = trial_conversations_used + 1
    WHERE id = ${userId}
      AND subscription_status = 'trial'
      AND trial_conversations_used < ${TRIAL_MAX_CONVERSATIONS}
    RETURNING trial_conversations_used
  `;
  return rows.length > 0;
}

export async function setSubscriptionStatus(
  userId: number,
  status: SubscriptionStatus
): Promise<UserRecord | null> {
  await ensureUserOutreachSchema();
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users SET subscription_status = ${status}
    WHERE id = ${userId}
    RETURNING
      id, email, name, avatar_url, onboarding_completed, onboarding_answers,
      business_owner_name, business_offer, business_price,
      google_contacts_prompt_done,
      total_messages_sent, outreach_level, subscription_status, trial_conversations_used,
      last_weekly_report_week, last_reported_outreach_level, created_at,
      account_status, suspended_at, suspended_reason, deleted_at
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

export async function markWeeklyReportSent(
  userId: number,
  fridayKey: string,
  outreachLevel: number
): Promise<void> {
  await ensureUserOutreachSchema();
  await sql`
    UPDATE users SET
      last_weekly_report_week = ${fridayKey},
      last_reported_outreach_level = ${outreachLevel}
    WHERE id = ${userId}
  `;
}
