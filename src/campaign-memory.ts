/**
 * Mémoires de campagne — instructions libres (phrases à tirets)
 * liées à une automatisation via agent_threads.campaign_memory_id.
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
  /** Instructions clés (une phrase par ligne, souvent préfixée par « - »). */
  instructions: string;
  /** Champs legacy (dérivés / rétrocompat). */
  ownerName: string;
  introFormula: string;
  tone: CampaignMemoryTone;
  toneNote: string;
  formality: CampaignMemoryFormality;
  stickersEnabled: boolean;
  emojiLevel: CampaignMemoryEmojiLevel;
  sendWindowStart: number;
  sendWindowEnd: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CampaignMemoryInput = {
  name: string;
  instructions?: string;
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
const INSTRUCTIONS_MAX = 12_000;

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
      await sql`ALTER TABLE campaign_memories ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT ''`;
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

export function memoryToneLabel(tone: CampaignMemoryTone): string {
  const map: Record<CampaignMemoryTone, string> = {
    direct: "Direct",
    chaleureux: "Chaleureux",
    pro: "Pro",
    decontracte: "Décontracté",
  };
  return map[tone] ?? tone;
}

/** Gabarit de phrases pour une nouvelle mémoire. */
export function buildDefaultMemoryInstructions(opts?: {
  ownerName?: string | null;
  businessName?: string | null;
}): string {
  const owner = (opts?.ownerName ?? "").trim();
  const biz = (opts?.businessName ?? "").trim();
  const who = owner
    ? `- Je me présente comme ${owner}${biz ? `, de ${biz}` : ""}.`
    : `- Je me présente comme [prénom], [rôle]${biz ? ` de ${biz}` : " de [entreprise]"}.`;
  return [
    who,
    "- Ton professionnel, clair et rassurant.",
    "- Je vouvoie les interlocuteurs.",
    "- Pas d'emojis dans les messages.",
    "- Pas de stickers dans les conversations.",
    "- J'envoie uniquement entre 9h et 18h.",
    "- Produit / service : [décrire ce que tu proposes et à qui ça s'adresse].",
    "- Prix / tarifs : [indiquer les prix en FCFA].",
    "- Objectif des conversations : [RDV, vente, support, envoi de lien…].",
    "- Lien utile à envoyer si besoin : [URL].",
    "- Infos complémentaires : [avantages, zones, délais, FAQ…].",
  ].join("\n");
}

/** Reconstruit des phrases à partir des anciens champs structurés. */
export function legacyFieldsToInstructions(fields: {
  ownerName?: string;
  introFormula?: string;
  tone?: CampaignMemoryTone;
  toneNote?: string;
  formality?: CampaignMemoryFormality;
  stickersEnabled?: boolean;
  emojiLevel?: CampaignMemoryEmojiLevel;
  sendWindowStart?: number;
  sendWindowEnd?: number;
}): string {
  const lines: string[] = [];
  const owner = (fields.ownerName ?? "").trim();
  const intro = (fields.introFormula ?? "").trim();
  if (owner) {
    lines.push(
      intro
        ? `- Identité (SEULEMENT si on demande qui tu es) : ${owner} (« ${intro} »). INTERDIT de te présenter après un simple « salut / ok ».`
        : `- Identité (SEULEMENT si on demande qui tu es) : ${owner}. INTERDIT de te présenter après un simple « salut / ok ».`
    );
  } else {
    lines.push(
      "- Identité : [prénom] — à donner SEULEMENT si on demande qui tu es (pas après « salut / ok »)."
    );
  }
  const tone = memoryToneLabel(normalizeTone(fields.tone)).toLowerCase();
  const note = (fields.toneNote ?? "").trim();
  lines.push(note ? `- Ton ${tone} (${note}).` : `- Ton ${tone}.`);
  lines.push(
    fields.formality === "tu"
      ? "- Je tutoie les interlocuteurs."
      : "- Je vouvoie les interlocuteurs."
  );
  lines.push(
    fields.emojiLevel === "sparse"
      ? "- Emojis discrets (max 1 par message)."
      : "- Pas d'emojis dans les messages."
  );
  lines.push(
    fields.stickersEnabled
      ? "- Stickers autorisés dans les conversations."
      : "- Pas de stickers dans les conversations."
  );
  const start = clampHour(fields.sendWindowStart, 9);
  const end = clampHour(fields.sendWindowEnd, 18);
  lines.push(`- J'envoie uniquement entre ${start}h et ${end}h.`);
  lines.push("- Produit / service : [décrire ce que tu proposes et à qui ça s'adresse].");
  lines.push("- Prix / tarifs : [indiquer les prix en FCFA].");
  lines.push("- Objectif des conversations : [RDV, vente, support, envoi de lien…].");
  lines.push("- Lien utile à envoyer si besoin : [URL].");
  lines.push("- Infos complémentaires : [avantages, zones, délais, FAQ…].");
  return lines.join("\n");
}

/**
 * Extrait une URL utile (https ou domaine nu type willwvs.pro) depuis un texte.
 */
export function extractUsefulLinkFromText(text: string): string | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const http = raw.match(/https?:\/\/[^\s<>"'\)\]]+/i);
  if (http?.[0]) {
    const url = http[0].replace(/[),.;!?]+$/g, "");
    if (!/example\.com|placeholder|votre[-_]?lien|\[URL\]/i.test(url)) return url;
  }
  const bare = raw.match(
    /(?:^|[\s:(«"'])((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|fr|pro|io|co|net|org|app|dev|me|link|site|book|page)(?:\/[^\s<>"'\)\]]*)?)/i
  );
  if (bare?.[1]) {
    const hostPath = bare[1].replace(/[),.;!?]+$/g, "");
    if (
      hostPath.length >= 4 &&
      !/^(?:www\.)?(?:example|localhost|test)\b/i.test(hostPath) &&
      !/\[/.test(hostPath)
    ) {
      return `https://${hostPath.replace(/^https?:\/\//i, "")}`;
    }
  }
  return null;
}

/**
 * Prix / tarif depuis les instructions mémoire (montants FCFA ou « Gratuit »).
 * Ignore les placeholders « [indiquer les prix…] ».
 */
export function extractPriceFromMemoryInstructions(instructions: string): string | null {
  const text = instructions || "";
  if (!text.trim()) return null;

  const labeledFree = text.match(
    /(?:prix|tarif|montant)\s*[:=]?\s*([^\n.]{0,50}?(?:gratuit\w*|sans\s+frais|offert\w*))/i,
  )?.[1];
  if (labeledFree) {
    const cleaned = labeledFree.replace(/\s+/g, " ").trim();
    if (cleaned && !/\[/.test(cleaned)) return cleaned.slice(0, 80);
  }
  if (
    /(?:prix|tarif).{0,40}gratuit|(?:formation|masterclass|offre|atelier|session)\s+gratuit/i.test(
      text,
    )
  ) {
    return "Gratuit";
  }

  const fromMem =
    text.match(
      /(?:prix|tarif|montant)\s*[:=]?\s*([^\n.]{0,40}?\b\d[\d\s.,]{1,12}\s*(?:fcfa|f\b|€|euros?)?)/i,
    )?.[1] ||
    text.match(/\b(\d[\d\s.,]{2,12}\s*(?:fcfa|f\b|€|euros?))\b/i)?.[1];
  const cleaned = fromMem?.replace(/\s+/g, " ").trim();
  if (cleaned && !/\[|indiquer/i.test(cleaned)) return cleaned.slice(0, 80);
  return null;
}

/** Ligne de formalité canonique (seed guide / sync). */
export function memoryFormalityLine(formality: CampaignMemoryFormality): string {
  return formality === "tu"
    ? "- Je tutoie les interlocuteurs."
    : "- Je vouvoie les interlocuteurs.";
}

/**
 * Garantit que le conversationGuide déclare la formalité mémoire
 * (évite un opener « vous » alors que la mémoire tutoie).
 */
export function ensureFormalityInGuide(
  guide: string | null | undefined,
  formality: CampaignMemoryFormality,
): string {
  const g = String(guide ?? "").trim();
  const line = memoryFormalityLine(formality);
  const declaresTu = /je\s+tutoie|tutoiement/i.test(g);
  const declaresVous = /je\s+vouvoie|vouvoiement/i.test(g);
  const ok =
    formality === "tu" ? declaresTu && !declaresVous : declaresVous && !declaresTu;
  if (ok) return g;
  return g ? `${line}\n${g}` : line;
}

/** Indices dérivés du texte libre (seed create_automation / briefing). */
export function parseMemoryHints(instructions: string): {
  ownerName: string;
  stickersEnabled: boolean;
  emojiLevel: CampaignMemoryEmojiLevel;
  formality: CampaignMemoryFormality;
  sendWindowStart: number;
  sendWindowEnd: number;
  coversIdentity: boolean;
  coversOffer: boolean;
  coversPrice: boolean;
  coversGoal: boolean;
  coversWindow: boolean;
  coversLink: boolean;
  coversTarget: boolean;
} {
  const text = instructions.trim();
  const lower = text.toLowerCase();

  let ownerName = "";
  const who =
    text.match(
      /(?:je\s+(?:me\s+présente\s+comme|suis|m['']appelle)|présentation\s*[:=]\s*)\s*([^.\n]+)/i
    ) ?? text.match(/-\s*je\s+suis\s+([^.\n]+)/i);
  if (who?.[1]) {
    ownerName = who[1].replace(/[«»"].*$/, "").trim().slice(0, 120);
  }

  const stickersEnabled =
    /stickers?\s+autoris/i.test(text) ||
    (/stickers?/i.test(text) && !/pas\s+de\s+stickers?/i.test(text));

  const emojiLevel: CampaignMemoryEmojiLevel =
    /emojis?\s+discret|max\s*1/i.test(text) && !/pas\s+d['']?emojis?/i.test(text)
      ? "sparse"
      : "none";

  const formality: CampaignMemoryFormality =
    /je\s+tutoie|tutoiement|\btu\b.*interlocut/i.test(lower) &&
    !/je\s+vouvoie|vouvoiement/i.test(lower)
      ? "tu"
      : "vous";

  let sendWindowStart = 9;
  let sendWindowEnd = 18;
  const win =
    text.match(/entre\s+(\d{1,2})\s*h?\s*(?:et|à|a|-|–|—)\s*(\d{1,2})\s*h?/i) ??
    text.match(/(\d{1,2})\s*h\s*(?:-|–|—|à|a)\s*(\d{1,2})\s*h/i);
  if (win) {
    sendWindowStart = clampHour(win[1], 9);
    sendWindowEnd = clampHour(win[2], 18);
  }

  const coversIdentity =
    Boolean(ownerName) ||
    /je\s+(me\s+présente|suis|m['']appelle)|présentation/i.test(text);
  const coversOffer =
    /produit|service|offre|je\s+(propose|vends|offre)|formation|coaching|automatisation/i.test(
      text
    ) && !/\[décrire/i.test(text);
  const coversPrice =
    (/\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€)?|\bprix\b|\btarif/i.test(text) &&
      !/\[indiquer/i.test(text)) ||
    /\d{3,}/.test(text);
  const coversGoal =
    /objectif|rdv|rendez[- ]?vous|vente|support|closing|paiement|livraison|inscription/i.test(
      text
    ) && !/\[RDV/i.test(text);
  const coversWindow =
    /entre\s+\d{1,2}|envoie\s+uniquement|\d{1,2}\s*h\s*(?:-|–|et)/i.test(text);
  const coversLink =
    /https?:\/\/\S+/i.test(text) ||
    (/lien\s+(utile|à\s+envoyer|de\s+réserv)/i.test(text) && !/\[URL\]/i.test(text));
  const coversTarget =
    /\b(cible|audience|clients?|prospects?|membres?|groupe|freelances?|entrepreneurs?|qui\s+contacter)\b/i.test(
      text
    ) && !/\[cible|\[audience/i.test(text);

  return {
    ownerName,
    stickersEnabled,
    emojiLevel,
    formality,
    sendWindowStart,
    sendWindowEnd,
    coversIdentity,
    coversOffer,
    coversPrice,
    coversGoal,
    coversWindow,
    coversLink,
    coversTarget,
  };
}

function effectiveInstructions(row: Record<string, unknown>): string {
  const raw = String(row.instructions ?? "").trim();
  if (raw) return raw;
  return legacyFieldsToInstructions({
    ownerName: String(row.owner_name ?? ""),
    introFormula: String(row.intro_formula ?? ""),
    tone: normalizeTone(row.tone),
    toneNote: String(row.tone_note ?? ""),
    formality: normalizeFormality(row.formality),
    stickersEnabled: Boolean(row.stickers_enabled),
    emojiLevel: normalizeEmoji(row.emoji_level),
    sendWindowStart: clampHour(row.send_window_start, 9),
    sendWindowEnd: clampHour(row.send_window_end, 18),
  });
}

function mapRow(row: Record<string, unknown>): CampaignMemory {
  const instructions = effectiveInstructions(row);
  const hints = parseMemoryHints(instructions);
  const ownerFromRow = String(row.owner_name ?? "").trim();
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: String(row.name ?? "").trim() || "Mémoire",
    instructions,
    ownerName: ownerFromRow || hints.ownerName,
    introFormula: String(row.intro_formula ?? "").trim(),
    tone: normalizeTone(row.tone),
    toneNote: String(row.tone_note ?? "").trim(),
    formality: normalizeFormality(row.formality) || hints.formality,
    stickersEnabled: Boolean(row.stickers_enabled) || hints.stickersEnabled,
    emojiLevel: normalizeEmoji(row.emoji_level) || hints.emojiLevel,
    sendWindowStart: clampHour(row.send_window_start, hints.sendWindowStart),
    sendWindowEnd: clampHour(row.send_window_end, hints.sendWindowEnd),
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
  const hints = parseMemoryHints(memory.instructions);
  return {
    quietHoursStart: hints.sendWindowEnd || memory.sendWindowEnd,
    quietHoursEnd: hints.sendWindowStart || memory.sendWindowStart,
  };
}

/** Plafond injection agent chat (le live WhatsApp garde la mémoire via campaign-sync). */
const AGENT_MEMORY_INJECT_MAX = 10_000;

/** Texte injecté dans le contexte agent. */
export function formatMemoryForAgent(memory: CampaignMemory): string {
  let body = memory.instructions.trim() || legacyFieldsToInstructions(memory);
  let truncatedNote = "";
  if (body.length > AGENT_MEMORY_INJECT_MAX) {
    body = body.slice(0, AGENT_MEMORY_INJECT_MAX).trimEnd();
    truncatedNote =
      `\n\n[Mémoire tronquée pour budget tokens — détails complets via get_active_campaign_memory si besoin.]`;
  }
  return (
    `## Mémoire active — « ${memory.name} »\n` +
    `Source de vérité CE fil. Applique à la lettre ; n'invente pas ; ne repose pas ce qui est déjà écrit. ` +
    `Conflit explicite utilisateur → suis-le. Changer de mémoire → bouton Mémoire / set_campaign_memory.\n\n` +
    `${body}${truncatedNote}`
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

function normalizeInstructions(raw: unknown, fallback = ""): string {
  const text = String(raw ?? fallback).replace(/\r\n/g, "\n").trim();
  return text.slice(0, INSTRUCTIONS_MAX);
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
  try {
    const s = await getAppSettings(userId);
    if (!ownerName) ownerName = (s.business_owner_name || "").trim();
  } catch {
    /* ignore */
  }

  const instructions =
    normalizeInstructions(input.instructions) ||
    buildDefaultMemoryInstructions({ ownerName });
  const hints = parseMemoryHints(instructions);
  if (!ownerName) ownerName = hints.ownerName;

  const name = input.name.trim().slice(0, 80) || "Mémoire";
  const makeDefault = existing.length === 0 || Boolean(input.isDefault);
  if (makeDefault) await clearDefaults(userId);

  const rows = await sql<Record<string, unknown>[]>`
    INSERT INTO campaign_memories (
      user_id, name, instructions, owner_name, intro_formula, tone, tone_note, formality,
      stickers_enabled, emoji_level, send_window_start, send_window_end, is_default
    ) VALUES (
      ${userId},
      ${name},
      ${instructions},
      ${ownerName.slice(0, 120)},
      ${(input.introFormula ?? "").trim().slice(0, 280)},
      ${normalizeTone(input.tone)},
      ${(input.toneNote ?? "").trim().slice(0, 200)},
      ${normalizeFormality(input.formality ?? hints.formality)},
      ${input.stickersEnabled != null ? Boolean(input.stickersEnabled) : hints.stickersEnabled},
      ${normalizeEmoji(input.emojiLevel ?? hints.emojiLevel)},
      ${clampHour(input.sendWindowStart ?? hints.sendWindowStart, 9)},
      ${clampHour(input.sendWindowEnd ?? hints.sendWindowEnd, 18)},
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
  const instructions =
    input.instructions != null
      ? normalizeInstructions(input.instructions, current.instructions)
      : current.instructions;
  const hints = parseMemoryHints(instructions);
  const ownerName =
    input.ownerName != null
      ? input.ownerName.trim().slice(0, 120)
      : hints.ownerName || current.ownerName;

  const rows = await sql<Record<string, unknown>[]>`
    UPDATE campaign_memories SET
      name = ${name},
      instructions = ${instructions},
      owner_name = ${ownerName},
      intro_formula = ${input.introFormula != null ? input.introFormula.trim().slice(0, 280) : current.introFormula},
      tone = ${input.tone != null ? normalizeTone(input.tone) : current.tone},
      tone_note = ${input.toneNote != null ? input.toneNote.trim().slice(0, 200) : current.toneNote},
      formality = ${
        input.formality != null
          ? normalizeFormality(input.formality)
          : hints.formality || current.formality
      },
      stickers_enabled = ${
        input.stickersEnabled != null ? Boolean(input.stickersEnabled) : hints.stickersEnabled
      },
      emoji_level = ${
        input.emojiLevel != null
          ? normalizeEmoji(input.emojiLevel)
          : hints.emojiLevel || current.emojiLevel
      },
      send_window_start = ${clampHour(
        input.sendWindowStart ?? hints.sendWindowStart,
        current.sendWindowStart
      )},
      send_window_end = ${clampHour(
        input.sendWindowEnd ?? hints.sendWindowEnd,
        current.sendWindowEnd
      )},
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

export async function linkDefaultMemoryToThread(userId: number, threadId: number): Promise<void> {
  const existing = await getThreadCampaignMemoryId(userId, threadId);
  if (existing != null) return;
  const defaultMem = await getDefaultCampaignMemory(userId);
  if (!defaultMem) return;
  await setThreadCampaignMemory(userId, threadId, defaultMem.id);
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

/** Fils qui utilisent actuellement cette mémoire (pour notifier le chat). */
export async function listThreadIdsLinkedToMemory(
  userId: number,
  memoryId: number
): Promise<number[]> {
  await ensureCampaignMemoriesSchema();
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM agent_threads
    WHERE user_id = ${userId} AND campaign_memory_id = ${memoryId}
    ORDER BY updated_at DESC
    LIMIT 20
  `;
  return rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
}

/** Prefill présentation depuis profil business (onboarding). */
export async function getPresentationPrefill(userId: number): Promise<{
  ownerName: string;
  template: string;
}> {
  try {
    const s = await getAppSettings(userId);
    const ownerName = (s.business_owner_name || "").trim();
    return {
      ownerName,
      template: buildDefaultMemoryInstructions({ ownerName }),
    };
  } catch {
    return {
      ownerName: "",
      template: buildDefaultMemoryInstructions(),
    };
  }
}

export { MAX_MEMORIES as CAMPAIGN_MEMORY_MAX };
