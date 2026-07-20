/**
 * Persistance des intégrations OAuth (tokens chiffrés).
 */

import crypto from "node:crypto";
import { sql } from "./pg.js";
import { decryptSecret, encryptSecret } from "./secret-crypto.js";

export type UserIntegrationRow = {
  id: number;
  user_id: number;
  provider: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: Date | null;
  scopes: string | null;
  provider_account_id: string | null;
  provider_email: string | null;
  connected_at: Date;
  updated_at: Date;
};

export type IntegrationPublicStatus = {
  provider: string;
  connected: boolean;
  email: string | null;
  accountId: string | null;
  connectedAt: string | null;
  scopes: string | null;
};

function mapRow(row: Record<string, unknown>): UserIntegrationRow {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    provider: String(row.provider),
    access_token_enc: String(row.access_token_enc),
    refresh_token_enc: row.refresh_token_enc == null ? null : String(row.refresh_token_enc),
    token_expires_at: row.token_expires_at ? new Date(String(row.token_expires_at)) : null,
    scopes: row.scopes == null ? null : String(row.scopes),
    provider_account_id: row.provider_account_id == null ? null : String(row.provider_account_id),
    provider_email: row.provider_email == null ? null : String(row.provider_email),
    connected_at: new Date(String(row.connected_at)),
    updated_at: new Date(String(row.updated_at)),
  };
}

export async function listIntegrationStatuses(userId: number): Promise<IntegrationPublicStatus[]> {
  await migrateLegacyGoogleIntegrations(userId);

  const rows = await sql`
    SELECT provider, provider_email, provider_account_id, connected_at, scopes
    FROM user_integrations
    WHERE user_id = ${userId}
  `;
  const byProvider = new Map(
    rows.map((r) => [String(r.provider), r] as const),
  );

  const providers = ["typeform", "google_sheets", "google_contacts"];
  return providers.map((provider) => {
    const row = byProvider.get(provider);
    if (!row) {
      return {
        provider,
        connected: false,
        email: null,
        accountId: null,
        connectedAt: null,
        scopes: null,
      };
    }
    return {
      provider,
      connected: true,
      email: row.provider_email == null ? null : String(row.provider_email),
      accountId: row.provider_account_id == null ? null : String(row.provider_account_id),
      connectedAt: row.connected_at ? new Date(String(row.connected_at)).toISOString() : null,
      scopes: row.scopes == null ? null : String(row.scopes),
    };
  });
}

