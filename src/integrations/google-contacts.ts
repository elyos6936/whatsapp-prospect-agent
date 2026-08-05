/**
 * Google Contacts via People API — création OBLIGATOIRE avant prospection DM.
 * Anti-blocage WhatsApp : le numéro doit exister dans « Mes contacts » Google.
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
  addContactToMyContacts,
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
): Promise<{ resource_name: string | null; ensured_at: string | null } | null> {
  await ensureSchema();
  const rows = await sql`
    SELECT resource_name, ensured_at
    FROM google_contacts_ensured
    WHERE user_id = ${userId} AND phone_key = ${phoneKey}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    resource_name:
      rows[0].resource_name == null ? null : String(rows[0].resource_name),
    ensured_at: rows[0].ensured_at == null ? null : String(rows[0].ensured_at),
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
      resource_name = EXCLUDED.resource_name,
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

export async function isGoogleContactsConnected(userId: number): Promise<boolean> {
  const row = await getUserIntegration(userId, GOOGLE_CONTACTS_PROVIDER);
  return Boolean(row && hasGoogleContactsScope(row.scopes));
}

/**
 * Exige Google Contacts connecté (prospection DM anti-blocage).
 * Throw Error avec message utilisateur si absent / révoqué.
 */
export async function requireGoogleContactsConnected(userId: number): Promise<void> {
  const row = await getUserIntegration(userId, GOOGLE_CONTACTS_PROVIDER);
  if (!row || !hasGoogleContactsScope(row.scopes)) {
    throw new Error(
      "Google Contacts n'est pas connecté. Va dans Réglages → Intégrations → Google Contacts " +
        "pour l'activer — obligatoire avant toute prospection (anti-blocage WhatsApp).",
    );
  }
  try {
    await getValidGoogleContactsToken(userId);
  } catch {
    throw new Error(
      "Google Contacts est expiré ou révoqué. Reconnecte-le dans Réglages → Intégrations " +
        "avant de prospecter.",
    );
  }
}

async function resolveDisplayName(
  userId: number,
  phone: string,
  preferred?: string | null,
): Promise<string> {
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
 * Avant enqueueSend / enregistrement manuel : crée la fiche Google Contacts
 * pour ce numéro et vérifie qu'elle existe vraiment dans « Mes contacts ».
 * Ne throw jamais vers l'appelant métier (retourne synced + reason).
 */
export async function ensureGoogleContactBeforeSend(
  userId: number,
  input: { phone: string; name?: string | null },
): Promise<{ synced: boolean; reason?: string; displayName?: string; resourceName?: string }> {
  try {
    const phoneKey = phoneKeyFromWhatsAppId(input.phone);
    if (!phoneKey) return { synced: false, reason: "phone_invalid" };

    const row = await getUserIntegration(userId, GOOGLE_CONTACTS_PROVIDER);
    if (!row || !hasGoogleContactsScope(row.scopes)) {
      return { synced: false, reason: "not_connected" };
    }

    const accessToken = await getValidGoogleContactsToken(userId);
    const e164 = toE164Display(phoneKey);
    const displayName = await resolveDisplayName(userId, input.phone, input.name);

    // Cache : re-vérifier chez Google (pas de faux « synchronisé »)
    const cached = await getEnsuredRow(userId, phoneKey);
    if (cached?.resource_name) {
      const verified = await getGoogleContactByResource(
        accessToken,
        cached.resource_name,
        phoneKey,
      ).catch(() => null);
      if (verified) {
        void addContactToMyContacts(accessToken, verified.resourceName).catch(() => {});
        return {
          synced: true,
          reason: "already_ensured",
          displayName,
          resourceName: verified.resourceName,
        };
      }
      await clearEnsuredPhone(userId, phoneKey);
    } else if (cached) {
      await clearEnsuredPhone(userId, phoneKey);
    }

    const existing = await searchGoogleContactByPhone(accessToken, phoneKey);
    if (existing) {
      const verified = await getGoogleContactByResource(
        accessToken,
        existing,
        phoneKey,
      ).catch(() => null);
      const resourceName = verified?.resourceName ?? existing;
      await addContactToMyContacts(accessToken, resourceName).catch(() => {});
      if (
        verified &&
        displayName &&
        !isPhoneLikeLabel(displayName) &&
        isPhoneLikeLabel(verified.displayName)
      ) {
        void updateGoogleContactName(accessToken, resourceName, displayName).catch(() => false);
      }
      await markEnsured(userId, phoneKey, resourceName);
      return { synced: true, reason: "already_in_google", displayName, resourceName };
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

    // Vérif synchrone : ne jamais annoncer « synchronisé » sans preuve
    const verified = await getGoogleContactByResource(accessToken, created, phoneKey).catch(
      () => null,
    );
    if (!verified) {
      console.warn(
        `[google-contacts] user=${userId} create OK mais lecture impossible pour ${phoneKey} (${created})`,
      );
      await clearEnsuredPhone(userId, phoneKey);
      return { synced: false, reason: "verify_failed", displayName };
    }

    await markEnsured(userId, phoneKey, verified.resourceName);
    console.log(
      `[google-contacts] user=${userId} créé ${phoneKey} → ${verified.resourceName}` +
        (row.provider_email ? ` (${row.provider_email})` : ""),
    );
    return {
      synced: true,
      reason: "created",
      displayName,
      resourceName: verified.resourceName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof GoogleAuthError && err.code === "revoked") {
      console.warn(
        `[google-contacts] user=${userId} token révoqué — skip création contact (${msg.slice(0, 120)})`,
      );
      return { synced: false, reason: "token_revoked" };
    }
    console.warn(
      `[google-contacts] user=${userId} échec ensure : ${msg.slice(0, 200)}`,
    );
    return { synced: false, reason: "error", displayName: undefined };
  }
}
