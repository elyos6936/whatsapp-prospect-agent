/**
 * Heures calmes = plages SANS envoi WhatsApp.
 * Convention : si start > end → overnight (ex. 20→9 = calme la nuit, envoi le jour).
 * Si start < end → calme en journée (ex. 12→14 = pause déjeuner).
 */

export type QuietHours = { start: number; end: number };

/** Défaut outbound : activité ~9h–20h → calme 20h→9h. */
export const DEFAULT_OUTBOUND_QUIET: QuietHours = { start: 20, end: 9 };

/** Défaut inbound / support : activité ~8h–19h → calme 19h→8h. */
export const DEFAULT_INBOUND_QUIET: QuietHours = { start: 19, end: 8 };

function clampHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/**
 * Corrige le bug historique : quietHoursStart=9 / End=20 (et variantes 8–18, 9–18…)
 * étaient des fenêtres d'ACTIVITÉ stockées à l'envers → « hors fenêtre » toute la journée.
 */
export function normalizeQuietHours(
  start: number | null | undefined,
  end: number | null | undefined
): QuietHours | null {
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const s = clampHour(start);
  const e = clampHour(end);
  if (s === e) return { start: s, end: e };

  // Quiet diurne large le matin→soir = activité mal enregistrée → inverser
  if (s < e) {
    const span = e - s;
    if (span >= 6 && s <= 12 && e >= 17) {
      return { start: e, end: s };
    }
  }
  return { start: s, end: e };
}

export function resolveOutboundQuietHours(
  start: number | null | undefined,
  end: number | null | undefined
): QuietHours {
  return normalizeQuietHours(start, end) ?? DEFAULT_OUTBOUND_QUIET;
}

export function resolveInboundQuietHours(
  start: number | null | undefined,
  end: number | null | undefined
): QuietHours {
  return normalizeQuietHours(start, end) ?? DEFAULT_INBOUND_QUIET;
}

/** True si l'heure locale courante est dans la plage calme. */
export function isWithinQuietHours(
  quiet: QuietHours,
  hour: number = new Date().getHours()
): boolean {
  const { start, end } = quiet;
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}
