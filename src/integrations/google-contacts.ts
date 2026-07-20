/**
 * Google Contacts via People API — création avant envoi campagne.
 * No-op silencieux si scope absent ; jamais bloquant pour enqueueSend.
 */

import { sql } from "../pg.js";
import { getUserIntegration } from "../integrations-db.js";
import { getValidGoogleAccessToken } from "./access.js";
import {
  GOOGLE_PROVIDER,
  GoogleAuthError,
  hasGoogleContactsScope,
  searchGoogleContactByPhone,
  createGoogleContact,
  phoneKeyFromWhatsAppId,
  toE164Display,
} from "./google.js";

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS google_contacts_ensured (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone_key TEXT NOT NULL,
      resource_name TEXT,
      ensured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, phone_key)
    )
  `;
  schemaReady = true;
}

async function wasEnsured(userId: number, phoneKey: string): Promise<boolean> {
  await ensureSchema();
  const rows = await sql`
    SELECT 1
    FROM google_contacts_ensured
    WHERE user_id = ${userId} AND phone_key = ${phoneKey}
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

async function markEnsured(
  userId: number,
  phoneKey: string,
  resourceName: string | null,
): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO google_contacts_ensured (user_id, phone_key, resource_name, ensured_at)
    VALUES (${userId}, ${phoneKey}, ${resourceName}, NOW())
    ON CONFLICT (user_id, phone_key) DO UPDATE SET
      resource_name = COALESCE(EXCLUDED.resource_name, google_contacts_ensured.resource_name),
      ensured_at = NOW()
  `;
}

/**
 * Avant enqueueSend : si Google Contacts (People) est connecté, crée la fiche
 * pour ce numéro s'il n'existe pas encore. Ne throw jamais vers l'appelant métier.
 */
export async function ensureGoogleContactBeforeSend(
  userId: number,
  input: { phone: string; name?: string | null },
): Promise<void> {
  try {
    const phoneKey = phoneKeyFromWhatsAppId(input.phone);
    if (!phoneKey) return;

    if (await wasEnsured(userId, phoneKey)) return;

    const row = await getUserIntegration(userId, GOOGLE_PROVIDER);
    if (!row || !hasGoogleContactsScope(row.scopes)) return;

    const accessToken = await getValidGoogleAccessToken(userId);
    const e164 = toE164Display(phoneKey);
    const displayName =
      (input.name && String(input.name).trim()) || e164;

    const existing = await searchGoogleContactByPhone(accessToken, phoneKey);
    if (existing) {
      await markEnsured(userId, phoneKey, existing);
      return;
    }

    const created = await createGoogleContact(accessToken, {
      name: displayName,
      phoneE164: e164,
    });
    await markEnsured(userId, phoneKey, created);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof GoogleAuthError && err.code === "revoked") {
      console.warn(
        `[google-contacts] user=${userId} token révoqué — skip création contact (${msg.slice(0, 120)})`,
      );
      return;
    }
    console.warn(
      `[google-contacts] user=${userId} échec ensure (campagne continue) : ${msg.slice(0, 200)}`,
    );
  }
}