export async function getUserIntegration(
  userId: number,
  provider: string,
): Promise<UserIntegrationRow | null> {
  if (provider === "google_sheets" || provider === "google_contacts" || provider === "google") {
    await migrateLegacyGoogleIntegrations(userId);
  }
  const rows = await sql`
    SELECT *
    FROM user_integrations
    WHERE user_id = ${userId} AND provider = ${provider}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return mapRow(rows[0] as Record<string, unknown>);
}

/**
 * Découpe l'ancien provider unique `google` en google_sheets / google_contacts
 * sans invalider les tokens (continuité Sheets + Contacts).
 */
export async function migrateLegacyGoogleIntegrations(userId?: number): Promise<void> {
  const {
    GOOGLE_PROVIDER,
    GOOGLE_SHEETS_PROVIDER,
    GOOGLE_CONTACTS_PROVIDER,
    hasGoogleContactsScope,
    hasGoogleSheetsScope,
    sheetsScopesOnly,
    contactsScopesOnly,
  } = await import("./integrations/google.js");

  const legacyRows = userId
    ? await sql`
        SELECT *
        FROM user_integrations
        WHERE user_id = ${userId} AND provider = ${GOOGLE_PROVIDER}
      `
    : await sql`
        SELECT *
        FROM user_integrations
        WHERE provider = ${GOOGLE_PROVIDER}
      `;

  for (const raw of legacyRows) {
    const row = mapRow(raw as Record<string, unknown>);
    const scopes = row.scopes;
    const wantSheets = hasGoogleSheetsScope(scopes) || !hasGoogleContactsScope(scopes);
    const wantContacts = hasGoogleContactsScope(scopes);

    // Si scopes ambigus / vides : préserver au moins Sheets (cas le plus fréquent).
    const createSheets = wantSheets || (!wantSheets && !wantContacts);
    const createContacts = wantContacts;

    if (createSheets) {
      const existingSheets = await sql`
        SELECT id FROM user_integrations
        WHERE user_id = ${row.user_id} AND provider = ${GOOGLE_SHEETS_PROVIDER}
        LIMIT 1
      `;
      if (!existingSheets[0]) {
        await sql`
          INSERT INTO user_integrations (
            user_id, provider, access_token_enc, refresh_token_enc, token_expires_at,
            scopes, provider_account_id, provider_email, connected_at, updated_at
          ) VALUES (
            ${row.user_id},
            ${GOOGLE_SHEETS_PROVIDER},
            ${row.access_token_enc},
            ${row.refresh_token_enc},
            ${row.token_expires_at},
            ${sheetsScopesOnly(scopes)},
            ${row.provider_account_id},
            ${row.provider_email},
            ${row.connected_at},
            NOW()
          )
          ON CONFLICT (user_id, provider) DO NOTHING
        `;
      }
    }

    if (createContacts) {
      const existingContacts = await sql`
        SELECT id FROM user_integrations
        WHERE user_id = ${row.user_id} AND provider = ${GOOGLE_CONTACTS_PROVIDER}
        LIMIT 1
      `;
      if (!existingContacts[0]) {
        await sql`
          INSERT INTO user_integrations (
            user_id, provider, access_token_enc, refresh_token_enc, token_expires_at,
            scopes, provider_account_id, provider_email, connected_at, updated_at
          ) VALUES (
            ${row.user_id},
            ${GOOGLE_CONTACTS_PROVIDER},
            ${row.access_token_enc},
            ${row.refresh_token_enc},
            ${row.token_expires_at},
            ${contactsScopesOnly(scopes)},
            ${row.provider_account_id},
            ${row.provider_email},
            ${row.connected_at},
            NOW()
          )
          ON CONFLICT (user_id, provider) DO NOTHING
        `;
      }
    }

    await sql`
      DELETE FROM user_integrations
      WHERE user_id = ${row.user_id} AND provider = ${GOOGLE_PROVIDER}
    `;
  }
}

export async function upsertUserIntegration(input: {
  userId: number;
  provider: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
  scopes?: string | null;
  providerAccountId?: string | null;
  providerEmail?: string | null;
}): Promise<void> {
  const accessEnc = encryptSecret(input.accessToken);
  const refreshEnc =
    input.refreshToken && input.refreshToken.trim()
      ? encryptSecret(input.refreshToken.trim())
      : null;
  const expiresAt =
    input.expiresInSeconds && input.expiresInSeconds > 0
      ? new Date(Date.now() + input.expiresInSeconds * 1000)
      : null;

  await sql`
    INSERT INTO user_integrations (
      user_id, provider, access_token_enc, refresh_token_enc, token_expires_at,
      scopes, provider_account_id, provider_email, connected_at, updated_at
    ) VALUES (
      ${input.userId},
      ${input.provider},
      ${accessEnc},
      ${refreshEnc},
      ${expiresAt},
      ${input.scopes ?? null},
      ${input.providerAccountId ?? null},
      ${input.providerEmail ?? null},
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, user_integrations.refresh_token_enc),
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = COALESCE(EXCLUDED.scopes, user_integrations.scopes),
      provider_account_id = COALESCE(EXCLUDED.provider_account_id, user_integrations.provider_account_id),
      provider_email = COALESCE(EXCLUDED.provider_email, user_integrations.provider_email),
      updated_at = NOW()
  `;
}

export async function deleteUserIntegration(userId: number, provider: string): Promise<void> {
  await sql`
    DELETE FROM user_integrations
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
}

export type ConnectedSheetRow = {
  id: number;
  user_id: number;
  spreadsheet_id: string;
  title: string;
  added_at: Date;
};

export type ConnectedSheetPublic = {
  spreadsheetId: string;
  title: string;
  addedAt: string;
};

export async function listConnectedSheets(userId: number): Promise<ConnectedSheetPublic[]> {
  const rows = await sql`
    SELECT spreadsheet_id, title, added_at
    FROM user_connected_sheets
    WHERE user_id = ${userId}
    ORDER BY added_at DESC, id DESC
  `;
  return rows.map((r) => ({
    spreadsheetId: String(r.spreadsheet_id),
    title: String(r.title ?? ""),
    addedAt: new Date(String(r.added_at)).toISOString(),
  }));
}

