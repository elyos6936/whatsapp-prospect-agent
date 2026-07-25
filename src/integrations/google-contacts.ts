/**
 * Google Contacts via People API — création avant envoi campagne.
 * No-op silencieux si provider google_contacts absent / sans scope ;
 * jamais bloquant pour enqueueSend.
 *
 * Perf : cache hit = 1 lecture SQL, zéro appel Google/Evolution.
 * Coût réseau seulement au 1er sync d'un numéro (create + vérif légère).
 */

import { sql } from "../pg.js";
import { getUserIntegration } from "../integrations-db.js";
import { getValidGoogleContactsToken } from "./access.js";
import {
  GOOGLE_CONTACTS_PROVIDER,
  GoogleAuthError,
  hasGoogleContactsScope,
  searchGoogleContactByPhone,
  createGoogleContact,
  getGoogleContactByResource,
  updateGoogleContactName,
  phoneKeyFromWhatsAppId,
  toE164Display,
} from "./google.js";
import {
  isPhoneLikeLabel,
  resolveWhatsAppDisplayName,
} from "../evolutionapi.js";

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

async function getEnsuredRow(
  userId: number,
  phoneKey: string,
): Promise<{ resource_name: string | null } | null> {
  await ensureSchema();
  const rows = await sql`
    SELECT resource_name
    FROM google_contacts_ensured
    WHERE user_id = ${userId} AND phone_key = ${phoneKey}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    resource_name:
      rows[0].resource_name == null ? null : String(rows[0].resource_name),
  };
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

async function clearEnsuredPhone(userId: number, phoneKey: string): Promise<void> {
  await ensureSchema();
  await sql`
    DELETE FROM google_contacts_ensured
    WHERE user_id = ${userId} AND phone_key = ${phoneKey}
  `;
}

/** Vide le cache d'idempotence Contacts (après déconnexion / changement de compte). */
export async function clearGoogleContactsEnsuredCache(userId: number): Promise<void> {
  await ensureSchema();
  await sql`
    DELETE FROM google_contacts_ensured
    WHERE user_id = ${userId}
  `;
}

async function resolveDisplayName(
  userId: number,
  phone: string,
  preferred?: string | null,
): Promise<string> {
  // Si l'appelant a déjà un vrai nom (campagne / save_contact), ne pas re-interroquer Evolution
  if (preferred && !isPhoneLikeLabel(preferred)) {
    return String(preferred).trim().slice(0, 100);
  }
  const waName = await resolveWhatsAppDisplayName(userId, phone, preferred).catch(
    () => null,
  );
  if (waName && !isPhoneLikeLabel(waName)) return waName;
  const phoneKey = phoneKeyFromWhatsAppId(phone);
  return phoneKey ? toE164Display(phoneKey) : String(preferred || phone).trim();
}

/**
 * Avant enqueueSend / enregistrement manuel : si Google Contacts (People) est
 * connecté, crée la fiche pour ce numéro s'il n'existe pas encore.
 * Ne throw jamais vers l'appelant métier.
 */
export async function ensureGoogleContactBeforeSend(
  userId: number,
  input: { phone: string; name?: string | null },
): Promise<{ synced: boolean; reason?: string; displayName?: string }> {
  try {
    const phoneKey = phoneKeyFromWhatsAppId(input.phone);
    if (!phoneKey) return { synced: false, reason: "phone_invalid" };

    // Fast path : déjà syncé → aucun appel Google / Evolution
    const cached = await getEnsuredRow(userId, phoneKey);
    if (cached?.resource_name) {
      return {
        synced: true,
        reason: "already_ensured",
        displayName: input.name && !isPhoneLikeLabel(input.name) ? String(input.name) : undefined,
      };
    }
    if (cached && !cached.resource_name) {
      await clearEnsuredPhone(userId, phoneKey);
    }

    const row = await getUserIntegration(userId, GOOGLE_CONTACTS_PROVIDER);
    if (!row || !hasGoogleContactsScope(row.scopes)) {
      return { synced: false, reason: "not_connected" };
    }

    const accessToken = await getValidGoogleContactsToken(userId);
    const e164 = toE164Display(phoneKey);
    const displayName = await resolveDisplayName(userId, input.phone, input.name);

    const existing = await searchGoogleContactByPhone(accessToken, phoneKey);
    if (existing) {
      // Une seule lecture légère pour confirmer + éventuellement mettre à jour le nom
      const verified = await getGoogleContactByResource(
        accessToken,
        existing,
        phoneKey,
      ).catch(() => null);
      const resourceName = verified?.resourceName ?? existing;
      if (
        verified &&
        displayName &&
        !isPhoneLikeLabel(displayName) &&
        isPhoneLikeLabel(verified.displayName)
      ) {
        // Non bloquant : ne retarde pas l'envoi campagne
        void updateGoogleContactName(accessToken, resourceName, displayName).catch(() => false);
      }
      await markEnsured(userId, phoneKey, resourceName);
      return { synced: true, reason: "already_in_google", displayName };
    }

    const created = await createGoogleContact(accessToken, {
      name: displayName,
      phoneE164: e164,
    });
    if (!created) {
      console.warn(
        `[google-contacts] user=${userId} createContact sans resourceName pour ${phoneKey}`,
      );
      return { synced: false, reason: "create_empty", displayName };
    }

    // createContact renvoie déjà resourceName → on marque tout de suite (pas d'attente d'indexation).
    // Vérif async optionnelle : si la fiche est illisible, on invalide le cache pour un prochain essai.
    await markEnsured(userId, phoneKey, created);
    void getGoogleContactByResource(accessToken, created)
      .then(async (ok) => {
        if (!ok) await clearEnsuredPhone(userId, phoneKey);
      })
      .catch(() => {});

    return { synced: true, reason: "created", displayName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof GoogleAuthError && err.code === "revoked") {
      console.warn(
        `[google-contacts] user=${userId} token révoqué — skip création contact (${msg.slice(0, 120)})`,
      );
      return { synced: false, reason: "token_revoked" };
    }
    console.warn(
      `[google-contacts] user=${userId} échec ensure (campagne continue) : ${msg.slice(0, 200)}`,
    );
    return { synced: false, reason: "error" };
  }
}
