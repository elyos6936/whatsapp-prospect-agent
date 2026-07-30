/**
 * Pacing des réponses closing entrant : vagues de N, délai min 1h entre vagues,
 * 1–2 min entre envois, hors plage → report au prochain créneau.
 */
import { formatLocalDateTime, type AutomationConfig } from "./db.js";
import { sql } from "./pg.js";

export const INBOUND_REPLY_AB_VARIANT = "inbound_reply";

export type InboundPacingConfig = {
  batchSize: number;
  /** Minutes entre le début de deux vagues (min 60). */
  waveGapMinutes: number;
  intraMinSeconds: number;
  intraMaxSeconds: number;
  /** Début plage d'envoi (heure locale inclusive), ex. 8. */
  sendWindowStartHour: number;
  /** Fin plage d'envoi (heure locale exclusive), ex. 19. */
  sendWindowEndHour: number;
};

export function resolveInboundPacing(config: AutomationConfig): InboundPacingConfig {
  const quietStart =
    typeof config.quietHoursStart === "number" ? config.quietHoursStart : 19;
  const quietEnd = typeof config.quietHoursEnd === "number" ? config.quietHoursEnd : 8;
  const gap = Math.max(60, Math.floor(config.inboundWaveGapMinutes ?? 120));
  const intraMin = Math.max(30, Math.floor(config.inboundIntraMinSeconds ?? 60));
  const intraMax = Math.max(intraMin, Math.floor(config.inboundIntraMaxSeconds ?? 120));
  return {
    batchSize: Math.min(100, Math.max(1, Math.floor(config.inboundBatchSize ?? 50))),
    waveGapMinutes: gap,
    intraMinSeconds: intraMin,
    intraMaxSeconds: intraMax,
    // Fenêtre d'activité = fin des heures calmes → début des heures calmes
    sendWindowStartHour: Math.min(23, Math.max(0, quietEnd)),
    sendWindowEndHour: Math.min(23, Math.max(0, quietStart)),
  };
}

export function pickIntraDelayMs(pacing: InboundPacingConfig): number {
  const min = pacing.intraMinSeconds * 1000;
  const max = pacing.intraMaxSeconds * 1000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Reporte `d` dans la plage d'envoi locale (ex. 8h–19h). */
export function clampToSendWindow(d: Date, pacing: InboundPacingConfig): Date {
  const out = new Date(d.getTime());
  const start = pacing.sendWindowStartHour;
  const end = pacing.sendWindowEndHour;

  if (start === end) return out;

  if (start < end) {
    // Plage diurne classique 8→19
    if (out.getHours() < start) {
      out.setHours(start, Math.min(30, out.getMinutes()), 0, 0);
    } else if (out.getHours() >= end) {
      out.setDate(out.getDate() + 1);
      out.setHours(start, 0, 0, 0);
    }
    return out;
  }

  // Plage qui traverse minuit (ex. 22→7) : autorisé si hour >= start || hour < end
  const h = out.getHours();
  const inWindow = h >= start || h < end;
  if (inWindow) return out;
  // Entre end et start → pousser à start le jour même
  out.setHours(start, 0, 0, 0);
  return out;
}

type Wave = { start: Date; times: Date[] };

function rebuildWaves(sorted: Date[], batchSize: number, gapMs: number): Wave[] {
  const waves: Wave[] = [];
  for (const t of sorted) {
    const last = waves[waves.length - 1];
    if (
      !last ||
      last.times.length >= batchSize ||
      t.getTime() >= last.start.getTime() + gapMs
    ) {
      waves.push({ start: t, times: [t] });
    } else {
      last.times.push(t);
    }
  }
  return waves;
}

/**
 * Calcule le prochain créneau d'envoi pour une réponse entrante.
 * - 1ʳᵉ vague : dès maintenant (puis clamp plage)
 * - Dans une vague < batchSize : +1–2 min après le dernier
 * - Vague pleine : début = max(now, débutVague + gap)
 */
export function computeNextInboundSlot(
  now: Date,
  existingSendAts: Date[],
  pacing: InboundPacingConfig,
  intraDelayMs: number = pickIntraDelayMs(pacing)
): Date {
  const gapMs = pacing.waveGapMinutes * 60_000;
  const sorted = [...existingSendAts].sort((a, b) => a.getTime() - b.getTime());
  const waves = rebuildWaves(sorted, pacing.batchSize, gapMs);
  const current = waves[waves.length - 1];

  let candidate: Date;
  if (!current) {
    candidate = new Date(now.getTime());
  } else if (current.times.length < pacing.batchSize) {
    const last = current.times[current.times.length - 1]!;
    candidate = new Date(Math.max(now.getTime(), last.getTime()) + intraDelayMs);
  } else {
    candidate = new Date(Math.max(now.getTime(), current.start.getTime() + gapMs));
  }

  return clampToSendWindow(candidate, pacing);
}

export async function listInboundReplySendAts(
  userId: number,
  automationId: number
): Promise<Date[]> {
  const rows = await sql<{ send_at: string | Date }[]>`
    SELECT send_at
    FROM send_queue
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND ab_variant = ${INBOUND_REPLY_AB_VARIANT}
      AND status IN ('pending', 'processing', 'sent')
      AND send_at >= NOW() - INTERVAL '3 days'
    ORDER BY send_at ASC
  `;
  return rows.map((r) => new Date(r.send_at));
}

export async function computeInboundReplySendAtIso(
  userId: number,
  automationId: number,
  config: AutomationConfig
): Promise<string> {
  const pacing = resolveInboundPacing(config);
  const existing = await listInboundReplySendAts(userId, automationId);
  const next = computeNextInboundSlot(new Date(), existing, pacing);
  return formatLocalDateTime(next);
}
