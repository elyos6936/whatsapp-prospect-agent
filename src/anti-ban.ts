/**
 * Anti-ban WhatsApp — rythme humain, warmup, plafonds.
 *
 * Espacement campagne : proportionnel au nb de prospects (voir recommendOutboundGaps).
 * Auto-reply : micro-écart 2–5 s à l'envoi (délai ~60 s déjà appliqué en amont).
 */

import { recommendOutboundGaps } from "./campaign-spacing.js";

export const ANTI_BAN = {
  /** Défaut si campagne sans config (volume moyen) */
  minGapMs: 45_000,
  maxGapMs: 90_000,
  /** Micro-écart anti-collision pour auto-replies indépendants */
  autoReplyMinGapMs: 2_000,
  autoReplyMaxGapMs: 5_000,
  /** Présence « en train d'écrire » — court = plus naturel */
  presenceMinMs: 1_500,
  presenceMaxMs: 6_000,
  /** Delay typing intégré aux envois texte Evolution */
  textDelayMaxMs: 6_000,
  /** Soft caps warmup (jours depuis création compte) */
  warmupCaps: [10, 12, 15, 18, 22, 25, 30] as const,
  /** Max openers / jour / campagne si non précisé */
  defaultCampaignMaxPerDay: 15,
  /** Relances par défaut si absentes */
  defaultRelanceDelaysDays: [1, 3] as number[],
  defaultRelanceHour: 10,
  defaultRelanceMessages: [
    "Je me permets de revenir vers vous. Est-ce que ça vous parle toujours ?",
    "Dernier message de ma part — dites-moi juste oui ou non, j'adapte.",
  ],
} as const;

export type OutboundGapOpts = {
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  /** auto_reply = 2–5 s ; campaign / défaut = config campagne ou 45–90 s */
  profile?: "campaign" | "auto_reply";
  /** Nb de prospects — utilisé si min/max absents */
  prospectCount?: number;
};

/** Prochain créneau d'envoi autorisé (epoch ms) — openers / campagnes. */
const nextSlotAtByUser = new Map<number, number>();
/** Dernier envoi réel (epoch ms) — utilisé pour micro-collision auto-reply. */
const lastOutboundAtByUser = new Map<number, number>();
/** File de promesses : un seul wait→send→mark à la fois par user. */
const mutexTailByUser = new Map<number, Promise<void>>();
/** Release du mutex courant (appelé par mark ou release). */
const heldByUser = new Map<number, { release: () => void; opts?: OutboundGapOpts }>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveGapMs(opts?: OutboundGapOpts): { min: number; max: number } {
  if (opts?.profile === "auto_reply") {
    return {
      min: ANTI_BAN.autoReplyMinGapMs,
      max: Math.max(ANTI_BAN.autoReplyMinGapMs + 500, ANTI_BAN.autoReplyMaxGapMs),
    };
  }

  const hasCustom =
    (opts?.minDelaySeconds != null && Number(opts.minDelaySeconds) > 0) ||
    (opts?.maxDelaySeconds != null && Number(opts.maxDelaySeconds) > 0);

  if (!hasCustom && opts?.prospectCount != null) {
    const g = recommendOutboundGaps(opts.prospectCount);
    return { min: g.minDelaySeconds * 1000, max: g.maxDelaySeconds * 1000 };
  }

  if (!hasCustom) {
    return { min: ANTI_BAN.minGapMs, max: Math.max(ANTI_BAN.minGapMs + 5_000, ANTI_BAN.maxGapMs) };
  }

  // Autoriser des délais courts (petites campagnes) — plancher absolu 15 s
  const min = Math.max(
    15_000,
    Math.round(Number(opts!.minDelaySeconds ?? ANTI_BAN.minGapMs / 1000) * 1000)
  );
  const maxRaw = Math.round(Number(opts!.maxDelaySeconds ?? ANTI_BAN.maxGapMs / 1000) * 1000);
  const max = Math.max(min + 5_000, Math.min(Math.max(maxRaw, min), 300_000));
  return { min, max };
}

