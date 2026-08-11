/**
 * Routage fenêtre d'envoi — ISOLÉ du pipeline briefing / create / persona.
 * Appelle uniquement update_automation_config(send_window_*) sur la campagne du fil.
 * Voir .cursor/rules/campaign-config-frozen.mdc
 */
import type { AgentMessage } from "./db.js";
import { executeTool } from "./tools.js";
import { userFacingError } from "./user-facing.js";

function clampHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/** Parse fenêtre d'ACTIVITÉ (ex. « 8h–20h », « de 8h à 20h »). */
export function parseSendWindowFromText(text: string): { start: number; end: number } | null {
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

function userWantsSendWindowChange(text: string): boolean {
  const win = parseSendWindowFromText(text);
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

function extractSendWindowFromUserMessages(
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
    const win = parseSendWindowFromText(text);
    if (win && userWantsSendWindowChange(text)) return win;
  }
  return null;
}

export function shouldRouteSendWindowChange(
  history: AgentMessage[],
  userMessage: string,
  automationId: number | null | undefined
): boolean {
  if (!automationId) return false;
  return extractSendWindowFromUserMessages(history, userMessage) != null;
}

/** Applique send_window_* via l'outil existant — aucun autre champ config. */
export async function tryApplySendWindowFromUserMessage(opts: {
  userId: number;
  threadId: number;
  automationId: number;
  history: AgentMessage[];
  userMessage: string;
}): Promise<string | null> {
  const win = extractSendWindowFromUserMessages(opts.history, opts.userMessage);
  if (!win) return null;

  const raw = await executeTool(opts.userId, opts.threadId, "update_automation_config", {
    automation_id: opts.automationId,
    send_window_start: win.start,
    send_window_end: win.end,
  });

  try {
    const parsed = JSON.parse(raw) as {
      success?: boolean;
      error?: string;
      configSummary?: { sendWindow?: string | null };
    };
    if (parsed.error) return userFacingError(parsed.error);
    if (!parsed.success) {
      return "Impossible de changer la fenêtre d'envoi pour cette campagne.";
    }
    const sw = parsed.configSummary?.sendWindow;
    return sw
      ? `C'est fait — fenêtre d'envoi **${sw}** pour cette campagne.`
      : `Fenêtre d'envoi mise à jour (${win.start}h–${win.end}h).`;
  } catch {
    return "Impossible de changer la fenêtre d'envoi pour cette campagne.";
  }
}
