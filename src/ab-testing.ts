import { getAutomation, updateAutomationStats, type Automation } from "./db.js";
import { sql } from "./pg.js";

export interface AbPick {
  variantId: string;
  message: string;
}

/** Compteurs A/B déjà assignés aux cibles (source de vérité, indépendante de stats_json). */
export async function countAbVariantsAssigned(
  userId: number,
  automationId: number
): Promise<Record<string, number>> {
  const rows = await sql<Array<{ ab_variant: string; n: number }>>`
    SELECT ab_variant, COUNT(*)::int AS n
    FROM automation_targets
    WHERE user_id = ${userId}
      AND automation_id = ${automationId}
      AND ab_variant IS NOT NULL
      AND ab_variant <> ''
      AND ab_variant NOT LIKE 'group-%'
    GROUP BY ab_variant
  `;
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[String(row.ab_variant)] = Number(row.n) || 0;
  }
  return out;
}

/**
 * Choisit l'accroche A/B à envoyer.
 * Rotation équitable : d'abord les moins envoyées ; à égalité, round-robin
 * (évite de coller indéfiniment sur v1 quand tous les taux de réponse sont 0).
 *
 * `assignedCounts` (cibles) prime sur `stats.abResults` si fourni — plus fiable
 * si un recompute a déjà écrasé abResults.
 */
export function pickAbVariant(
  auto: Automation,
  assignedCounts?: Record<string, number>
): AbPick {
  const variants = (auto.config.abVariants ?? []).filter((v) => v.message?.trim());
  if (!variants.length) {
    return { variantId: "default", message: auto.config.initialMessage?.trim() || "" };
  }

  const stats = auto.stats.abResults ?? {};
  const sentOf = (id: string) =>
    assignedCounts && Object.keys(assignedCounts).length > 0
      ? assignedCounts[id] ?? 0
      : stats[id]?.sent ?? 0;
  const minSent = Math.min(...variants.map((v) => sentOf(v.id)));
  const totalSent = variants.reduce((n, v) => n + sentOf(v.id), 0);

  // Parmi les moins envoyées, partir de l'index (totalSent % n) pour tourner.
  const n = variants.length;
  const start = totalSent % n;
  for (let k = 0; k < n; k++) {
    const v = variants[(start + k) % n]!;
    if (sentOf(v.id) === minSent) {
      return { variantId: v.id, message: v.message };
    }
  }

  return { variantId: variants[0]!.id, message: variants[0]!.message };
}

export async function recordAbSent(userId: number, automationId: number, variantId: string): Promise<void> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return;
  const abResults = { ...(auto.stats.abResults ?? {}) };
  const cur = abResults[variantId] ?? { sent: 0, replied: 0, interested: 0 };
  cur.sent += 1;
  abResults[variantId] = cur;
  await updateAutomationStats(userId, automationId, { abResults });
}

export async function recordAbReply(
  userId: number,
  automationId: number,
  variantId: string,
  interested = false
): Promise<void> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return;
  const abResults = { ...(auto.stats.abResults ?? {}) };
  const cur = abResults[variantId] ?? { sent: 0, replied: 0, interested: 0 };
  cur.replied += 1;
  if (interested) cur.interested += 1;
  abResults[variantId] = cur;
  await updateAutomationStats(userId, automationId, { abResults });
}
