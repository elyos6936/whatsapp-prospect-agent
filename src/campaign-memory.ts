/**
 * Mémoires de campagne — préférences communes entrant / sortant
 * (présentation, ton, stickers, emojis, fenêtre d'envoi).
 */
import { sql } from "./pg.js";
import { getAppSettings } from "./db.js";

export type CampaignMemoryFormality = "vous" | "tu";
export type CampaignMemoryTone = "direct" | "chaleureux" | "pro" | "decontracte";
export type CampaignMemoryEmojiLevel = "none" | "sparse";

export interface CampaignMemory {
  id: number;
  userId: number;
  name: string;
  ownerName: string;
  introFormula: string;
  tone: CampaignMemoryTone;
  toneNote: string;
  formality: CampaignMemoryFormality;
  stickersEnabled: boolean;
  emojiLevel: CampaignMemoryEmojiLevel;
  /** Début fenêtre d'envoi (heure locale inclusive), ex. 9. */
  sendWindowStart: number;
  /** Fin fenêtre d'envoi (heure locale exclusive), ex. 18. */
  sendWindowEnd: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CampaignMemoryInput = {
  name: string;
  ownerName?: string;
  introFormula?: string;
  tone?: CampaignMemoryTone;
  toneNote?: string;
  formality?: CampaignMemoryFormality;
  stickersEnabled?: boolean;
  emojiLevel?: CampaignMemoryEmojiLevel;
  sendWindowStart?: number;
  sendWindowEnd?: number;
  isDefault?: boolean;
};

const MAX_MEMORIES = 8;

const TONES = new Set<CampaignMemoryTone>(["direct", "chaleureux", "pro", "decontracte"]);
const FORMALITIES = new Set<CampaignMemoryFormality>(["vous", "tu"]);
const EMOJIS = new Set<CampaignMemoryEmojiLevel>(["none", "sparse"]);

let schemaReady: Promise<void> | null = null;

export async function ensureCampaignMemoriesSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS campaign_memories (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          owner_name TEXT NOT NULL DEFAULT '',
          intro_formula TEXT NOT NULL DEFAULT '',
          tone TEXT NOT NULL DEFAULT 'pro',
          tone_note TEXT NOT NULL DEFAULT '',
          formality TEXT NOT NULL DEFAULT 'vous',
          stickers_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          emoji_level TEXT NOT NULL DEFAULT 'none',
          send_window_start INT NOT NULL DEFAULT 9,
          send_window_end INT NOT NULL DEFAULT 18,
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_campaign_memories_user ON campaign_memories(user_id, id DESC)`;
      await sql`ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS campaign_memory_id BIGINT REFERENCES campaign_memories(id) ON DELETE SET NULL`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function formatTs(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? "");
}

function clampHour(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(23, Math.max(0, Math.round(v)));
}

function normalizeTone(raw: unknown): CampaignMemoryTone {
  const v = String(raw ?? "").trim().toLowerCase();
  if (TONES.has(v as CampaignMemoryTone)) return v as CampaignMemoryTone;
  return "pro";
}

function normalizeFormality(raw: unknown): CampaignMemoryFormality {
  const v = String(raw ?? "").trim().toLowerCase();
  if (FORMALITIES.has(v as CampaignMemoryFormality)) return v as CampaignMemoryFormality;
  return "vous";
}

function normalizeEmoji(raw: unknown): CampaignMemoryEmojiLevel {
  const v = String(raw ?? "").trim().toLowerCase();
  if (EMOJIS.has(v as CampaignMemoryEmojiLevel)) return v as CampaignMemoryEmojiLevel;
  return "none";
}

function mapRow(row: Record<string, unknown>): CampaignMemory {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: String(row.name ?? "").trim() || "Mémoire",
    ownerName: String(row.owner_name ?? "").trim(),
    introFormula: String(row.intro_formula ?? "").trim(),
    tone: normalizeTone(row.tone),
    toneNote: String(row.tone_note ?? "").trim(),
    formality: normalizeFormality(row.formality),
    stickersEnabled: Boolean(row.stickers_enabled),
    emojiLevel: normalizeEmoji(row.emoji_level),
    sendWindowStart: clampHour(row.send_window_start, 9),
    sendWindowEnd: clampHour(row.send_window_end, 18),
    isDefault: Boolean(row.is_default),
    createdAt: formatTs(row.created_at),
    updatedAt: formatTs(row.updated_at),
  };
}

/** Quiet hours config : fin fenêtre → début quiet ; début fenêtre → fin quiet. */
export function memoryToQuietHours(memory: CampaignMemory): {
  quietHoursStart: number;
  quietHoursEnd: number;
} {
  return {
    quietHoursStart: memory.sendWindowEnd,
    quietHoursEnd: memory.sendWindowStart,
  };
}

export function memoryToneLabel(tone: CampaignMemoryTone): string {
  const map: Record<CampaignMemoryTone, string> = {
    direct: "Direct",
    chaleureux: "Chaleureux",
    pro: "Pro",
    decontracte: "Décontracté",
  };
  return map[tone] ?? tone;
}

/** Texte injecté dans le contexte agent. */
export function formatMemoryForAgent(memory: CampaignMemory): string {
  const lines = [
    `Nom : « ${memory.name} »`,
    memory.ownerName
      ? `Présentation : ${memory.ownerName}${memory.introFormula ? ` — « ${memory.introFormula} »` : ""}`
      : null,
    `Ton : ${memoryToneLabel(memory.tone)}${memory.toneNote ? ` (${memory.toneNote})` : ""}`,
    `Tutoiement : ${memory.formality === "tu" ? "tutoiement (tu)" : "vouvoiement (vous)"}`,
    `Stickers / emojis campagne : ${memory.stickersEnabled ? "oui" : "non"}`,
    `Emojis dans les messages : ${memory.emojiLevel === "sparse" ? "discrets (max 1)" : "aucun"}`,
    `Fenêtre d'envoi : ${memory.sendWindowStart}h–${memory.sendWindowEnd}h`,
  ].filter(Boolean);
  return (
    `## Mémoire active — « ${memory.name} » (liée à CE fil — ne PAS re-demander)\n` +
    `${lines.join("\n")}\n\n` +
    `Ces préférences sont déjà fixées pour cette automatisation (bouton Mémoire dans le chat). ` +
    `INTERDIT de reposer : présentation / identité, stickers, ton/style, tutoiement, fenêtre horaire d'envoi.\n` +
    `Continue de briefier uniquement le produit (offre, cible, prix, lien, déclencheurs, accroche, lancement, relances, notif tiers).\n` +
    `Si l'utilisateur veut changer de mémoire → set_campaign_memory ou bouton Mémoire.`
  );
}

