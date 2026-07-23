import {
  enforceUniqueWhatsAppPhoneOnConnect,
  invalidateConnectionStateCache,
  restartInstance,
  testEvolutionConnection,
  type EvolutionConnectionState,
} from "./evolutionapi.js";

/** Dernière confirmation `open` (évite de basculer l’UI sur un faux offline). */
const lastOpenAt = new Map<number, number>();
/** Logout volontaire — ignore sticky + heal jusqu’au prochain scan QR / open. */
const loggedOutAt = new Map<number, number>();
/** Message à afficher dans la modale de connexion WhatsApp (pas le chat). */
const connectUiMessage = new Map<number, string>();
/** Anti-boucle heal (restart Baileys). */
const lastHealAt = new Map<number, number>();
const HEAL_COOLDOWN_MS = 90_000;
/** Sticky : garder « connecté » X ms après un open confirmé, même si un poll flake. */
export const CONNECTION_STICKY_MS = 120_000;

export function markWhatsAppOpen(userId: number): void {
  loggedOutAt.delete(userId);
  connectUiMessage.delete(userId);
  lastOpenAt.set(userId, Date.now());
}

/** Appelé juste avant / après un logout volontaire (Réglages → Déconnecter). */
export function markWhatsAppLoggedOut(userId: number): void {
  lastOpenAt.delete(userId);
  loggedOutAt.set(userId, Date.now());
  invalidateConnectionStateCache(userId);
}

export function clearWhatsAppLoggedOut(userId: number): void {
  loggedOutAt.delete(userId);
}

export function isWhatsAppIntentionallyLoggedOut(userId: number): boolean {
  return loggedOutAt.has(userId);
}

/** Message visible dans WhatsAppConnectModal (conflit numéro, etc.). */
export function setWhatsAppConnectUiMessage(userId: number, message: string): void {
  const clean = message.trim();
  if (clean) connectUiMessage.set(userId, clean);
  else connectUiMessage.delete(userId);
}

export function getWhatsAppConnectUiMessage(userId: number): string | null {
  return connectUiMessage.get(userId) ?? null;
}

export function clearWhatsAppConnectUiMessage(userId: number): void {
  connectUiMessage.delete(userId);
}

export function getLastWhatsAppOpenAt(userId: number): number | null {
  return lastOpenAt.get(userId) ?? null;
}

export function isWhatsAppStickyOpen(userId: number, stickyMs = CONNECTION_STICKY_MS): boolean {
  if (loggedOutAt.has(userId)) return false;
  const at = lastOpenAt.get(userId);
  return at != null && Date.now() - at < stickyMs;
}

/**
 * Relance douce Baileys (credentials conservés) — PAS de logout / PAS de nouveau QR.
 */
