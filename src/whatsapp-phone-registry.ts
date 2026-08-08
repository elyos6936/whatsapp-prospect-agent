/**
 * Registre permanent : 1 numéro WhatsApp = 1 compte Klanvio.
 * Ne se libère PAS au logout (anti-abus essai multi-comptes).
 */
import { sql } from "./pg.js";

let schemaReady = false;

/** Normalise owner/JID → chiffres uniquement (copie locale, pas d'import evolutionapi). */
export function normalizeBindingPhone(raw: string): string {
  return String(raw || "")
    .replace(/@.*$/, "")
    .replace(/\D/g, "");
}

function phonesMatch(a: string, b: string): boolean {
  const x = normalizeBindingPhone(a);
  const y = normalizeBindingPhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 8 && y.length >= 8 && (x.endsWith(y) || y.endsWith(x))) return true;
  return false;
}

export async function ensureWhatsAppPhoneRegistrySchema(): Promise<void> {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_phone_bindings (
      phone_key TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_bindings_user
      ON whatsapp_phone_bindings (user_id)
  `;
  schemaReady = true;
}

export type WhatsAppPhoneBinding = {
  phoneKey: string;
  userId: number;
  boundAt: string;
  lastSeenAt: string;
};

/**
 * Cherche une liaison existante pour ce numéro (exact ou variante indicatif).
 */
export async function findWhatsAppPhoneBinding(
  phoneDigits: string
): Promise<WhatsAppPhoneBinding | null> {
  await ensureWhatsAppPhoneRegistrySchema();
  const phone = normalizeBindingPhone(phoneDigits);
  if (!phone || phone.length < 8) return null;

  const exact = await sql<
    { phone_key: string; user_id: number; bound_at: string; last_seen_at: string }[]
  >`
    SELECT phone_key, user_id, bound_at::text, last_seen_at::text
    FROM whatsapp_phone_bindings
    WHERE phone_key = ${phone}
    LIMIT 1
  `;
  if (exact[0]) {
    return {
      phoneKey: exact[0].phone_key,
      userId: Number(exact[0].user_id),
      boundAt: exact[0].bound_at,
      lastSeenAt: exact[0].last_seen_at,
    };
  }

  const suffix = phone.slice(-10);
  const candidates = await sql<
    { phone_key: string; user_id: number; bound_at: string; last_seen_at: string }[]
  >`
    SELECT phone_key, user_id, bound_at::text, last_seen_at::text
    FROM whatsapp_phone_bindings
    WHERE right(phone_key, 10) = ${suffix}
       OR phone_key LIKE ${"%" + suffix}
       OR ${phone} LIKE ('%' || phone_key)
    LIMIT 50
  `;
  for (const row of candidates) {
    if (phonesMatch(phone, row.phone_key)) {
      return {
        phoneKey: row.phone_key,
        userId: Number(row.user_id),
        boundAt: row.bound_at,
        lastSeenAt: row.last_seen_at,
      };
    }
  }
  return null;
}

/**
 * Refuse si le numéro est déjà lié à un AUTRE user.
 * OK si libre ou déjà à soi.
 */
export async function assertWhatsAppPhoneAvailableForUser(
  userId: number,
  phoneDigits: string
): Promise<{ ok: true } | { ok: false; conflictUserId: number; phoneKey: string }> {
  const binding = await findWhatsAppPhoneBinding(phoneDigits);
  if (!binding) return { ok: true };
  if (binding.userId === userId) return { ok: true };
  return {
    ok: false,
    conflictUserId: binding.userId,
    phoneKey: binding.phoneKey,
  };
}

/**
 * Enregistre / rafraîchit la liaison (appelé après connexion réussie).
 * Ne remplace jamais un propriétaire différent (double check).
 */
export async function claimWhatsAppPhoneForUser(
  userId: number,
  phoneDigits: string
): Promise<{ ok: true; phoneKey: string } | { ok: false; conflictUserId: number }> {
  await ensureWhatsAppPhoneRegistrySchema();
  const phone = normalizeBindingPhone(phoneDigits);
  if (!phone || phone.length < 8) {
    return { ok: true, phoneKey: phone || "" };
  }

  const available = await assertWhatsAppPhoneAvailableForUser(userId, phone);
  if (!available.ok) {
    return { ok: false, conflictUserId: available.conflictUserId };
  }

  const existing = await findWhatsAppPhoneBinding(phone);
  if (existing && existing.userId === userId) {
    await sql`
      UPDATE whatsapp_phone_bindings
      SET last_seen_at = NOW()
      WHERE phone_key = ${existing.phoneKey}
    `;
    return { ok: true, phoneKey: existing.phoneKey };
  }

  try {
    await sql`
      INSERT INTO whatsapp_phone_bindings (phone_key, user_id, bound_at, last_seen_at)
      VALUES (${phone}, ${userId}, NOW(), NOW())
      ON CONFLICT (phone_key) DO UPDATE SET
        last_seen_at = NOW()
      WHERE whatsapp_phone_bindings.user_id = ${userId}
    `;
  } catch (err) {
    const again = await findWhatsAppPhoneBinding(phone);
    if (again && again.userId !== userId) {
      return { ok: false, conflictUserId: again.userId };
    }
    throw err;
  }

  const verify = await findWhatsAppPhoneBinding(phone);
  if (verify && verify.userId !== userId) {
    return { ok: false, conflictUserId: verify.userId };
  }
  return { ok: true, phoneKey: phone };
}

/**
 * Libération manuelle (support / admin uniquement).
 * Ne pas appeler au logout utilisateur.
 */
export async function releaseWhatsAppPhoneBinding(
  phoneDigits: string
): Promise<boolean> {
  await ensureWhatsAppPhoneRegistrySchema();
  const phone = normalizeBindingPhone(phoneDigits);
  if (!phone) return false;
  const binding = await findWhatsAppPhoneBinding(phone);
  if (!binding) return false;
  const result = await sql`
    DELETE FROM whatsapp_phone_bindings WHERE phone_key = ${binding.phoneKey}
  `;
  return result.count > 0;
}

export async function releaseAllWhatsAppPhoneBindingsForUser(
  userId: number
): Promise<number> {
  await ensureWhatsAppPhoneRegistrySchema();
  const result = await sql`
    DELETE FROM whatsapp_phone_bindings WHERE user_id = ${userId}
  `;
  return result.count;
}

export async function listWhatsAppPhoneBindingsForUser(
  userId: number
): Promise<WhatsAppPhoneBinding[]> {
  await ensureWhatsAppPhoneRegistrySchema();
  const rows = await sql<
    { phone_key: string; user_id: number; bound_at: string; last_seen_at: string }[]
  >`
    SELECT phone_key, user_id, bound_at::text, last_seen_at::text
    FROM whatsapp_phone_bindings
    WHERE user_id = ${userId}
    ORDER BY bound_at ASC
  `;
  return rows.map((r) => ({
    phoneKey: r.phone_key,
    userId: Number(r.user_id),
    boundAt: r.bound_at,
    lastSeenAt: r.last_seen_at,
  }));
}

export const WHATSAPP_PHONE_CONFLICT_MESSAGE =
  "Ce numéro WhatsApp est déjà associé à un autre compte Klanvio. " +
  "Un numéro = un compte (même après déconnexion). " +
  "Connecte-toi sur le compte d’origine ou utilise un autre numéro.";
