import { sql } from "./pg.js";
import { userIdFromEvolutionInstance } from "./config.js";

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
  created_at: string;
}

function mapUser(row: Record<string, unknown>): UserRecord {
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
    created_at: String(row.created_at ?? ""),
  };
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    onboarding_completed: user.onboarding_completed,
    business: {
      ownerName: user.business_owner_name,
      offer: user.business_offer,
      price: user.business_price,
    },
  };
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
}): Promise<UserRecord> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO users (email, password_hash, name)
    VALUES (${input.email.trim().toLowerCase()}, ${input.passwordHash}, ${input.name.trim()})
    RETURNING id, email, name, avatar_url, onboarding_completed, onboarding_answers,
              business_owner_name, business_offer, business_price, created_at
  `;
  return mapUser(rows[0]);
}

/** Crée un compte via Google (sans mot de passe local). */
export async function createGoogleUser(input: {
  email: string;
  name: string;
  googleSub: string;
  avatarUrl?: string;
}): Promise<UserRecord> {
  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO users (email, name, google_sub, avatar_url)
    VALUES (
      ${input.email.trim().toLowerCase()},
      ${input.name.trim()},
      ${input.googleSub},
      ${input.avatarUrl?.trim() || null}
    )
    RETURNING id, email, name, avatar_url, onboarding_completed, onboarding_answers,
              business_owner_name, business_offer, business_price, created_at
  `;
  return mapUser(rows[0]);
}

/** Relie un compte existant (créé par email/mot de passe) à un identifiant Google. */
export async function linkGoogleAccount(
  userId: number,
  input: { googleSub: string; avatarUrl?: string },
): Promise<UserRecord> {
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users SET
      google_sub = ${input.googleSub},
      avatar_url = COALESCE(${input.avatarUrl?.trim() || null}, avatar_url)
    WHERE id = ${userId}
    RETURNING id, email, name, avatar_url, onboarding_completed, onboarding_answers,
              business_owner_name, business_offer, business_price, created_at
  `;
  return mapUser(rows[0]);
}

export async function getUserByEmail(email: string): Promise<(UserRecord & { password_hash: string | null }) | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, email, password_hash, name, avatar_url, onboarding_completed, onboarding_answers,
           business_owner_name, business_offer, business_price, created_at
    FROM users WHERE email = ${email.trim().toLowerCase()}
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return { ...mapUser(row), password_hash: row.password_hash == null ? null : String(row.password_hash) };
}

export async function getUserByGoogleSub(googleSub: string): Promise<UserRecord | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, email, name, avatar_url, onboarding_completed, onboarding_answers,
           business_owner_name, business_offer, business_price, created_at
    FROM users WHERE google_sub = ${googleSub}
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

export async function getUserById(id: number): Promise<UserRecord | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, email, name, avatar_url, onboarding_completed, onboarding_answers,
           business_owner_name, business_offer, business_price, created_at
    FROM users WHERE id = ${id}
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

export async function userIdFromInstanceName(instance: string): Promise<number | null> {
  return userIdFromEvolutionInstance(instance);
}

export async function listUserIds(): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM users ORDER BY id`;
  return rows.map((r) => Number(r.id));
}

/**
 * Utilisateurs éligibles aux jobs de fond (onboarding terminé).
 * Évite de solliciter l'API Evolution / la DB pour les comptes qui n'ont
 * jamais fini l'inscription ni connecté WhatsApp.
 */
export async function listActiveUserIds(): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE onboarding_completed = true ORDER BY id
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
  },
): Promise<UserRecord> {
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE users SET
      onboarding_completed = true,
      onboarding_answers = ${JSON.stringify(input.answers)}::jsonb,
      business_owner_name = COALESCE(${input.business_owner_name?.trim() ?? null}, business_owner_name),
      business_offer = COALESCE(${input.business_offer?.trim() ?? null}, business_offer),
      business_price = COALESCE(${input.business_price?.trim() ?? null}, business_price)
    WHERE id = ${userId}
    RETURNING id, email, name, avatar_url, onboarding_completed, onboarding_answers,
              business_owner_name, business_offer, business_price, created_at
  `;
  return mapUser(rows[0]);
}

export async function saveUserBusinessProfile(
  userId: number,
  input: { ownerName?: string; offer?: string; price?: string },
): Promise<void> {
  await sql`
    UPDATE users SET
      business_owner_name = COALESCE(${input.ownerName?.trim() ?? null}, business_owner_name),
      business_offer = COALESCE(${input.offer?.trim() ?? null}, business_offer),
      business_price = COALESCE(${input.price?.trim() ?? null}, business_price)
    WHERE id = ${userId}
  `;
}
