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
  // (ex. 9→18, 6→15 passés comme « quiet » alors que c'est la fenêtre d'envoi)
  if (s < e) {
    const span = e - s;
    if (span >= 6 && s <= 12 && e >= 14) {
      return { start: e, end: s };
    }
  }
  return { start: s, end: e };
}

/**
 * Fenêtre d'ACTIVITÉ (ce que dit l'utilisateur : « 6h–15h ») → heures calmes.
 * Ex. activité 6→15 → quiet 15→6.
 */
export function activityWindowToQuietHours(
  sendStart: number | null | undefined,
  sendEnd: number | null | undefined
): QuietHours | null {
  if (typeof sendStart !== "number" || typeof sendEnd !== "number") return null;
  if (!Number.isFinite(sendStart) || !Number.isFinite(sendEnd)) return null;
  const start = clampHour(sendStart);
  const end = clampHour(sendEnd);
  if (start === end) return null;
  return normalizeQuietHours(end, start) ?? { start: end, end: start };
}

/** Quiet hours → fenêtre d'activité affichable (ex. quiet 15→6 → « 6h–15h »). */
export function quietHoursToActivityWindow(quiet: QuietHours): {
  sendWindowStart: number;
  sendWindowEnd: number;
} {
  return { sendWindowStart: quiet.end, sendWindowEnd: quiet.start };
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

/** Parse une fenêtre d'ACTIVITÉ dans le texte (ex. « 8h–19h », « de 8h à 19h »). */
export function parseActivityWindowFromText(text: string): {
  start: number;
  end: number;
} | null {
  const t = (text || "").trim();
  if (!t) return null;
  const patterns = [
    /(?:entre|de)\s+(\d{1,2})\s*h?\s*(?:à|a|–|—|-)\s*(\d{1,2})\s*h?/i,
    /(\d{1,2})\s*h\s*(?:–|—|-)\s*(\d{1,2})\s*h/i,
    /(\d{1,2})\s*h\s*(?:à|a)\s*(\d{1,2})\s*h/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1] && m?.[2]) {
      const start = clampHour(Number(m[1]));
      const end = clampHour(Number(m[2]));
      if (start !== end) return { start, end };
    }
  }
  return null;
}

/** L'utilisateur demande explicitement une fenêtre d'envoi (≠ choix A/B d'accroche). */
export function userRequestsSendWindowChange(text: string): boolean {
  const win = parseActivityWindowFromText(text);
  if (!win) return false;
  const t = text.trim();
  if (
    /^\d{1,2}\s*h\s*(?:–|—|-)\s*\d{1,2}\s*h\.?\s*$/i.test(t) ||
    /^(?:change|chang[eé]|modif)\b/i.test(t)
  ) {
    return true;
  }
  return (
    /\b(?:allons\s+(?:pour|sur)|change|chang[eé]|modif|fen[eê]tre|horaires?|plage|mets|passe|entre|sp[eé]cifiquement|cette\s+campagne|pour\s+cette\s+campagne)\b/i.test(
      t
    ) ||
    /\b(?:oui|ok|okay|d['’]accord)\b/i.test(t)
  );
}

/** Dernière fenêtre demandée explicitement dans le fil (user messages, récents d'abord). */
export function extractSendWindowFromMessages(
  messages: Array<{ role?: string; content?: string }>,
  extra?: string
): { start: number; end: number } | null {
  const userLines: string[] = [];
  if (extra?.trim()) userLines.push(extra.trim());
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && m.content?.trim()) userLines.push(m.content.trim());
  }
  for (const text of userLines) {
    const win = parseActivityWindowFromText(text);
    if (win && userRequestsSendWindowChange(text)) return win;
  }
  return null;
}

/** Fenêtre mentionnée pendant le briefing (création brouillon), même sans « change » explicite. */
export function extractSendWindowForDraft(
  messages: Array<{ role?: string; content?: string }>,
  extra?: string
): { start: number; end: number } | null {
  const explicit = extractSendWindowFromMessages(messages, extra);
  if (explicit) return explicit;
  const lines: string[] = [];
  if (extra?.trim()) lines.push(extra.trim());
  for (const m of messages) {
    if (m?.role === "user" && m.content?.trim()) lines.push(m.content.trim());
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i]!;
    const win = parseActivityWindowFromText(text);
    if (!win) continue;
    if (
      /\b(?:fen[eê]tre|horaires?|plage|envoi|activit[eé]|allons\s+(?:pour|sur)|sp[eé]cifiquement|campagne)\b/i.test(
        text
      ) ||
      /^\d{1,2}\s*h\s*(?:–|—|-)\s*\d{1,2}\s*h/i.test(text.trim())
    ) {
      return win;
    }
  }
  return null;
}