export async function healWhatsAppSession(
  userId: number,
  reason: string
): Promise<{ healed: boolean; skipped?: string }> {
  if (isWhatsAppIntentionallyLoggedOut(userId)) {
    return { healed: false, skipped: "intentional-logout" };
  }
  const now = Date.now();
  const last = lastHealAt.get(userId) ?? 0;
  if (now - last < HEAL_COOLDOWN_MS) {
    return {
      healed: false,
      skipped: `cooldown ${Math.ceil((HEAL_COOLDOWN_MS - (now - last)) / 1000)}s`,
    };
  }
  lastHealAt.set(userId, now);
  invalidateConnectionStateCache(userId);

  console.log(`🩹 Heal WhatsApp user=${userId} — ${reason}`);
  try {
    await restartInstance(userId);
    console.log(`✅ Heal restart OK user=${userId}`);
    return { healed: true };
  } catch (err) {
    console.warn(
      `⚠️ Heal restart échoué user=${userId}:`,
      err instanceof Error ? err.message : err
    );
    return { healed: false, skipped: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Interprète un événement CONNECTION_UPDATE Evolution/Baileys.
 */
export async function handleConnectionUpdate(userId: number, data: unknown): Promise<number> {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const instance = (d.instance as Record<string, unknown> | undefined) ?? (d.state ? d : undefined);
  const rawState = String(
    d.state ?? instance?.state ?? d.connection ?? d.status ?? ""
  ).toLowerCase();

  invalidateConnectionStateCache(userId);

  if (!rawState) {
    console.log(
      `🔌 CONNECTION_UPDATE user=${userId} (état non lisible)`,
      JSON.stringify(d).slice(0, 200)
    );
    return 1;
  }

  console.log(`🔌 CONNECTION_UPDATE user=${userId} → ${rawState}`);

  if (rawState === "open" || rawState === "connected") {
    // Anti-doublon : même numéro déjà lié à une autre instance Klanvio.
    try {
      const unique = await enforceUniqueWhatsAppPhoneOnConnect(userId);
      if (!unique.ok) {
        console.warn(
          `⛔ WhatsApp phone conflict user=${userId} — déjà sur ${unique.conflictInstance ?? "?"}`
        );
        const conflictMsg =
          "Ce numéro WhatsApp est déjà connecté sur un autre compte Klanvio. " +
          "Un seul compte par numéro est autorisé — déconnecte l’autre compte ou utilise un autre numéro.";
        setWhatsAppConnectUiMessage(userId, conflictMsg);
        markWhatsAppLoggedOut(userId);
        const { logoutInstance } = await import("./evolutionapi.js");
        await logoutInstance(userId).catch(() => {});
        return 1;
      }
    } catch (err) {
      console.warn(
        `⚠️ enforceUniqueWhatsAppPhoneOnConnect user=${userId}:`,
        err instanceof Error ? err.message : err
      );
    }
    markWhatsAppOpen(userId);
    return 1;
  }

  if (
    rawState === "close" ||
    rawState === "closed" ||
    rawState === "conflict" ||
    rawState === "refused" ||
    rawState.includes("disconnect")
  ) {
    if (!isWhatsAppIntentionallyLoggedOut(userId)) {
      void healWhatsAppSession(userId, `webhook:${rawState}`).catch(() => {});
    }
  }

  return 1;
}

/**
 * Applique la sticky policy par-dessus l'état brut Evolution.
 */
export function applyConnectionSticky(
  userId: number,
  raw: EvolutionConnectionState
): EvolutionConnectionState {
  // Logout volontaire : jamais de sticky ni de faux « connecté », même si Evolution
  // renvoie encore `open` pendant la course logout (quelques secondes).
  if (isWhatsAppIntentionallyLoggedOut(userId)) {
    const uiMsg = getWhatsAppConnectUiMessage(userId);
    return {
      connected: false,
      state: raw.state === "open" ? "close" : raw.state || "close",
      message: uiMsg || "WhatsApp déconnecté.",
    };
  }

  if (raw.connected && raw.state === "open") {
    markWhatsAppOpen(userId);
    return raw;
  }

  const sticky = isWhatsAppStickyOpen(userId);

  if (raw.state === "error" || raw.state === "unknown") {
    if (sticky) {
      return {
        connected: true,
        state: "degraded",
        message: "Statut WhatsApp temporairement indisponible — session considérée active.",
      };
    }
    return raw;
  }

  if (raw.state === "connecting") {
    if (sticky) {
      return {
        connected: true,
        state: "connecting",
        message: "Reconnexion WhatsApp en cours…",
      };
    }
    return raw;
  }

  if (raw.state === "close" || raw.state === "closed") {
    if (sticky) {
      void healWhatsAppSession(userId, "state-close-sticky").catch(() => {});
      return {
        connected: true,
        state: "reconnecting",
        message: "Session WhatsApp en restauration automatique…",
      };
    }
    void healWhatsAppSession(userId, "state-close").catch(() => {});
    return {
      connected: false,
      state: "close",
      message: "WhatsApp déconnecté — restauration en cours. Si ça dure, rescanez le QR.",
    };
  }

  return raw;
}

/** Statut WhatsApp pour l’UI (/api/me) — sticky activé par défaut. */
export async function getWhatsAppConnectionStatus(
  userId: number,
  opts: { sticky?: boolean; bypassCache?: boolean } = {}
): Promise<EvolutionConnectionState> {
  const sticky = opts.sticky !== false;
  const raw = await testEvolutionConnection(userId, { bypassCache: opts.bypassCache });
  return sticky ? applyConnectionSticky(userId, raw) : raw;
}

/** Vérifie périodiquement les sessions et soigne les close silencieux. */
export async function watchWhatsAppConnections(
  listUserIds: () => Promise<number[]>
): Promise<void> {
  const ids = await listUserIds();
  for (const userId of ids) {
    try {
      const raw = await testEvolutionConnection(userId, { bypassCache: true });
      if (raw.connected && raw.state === "open") {
        markWhatsAppOpen(userId);
        continue;
      }
      if (
        (raw.state === "close" || raw.state === "closed" || raw.state === "conflict") &&
        !isWhatsAppIntentionallyLoggedOut(userId)
      ) {
        await healWhatsAppSession(userId, `watchdog:${raw.state}`);
      }
    } catch {
      /* best effort */
    }
  }
}
