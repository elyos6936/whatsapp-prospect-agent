import { sql } from "./pg.js";

export interface UserRecord {
  id: number;
  email: string;
  name: string;
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
    RETURNING id, email, name, onboarding_completed, onboarding_answers,
              business_owner_name, business_offer, business_price, created_at
  `;
  return mapUser(rows[0]);
}

export async function getUserByEmail(email: string): Promise<(UserRecord & { password_hash: string }) | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, email, password_hash, name, onboarding_completed, onboarding_answers,
           business_owner_name, business_offer, business_price, created_at
    FROM users WHERE email = ${email.trim().toLowerCase()}
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return { ...mapUser(row), password_hash: String(row.password_hash) };
}

export async function getUserById(id: number): Promise<UserRecord | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, email, name, onboarding_completed, onboarding_answers,
           business_owner_name, business_offer, business_price, created_at
    FROM users WHERE id = ${id}
  `;
  return rows.length ? mapUser(rows[0]) : null;
}

export async function userIdFromInstanceName(instance: string): Promise<number | null> {
  const m = /^klanvio_(\d+)$/i.exec(String(instance ?? "").trim());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
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
    RETURNING id, email, name, onboarding_completed, onboarding_answers,
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