export async function listCampaignMemories(userId: number): Promise<CampaignMemory[]> {
  await ensureCampaignMemoriesSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM campaign_memories
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, id DESC
  `;
  return rows.map(mapRow);
}

export async function getCampaignMemory(
  userId: number,
  id: number
): Promise<CampaignMemory | null> {
  await ensureCampaignMemoriesSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM campaign_memories WHERE user_id = ${userId} AND id = ${id} LIMIT 1
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getDefaultCampaignMemory(
  userId: number
): Promise<CampaignMemory | null> {
  await ensureCampaignMemoriesSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM campaign_memories
    WHERE user_id = ${userId} AND is_default = TRUE
    ORDER BY id DESC LIMIT 1
  `;
  if (rows[0]) return mapRow(rows[0]);
  const any = await sql<Record<string, unknown>[]>`
    SELECT * FROM campaign_memories WHERE user_id = ${userId} ORDER BY id DESC LIMIT 1
  `;
  return any[0] ? mapRow(any[0]) : null;
}

export async function findCampaignMemoryByName(
  userId: number,
  name: string
): Promise<CampaignMemory | null> {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const all = await listCampaignMemories(userId);
  const exact = all.find((m) => m.name.toLowerCase() === q);
  if (exact) return exact;
  return all.find((m) => m.name.toLowerCase().includes(q)) ?? null;
}

/** Mémoire du fil (override) sinon défaut compte. */
export async function resolveActiveCampaignMemory(
  userId: number,
  threadMemoryId?: number | null
): Promise<CampaignMemory | null> {
  if (threadMemoryId != null && Number.isFinite(threadMemoryId)) {
    const linked = await getCampaignMemory(userId, threadMemoryId);
    if (linked) return linked;
  }
  return getDefaultCampaignMemory(userId);
}

/**
 * Mémoire explicitement liée au fil uniquement (pas de fallback défaut compte).
 * Isolations par automatisation : sans lien → null.
 */
export async function getLinkedCampaignMemory(
  userId: number,
  threadId: number
): Promise<CampaignMemory | null> {
  const threadMemId = await getThreadCampaignMemoryId(userId, threadId);
  if (threadMemId == null) return null;
  return getCampaignMemory(userId, threadMemId);
}

async function clearDefaults(userId: number): Promise<void> {
  await sql`
    UPDATE campaign_memories SET is_default = FALSE, updated_at = NOW()
    WHERE user_id = ${userId} AND is_default = TRUE
  `;
}

