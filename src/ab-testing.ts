import { getAutomation, updateAutomationStats, type Automation } from "./db.js";

export interface AbPick {
  variantId: string;
  message: string;
}

export function pickAbVariant(auto: Automation): AbPick {
  const variants = auto.config.abVariants?.filter((v) => v.message?.trim()) ?? [];
  if (!variants.length) {
    return { variantId: "default", message: auto.config.initialMessage?.trim() || "" };
  }
  const stats = auto.stats.abResults ?? {};
  let best = variants[0];
  let bestRate = -1;
  for (const v of variants) {
    const s = stats[v.id] ?? { sent: 0, replied: 0, interested: 0 };
    const rate = s.sent > 0 ? s.replied / s.sent : 0;
    if (rate > bestRate) {
      best = v;
      bestRate = rate;
    }
  }
  const unexplored = variants.find((v) => !(stats[v.id]?.sent));
  const pick = unexplored ?? best;
  return { variantId: pick.id, message: pick.message };
}

export function recordAbSent(automationId: number, variantId: string): void {
  const auto = getAutomation(automationId);
  if (!auto) return;
  const abResults = { ...(auto.stats.abResults ?? {}) };
  const cur = abResults[variantId] ?? { sent: 0, replied: 0, interested: 0 };
  cur.sent += 1;
  abResults[variantId] = cur;
  updateAutomationStats(automationId, { abResults });
}

export function recordAbReply(automationId: number, variantId: string, interested = false): void {
  const auto = getAutomation(automationId);
  if (!auto) return;
  const abResults = { ...(auto.stats.abResults ?? {}) };
  const cur = abResults[variantId] ?? { sent: 0, replied: 0, interested: 0 };
  cur.replied += 1;
  if (interested) cur.interested += 1;
  abResults[variantId] = cur;
  updateAutomationStats(automationId, { abResults });
}
