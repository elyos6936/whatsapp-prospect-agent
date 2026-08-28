/**
 * Persistance des slots briefing par fil (complète regex sur historique compacté).
 */
import { sql } from "./pg.js";

export type ThreadBriefingState = {
  offer?: boolean;
  target?: boolean;
  price?: boolean;
  launch?: boolean;
  openerDirection?: boolean;
  variantsProposed?: boolean;
  stickersAnswered?: boolean;
  updatedAt?: string;
};

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS briefing_state JSONB NOT NULL DEFAULT '{}'`;
      await sql`ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS simulation_shown_at TIMESTAMPTZ`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

export async function getThreadBriefingState(
  userId: number,
  threadId: number,
): Promise<ThreadBriefingState> {
  await ensureSchema().catch(() => {});
  const rows = await sql<Array<{ briefing_state: unknown }>>`
    SELECT briefing_state FROM agent_threads
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
  const raw = rows[0]?.briefing_state;
  if (!raw || typeof raw !== "object") return {};
  return raw as ThreadBriefingState;
}

export async function mergeThreadBriefingState(
  userId: number,
  threadId: number,
  patch: ThreadBriefingState,
): Promise<void> {
  await ensureSchema().catch(() => {});
  const current = await getThreadBriefingState(userId, threadId);
  const next: ThreadBriefingState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await sql`
    UPDATE agent_threads
    SET briefing_state = ${JSON.stringify(next)}::jsonb, updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
}

export function detectBriefingSlotsFromMessage(
  userMessage: string,
  userBlob: string,
): ThreadBriefingState {
  const t = userMessage.trim();
  const blob = userBlob;
  const patch: ThreadBriefingState = {};

  if (
    blob.length > 20 &&
    /\b(offre|produit|service|formation|coaching|je\s+(vends|propose|offre))\b/i.test(blob)
  ) {
    patch.offer = true;
  }
  if (
    /\b(cible|prospect|audience|client|groupe|membres|contact|qui\s+(je|on)\s+)\b/i.test(blob)
  ) {
    patch.target = true;
  }
  if (/\b\d[\d\s.,]{2,}\s*(fcfa|f\b|€|euros?)|\bprix\b.{0,40}\d/i.test(blob)) {
    patch.price = true;
  }
  if (
    /\b(\d{1,2}\s*h|\d{1,2}:\d{2}|demain|maintenant|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(
      blob,
    )
  ) {
    patch.launch = true;
  }
  if (t.length >= 6 && !/^(oui|non|ok)$/i.test(t)) {
    if (
      /\b(ton\s+direct|formel|question\s+ouverte|myst[eè]re|accroche|opener)\b/i.test(t) ||
      t.length >= 40
    ) {
      patch.openerDirection = true;
    }
  }
  if (/\b(stickers?|autocollants?)\b/i.test(t) && /\b(oui|non|pas)\b/i.test(t)) {
    patch.stickersAnswered = true;
  }
  return patch;
}

export function applyPersistedBriefingState(
  missing: string[],
  persisted?: ThreadBriefingState | null,
): string[] {
  if (!persisted) return missing;
  return missing.filter((m) => {
    if (persisted.offer && m.includes("offre")) return false;
    if (persisted.target && m.includes("cible")) return false;
    if (persisted.price && m.includes("prix")) return false;
    if (persisted.launch && (m.includes("lancement") || m.includes("horaires"))) return false;
    return true;
  });
}

/** Le message courant répond-il à la question canonique posée ? */
export function userMessageSatisfiesSlot(slotQuestion: string, userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || t.length < 4) return false;
  if (slotQuestion.includes("prix") || slotQuestion.includes("FCFA")) {
    return /\d[\d\s.,]{2,}/.test(t);
  }
  if (slotQuestion.includes("lance") || slotQuestion.includes("moment")) {
    return /\b(maintenant|demain|\d{1,2}\s*h|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(
      t,
    );
  }
  if (slotQuestion.includes("aborder") || slotQuestion.includes("accroche")) {
    return t.length >= 6 && !/^(oui|non|ok)$/i.test(t);
  }
  if (slotQuestion.includes("stickers")) {
    return /\b(oui|non|pas)\b/i.test(t);
  }
  if (slotQuestion.includes("offre") || slotQuestion.includes("produit")) {
    return t.length >= 12;
  }
  if (slotQuestion.includes("cible") || slotQuestion.includes("contacter")) {
    return t.length >= 8;
  }
  return t.length >= 6;
}

export async function markThreadSimulationShown(userId: number, threadId: number): Promise<void> {
  await ensureSchema().catch(() => {});
  await sql`
    UPDATE agent_threads SET simulation_shown_at = NOW(), updated_at = NOW()
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
}

export async function threadHasSimulationShown(userId: number, threadId: number): Promise<boolean> {
  await ensureSchema().catch(() => {});
  const rows = await sql<Array<{ simulation_shown_at: string | null }>>`
    SELECT simulation_shown_at FROM agent_threads
    WHERE user_id = ${userId} AND id = ${threadId}
  `;
  return rows[0]?.simulation_shown_at != null;
}