export async function createCampaignMemory(
  userId: number,
  input: CampaignMemoryInput
): Promise<CampaignMemory> {
  await ensureCampaignMemoriesSchema();
  const existing = await listCampaignMemories(userId);
  if (existing.length >= MAX_MEMORIES) {
    throw new Error(`Maximum ${MAX_MEMORIES} mémoires. Supprime-en une avant d'en créer une autre.`);
  }

  let ownerName = (input.ownerName ?? "").trim();
  if (!ownerName) {
    try {
      const s = await getAppSettings(userId);
      ownerName = (s.business_owner_name || "").trim();
    } catch {
      /* ignore */
    }
  }

  const name = input.name.trim().slice(0, 80) || "Mémoire";
  const makeDefault = existing.length === 0 || Boolean(input.isDefault);
  if (makeDefault) await clearDefaults(userId);

  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO campaign_memories (
      user_id, name, owner_name, intro_formula, tone, tone_note, formality,
      stickers_enabled, emoji_level, send_window_start, send_window_end, is_default
    ) VALUES (
      ${userId},
      ${name},
      ${ownerName.slice(0, 120)},
      ${(input.introFormula ?? "").trim().slice(0, 280)},
      ${normalizeTone(input.tone)},
      ${(input.toneNote ?? "").trim().slice(0, 200)},
      ${normalizeFormality(input.formality)},
      ${Boolean(input.stickersEnabled)},
      ${normalizeEmoji(input.emojiLevel)},
      ${clampHour(input.sendWindowStart, 9)},
      ${clampHour(input.sendWindowEnd, 18)},
      ${makeDefault}
    )
    RETURNING *
  `;
  return mapRow(rows[0]);
}

export async function updateCampaignMemory(
  userId: number,
  id: number,
  input: Partial<CampaignMemoryInput>
): Promise<CampaignMemory | null> {
  await ensureCampaignMemoriesSchema();
  const current = await getCampaignMemory(userId, id);
  if (!current) return null;

  if (input.isDefault === true) await clearDefaults(userId);

  const name = input.name != null ? input.name.trim().slice(0, 80) || current.name : current.name;
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE campaign_memories SET
      name = ${name},
      owner_name = ${input.ownerName != null ? input.ownerName.trim().slice(0, 120) : current.ownerName},
      intro_formula = ${input.introFormula != null ? input.introFormula.trim().slice(0, 280) : current.introFormula},
      tone = ${input.tone != null ? normalizeTone(input.tone) : current.tone},
      tone_note = ${input.toneNote != null ? input.toneNote.trim().slice(0, 200) : current.toneNote},
      formality = ${input.formality != null ? normalizeFormality(input.formality) : current.formality},
      stickers_enabled = ${input.stickersEnabled != null ? Boolean(input.stickersEnabled) : current.stickersEnabled},
      emoji_level = ${input.emojiLevel != null ? normalizeEmoji(input.emojiLevel) : current.emojiLevel},
      send_window_start = ${input.sendWindowStart != null ? clampHour(input.sendWindowStart, current.sendWindowStart) : current.sendWindowStart},
      send_window_end = ${input.sendWindowEnd != null ? clampHour(input.sendWindowEnd, current.sendWindowEnd) : current.sendWindowEnd},
      is_default = ${input.isDefault === true ? true : current.isDefault},
      updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${id}
    RETURNING *
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function setDefaultCampaignMemory(
  userId: number,
  id: number
): Promise<CampaignMemory | null> {
  const mem = await getCampaignMemory(userId, id);
  if (!mem) return null;
  await clearDefaults(userId);
  const rows = await sql<Record<string, unknown>[]>`
    UPDATE campaign_memories SET is_default = TRUE, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${id}
    RETURNING *
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteCampaignMemory(userId: number, id: number): Promise<boolean> {
  await ensureCampaignMemoriesSchema();
  const mem = await getCampaignMemory(userId, id);
  if (!mem) return false;
  await sql`DELETE FROM campaign_memories WHERE user_id = ${userId} AND id = ${id}`;
  if (mem.isDefault) {
    const next = await sql<Record<string, unknown>[]>`
      SELECT id FROM campaign_memories WHERE user_id = ${userId} ORDER BY id DESC LIMIT 1
    `;
    if (next[0]) {
      await setDefaultCampaignMemory(userId, Number(next[0].id));
    }
  }
  return true;
}

export async function setThreadCampaignMemory(
  userId: number,
  threadId: number,
  memoryId: number | null
): Promise<void> {
  await ensureCampaignMemoriesSchema();
  if (memoryId != null) {
    const mem = await getCampaignMemory(userId, memoryId);
    if (!mem) throw new Error("Mémoire introuvable.");
  }
  await sql`
    UPDATE agent_threads
    SET campaign_memory_id = ${memoryId}, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
}

export async function getThreadCampaignMemoryId(
  userId: number,
  threadId: number
): Promise<number | null> {
  await ensureCampaignMemoriesSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT campaign_memory_id FROM agent_threads
    WHERE user_id = ${userId} AND id = ${threadId} LIMIT 1
  `;
  const v = rows[0]?.campaign_memory_id;
  return v != null ? Number(v) : null;
}

/** Prefill présentation depuis profil business (onboarding). */
export async function getPresentationPrefill(userId: number): Promise<{ ownerName: string }> {
  try {
    const s = await getAppSettings(userId);
    return { ownerName: (s.business_owner_name || "").trim() };
  } catch {
    return { ownerName: "" };
  }
}

export { MAX_MEMORIES as CAMPAIGN_MEMORY_MAX };