function randomGapMs(opts?: OutboundGapOpts): number {
  const { min, max } = resolveGapMs(opts);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Temps restant avant le prochain créneau campagne (0 = libre). */
export function getOutboundSlotWaitMs(userId: number): number {
  const slot = nextSlotAtByUser.get(userId) ?? 0;
  return Math.max(0, slot - Date.now());
}

/**
 * Attend le créneau anti-spam et **prend le mutex** jusqu'à
 * markOutboundSentForUser / releaseOutboundSlot.
 *
 * - campaign / défaut : respecte nextSlot (40–80 s)
 * - auto_reply : ignore le slot campagne ; attend seulement 2 s mini
 *   depuis le dernier envoi (conversations indépendantes ~60 s)
 */
export async function waitOutboundSpacingForUser(
  userId: number,
  opts?: OutboundGapOpts
): Promise<void> {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  const prev = mutexTailByUser.get(userId) ?? Promise.resolve();
  mutexTailByUser.set(
    userId,
    prev.then(() => gate).catch(() => gate)
  );

  await prev.catch(() => undefined);

  let wait = 0;
  if (opts?.profile === "auto_reply") {
    const last = lastOutboundAtByUser.get(userId) ?? 0;
    wait = Math.max(0, last + ANTI_BAN.autoReplyMinGapMs - Date.now());
  } else {
    wait = getOutboundSlotWaitMs(userId);
  }

  if (wait > 0) {
    const label = opts?.profile === "auto_reply" ? "micro-collision auto-reply" : "anti-spam campagne";
    console.log(`⏳ ${label} (user ${userId}) : ${Math.ceil(wait / 1000)}s…`);
    await sleep(wait);
  }

  heldByUser.set(userId, { release, opts });
}

/**
 * Après un envoi réussi : met à jour lastOutbound + prochain créneau, libère le mutex.
 */
export function markOutboundSentForUser(userId: number, opts?: OutboundGapOpts): void {
  const held = heldByUser.get(userId);
  const gapOpts = opts ?? held?.opts;
  const now = Date.now();
  lastOutboundAtByUser.set(userId, now);
  const gap = randomGapMs(gapOpts);

  if (gapOpts?.profile === "auto_reply") {
    // Ne raccourcit pas un créneau campagne déjà planifié plus loin
    const existing = nextSlotAtByUser.get(userId) ?? 0;
    nextSlotAtByUser.set(userId, Math.max(existing, now + gap));
  } else {
    nextSlotAtByUser.set(userId, now + gap);
  }

  heldByUser.delete(userId);
  held?.release();

  if (gapOpts?.profile !== "auto_reply") {
    console.log(
      `🛡️ Prochain opener/campagne user ${userId} dans ~${Math.round(gap / 1000)}s`
    );
  }
}

/**
 * En cas d'échec d'envoi après waitOutboundSpacing : libère le mutex
 * sans consommer un créneau.
 */
export function releaseOutboundSlot(userId: number): void {
  const held = heldByUser.get(userId);
  if (!held) return;
  heldByUser.delete(userId);
  held.release();
}

/** @deprecated alias — préférer waitOutboundSpacingForUser */
export async function acquireOutboundSlot(
  userId: number,
  opts?: OutboundGapOpts
): Promise<void> {
  await waitOutboundSpacingForUser(userId, opts);
}

/** Clamp durée de présence typing. */
export function clampPresenceMs(ms: number): number {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 3_000;
  return Math.min(Math.max(Math.round(n), ANTI_BAN.presenceMinMs), ANTI_BAN.presenceMaxMs);
}

/** Clamp delay Evolution text options. */
export function clampTextDelayMs(ms: number | undefined): number | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(Math.round(ms), 500), ANTI_BAN.textDelayMaxMs);
}

/**
 * Plafond journalier warmup : comptes récents = volumes bas.
 * daysSinceCreation 0 → index 0, etc.
 */
export function warmupDailyCap(daysSinceCreation: number): number {
  const d = Math.max(0, Math.floor(daysSinceCreation));
  const caps = ANTI_BAN.warmupCaps;
  return caps[Math.min(d, caps.length - 1)];
}

/** Messages de relance par défaut (sans crochets). */
export function defaultRelanceConfig(): {
  enabled: true;
  delaysDays: number[];
  hour: number;
  messages: string[];
} {
  return {
    enabled: true,
    delaysDays: [...ANTI_BAN.defaultRelanceDelaysDays],
    hour: ANTI_BAN.defaultRelanceHour,
    messages: [...ANTI_BAN.defaultRelanceMessages],
  };
}