export async function countConnectedSheets(userId: number): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n
    FROM user_connected_sheets
    WHERE user_id = ${userId}
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Ajoute des Sheets (idempotent). Retourne combien ont été réellement insérés.
 * Lève si le total dépasserait `maxPerUser`.
 */
export async function addConnectedSheets(
  userId: number,
  sheets: Array<{ spreadsheetId: string; title: string }>,
  maxPerUser: number,
): Promise<{ added: number; total: number }> {
  const normalized = sheets
    .map((s) => ({
      spreadsheetId: String(s.spreadsheetId ?? "").trim(),
      title: String(s.title ?? "").trim() || "Sans titre",
    }))
    .filter((s) => s.spreadsheetId);

  if (normalized.length === 0) {
    const total = await countConnectedSheets(userId);
    return { added: 0, total };
  }

  const existing = await sql`
    SELECT spreadsheet_id
    FROM user_connected_sheets
    WHERE user_id = ${userId}
      AND spreadsheet_id IN ${sql(normalized.map((s) => s.spreadsheetId))}
  `;
  const existingIds = new Set(existing.map((r) => String(r.spreadsheet_id)));
  const toInsert = normalized.filter((s) => !existingIds.has(s.spreadsheetId));

  const current = await countConnectedSheets(userId);
  if (current + toInsert.length > maxPerUser) {
    const err = new Error(
      `Limite atteinte : maximum ${maxPerUser} Google Sheets connectés par compte.`,
    );
    (err as Error & { code?: string }).code = "limit";
    throw err;
  }

  let added = 0;
  for (const s of toInsert) {
    const rows = await sql`
      INSERT INTO user_connected_sheets (user_id, spreadsheet_id, title)
      VALUES (${userId}, ${s.spreadsheetId}, ${s.title})
      ON CONFLICT (user_id, spreadsheet_id) DO UPDATE SET
        title = EXCLUDED.title
      RETURNING id
    `;
    if (rows[0]) added += 1;
  }

  const total = await countConnectedSheets(userId);
  return { added, total };
}

export async function removeConnectedSheet(
  userId: number,
  spreadsheetId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM user_connected_sheets
    WHERE user_id = ${userId} AND spreadsheet_id = ${spreadsheetId}
    RETURNING id
  `;
  return Boolean(rows[0]);
}

export async function deleteAllConnectedSheets(userId: number): Promise<void> {
  await sql`
    DELETE FROM user_connected_sheets
    WHERE user_id = ${userId}
  `;
}

export function decryptIntegrationTokens(row: UserIntegrationRow): {
  accessToken: string;
  refreshToken: string | null;
} {
  return {
    accessToken: decryptSecret(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc) : null,
  };
}

export async function createOauthPendingState(
  userId: number,
  provider: string,
  purpose?: string | null,
): Promise<string> {
  const state = crypto.randomBytes(24).toString("hex");
  await sql`
    DELETE FROM oauth_pending_states
    WHERE created_at < NOW() - INTERVAL '15 minutes'
  `;
  try {
    await sql`
      INSERT INTO oauth_pending_states (state, user_id, provider, purpose)
      VALUES (${state}, ${userId}, ${provider}, ${purpose ?? null})
    `;
  } catch {
    // Colonne purpose absente tant que la migration n'est pas appliquée
    await sql`
      INSERT INTO oauth_pending_states (state, user_id, provider)
      VALUES (${state}, ${userId}, ${provider})
    `;
  }
  return state;
}

export async function consumeOauthPendingState(
  state: string,
  provider: string,
): Promise<{ userId: number; purpose: string | null } | null> {
  try {
    const rows = await sql`
      DELETE FROM oauth_pending_states
      WHERE state = ${state}
        AND provider = ${provider}
        AND created_at > NOW() - INTERVAL '15 minutes'
      RETURNING user_id, purpose
    `;
    if (!rows[0]) return null;
    return {
      userId: Number(rows[0].user_id),
      purpose: rows[0].purpose == null ? null : String(rows[0].purpose),
    };
  } catch {
    const rows = await sql`
      DELETE FROM oauth_pending_states
      WHERE state = ${state}
        AND provider = ${provider}
        AND created_at > NOW() - INTERVAL '15 minutes'
      RETURNING user_id
    `;
    if (!rows[0]) return null;
    return { userId: Number(rows[0].user_id), purpose: null };
  }
}
