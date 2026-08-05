import "dotenv/config";

// Fuseau horaire de l'application (par défaut Bénin / UTC+1, sans heure d'été).
// Le serveur Hostinger tourne en UTC : on force le TZ pour que toutes les
// heures « locales » (séquences, relances, rapports, planification) soient
// correctes. Doit être défini AVANT toute opération sur les dates.
const appTimezone = process.env.APP_TIMEZONE?.trim() || process.env.TZ?.trim() || "Africa/Porto-Novo";
process.env.TZ = appTimezone;

const portRaw = process.env.PORT?.trim() || "3000";
const port = Number(portRaw);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`\n❌ PORT invalide : "${portRaw}". Attendu un entier entre 1 et 65535.\n`);
  process.exit(1);
}

export type LlmProvider = "deepseek" | "openai" | "minimax" | "mistral" | "claude";

function resolveLlmProvider(): LlmProvider {
  const base = (process.env.LLM_BASE_URL || "").toLowerCase();
  const model = (
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    ""
  ).toLowerCase();

  // Endpoint / modèle MiniMax gagnent toujours.
  if (base.includes("minimax") || model.includes("minimax")) {
    return "minimax";
  }
  // Claude / Anthropic / DeepSeek ne sont jamais le chat principal.
  if (
    base.includes("anthropic") ||
    base.includes("deepseek") ||
    model.includes("claude") ||
    model.includes("deepseek")
  ) {
    console.warn(`⚠️ URL/modèle chat Claude|DeepSeek ignoré → minimax (Claude = sim uniquement).`);
    return "minimax";
  }

  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase() || "minimax";
  if (raw === "deepseek" || raw === "claude" || raw === "anthropic") {
    console.warn(`⚠️ LLM_PROVIDER=${raw} ignoré → minimax (Claude = filet simulation).`);
    return "minimax";
  }
  if (raw === "openai" || raw === "minimax" || raw === "mistral") {
    return raw;
  }
  if (base.includes("mistral")) return "mistral";
  console.warn(`⚠️ LLM_PROVIDER="${raw}" inconnu → minimax.`);
  return "minimax";
}

function defaultBaseUrl(provider: LlmProvider): string {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "minimax") return "https://api.minimax.io/v1";
  if (provider === "mistral") return "https://api.mistral.ai/v1";
  if (provider === "claude") return "https://api.anthropic.com/v1";
  // deepseek type legacy — ne pas joindre api.deepseek.com
  return "https://api.minimax.io/v1";
}

function defaultModel(provider: LlmProvider): string {
  if (provider === "openai") return "gpt-4o";
  if (provider === "minimax") return "MiniMax-M3";
  if (provider === "mistral") return "mistral-medium-3-5";
  if (provider === "claude") return "claude-sonnet-4-5";
  return "MiniMax-M3";
}

function resolveApiKeyForProvider(provider: LlmProvider): string {
  const openai = process.env.OPENAI_API_KEY?.trim() || "";
  const minimax = process.env.MINIMAX_API_KEY?.trim() || "";
  const mistral = process.env.MISTRAL_API_KEY?.trim() || "";
  const anthropic =
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.CLAUDE_API_KEY?.trim() ||
    "";

  if (provider === "claude") {
    return anthropic;
  }
  if (provider === "minimax") {
    return minimax || openai || "";
  }
  if (provider === "mistral") {
    return mistral || openai || "";
  }
  if (provider === "deepseek") {
    // Jamais utilisé en prod — pas de clé DeepSeek.
    return "";
  }
  return openai || anthropic || minimax || mistral;
}

function resolveLlmApiKey(): string {
  return resolveApiKeyForProvider(resolveLlmProvider());
}

function resolveLlmModel(): string {
  const provider = resolveLlmProvider();
  const raw = process.env.LLM_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "";
  if (provider === "openai") return raw || defaultModel(provider);
  if (provider === "minimax") return raw || defaultModel(provider);
  if (provider === "mistral") return raw || defaultModel(provider);
  if (provider === "claude") return raw || defaultModel(provider);
  return raw || defaultModel("minimax");
}

function resolveLlmBaseUrl(): string {
  const explicit = process.env.LLM_BASE_URL?.trim();
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower.includes("deepseek")) {
      console.warn(`⚠️ LLM_BASE_URL DeepSeek ignoré → ${defaultBaseUrl("minimax")}`);
      return defaultBaseUrl("minimax");
    }
    return explicit.replace(/\/$/, "");
  }
  return defaultBaseUrl(resolveLlmProvider());
}

/**
 * Filet Claude = génération de simulation uniquement (remplace DeepSeek).
 * Chat / boucle agent / create_automation = toujours MiniMax (LLM_PROVIDER).
 * TOOL_LLM_PROVIDER=deepseek est ignoré.
 */
function resolveToolLlmProvider(): LlmProvider {
  const explicit = process.env.TOOL_LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "deepseek") {
    console.warn(`⚠️ TOOL_LLM_PROVIDER=deepseek ignoré → claude (filet sim uniquement).`);
  } else if (explicit && explicit !== "claude" && explicit !== "anthropic") {
    console.warn(
      `⚠️ TOOL_LLM_PROVIDER="${explicit}" ignoré → claude (sim uniquement ; chat = MiniMax).`
    );
  }
  return "claude";
}

function resolveToolLlmBaseUrl(): string {
  const explicit = process.env.TOOL_LLM_BASE_URL?.trim();
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower.includes("deepseek")) {
      console.warn(`⚠️ TOOL_LLM_BASE_URL DeepSeek ignoré → Anthropic.`);
      return defaultBaseUrl("claude");
    }
    return explicit.replace(/\/$/, "");
  }
  return defaultBaseUrl("claude");
}

function resolveToolLlmModel(): string {
  const raw = process.env.TOOL_LLM_MODEL?.trim() || "";
  if (raw && /deepseek/i.test(raw)) {
    console.warn(`⚠️ TOOL_LLM_MODEL DeepSeek ignoré → ${defaultModel("claude")}`);
    return defaultModel("claude");
  }
  if (raw) return raw;
  return defaultModel("claude");
}

function resolveToolLlmApiKey(): string {
  return resolveApiKeyForProvider("claude");
}

function isToolLlmConfigured(): boolean {
  return Boolean(resolveToolLlmApiKey());
}

/**
 * Front URL pour redirects OAuth.
 * APP_URL = liste CSV de fronts autorisés (Vercel preview, www prod, etc.).
 */
function isInfraAppUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("hstgr.cloud") ||
      host.includes("srv1820011") ||
      host === "localhost" ||
      host === "127.0.0.1"
    );
  } catch {
    return true;
  }
}

function normalizeAppOrigin(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

/** Parse APP_URL (CSV) → origines front autorisées pour le retour OAuth. */
export function parseAppUrlAllowlist(rawEnv: string | undefined): string[] {
  const raw = rawEnv?.trim() || "https://www.klanvio.com,https://klanvio.vercel.app";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const origin = normalizeAppOrigin(part);
    if (!origin || isInfraAppUrl(origin) || seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  if (out.length === 0) return ["https://www.klanvio.com"];
  return out;
}

/** URL front par défaut (prod canonique). */
export function resolveDefaultAppUrl(rawEnv: string | undefined): string {
  const allowlist = parseAppUrlAllowlist(rawEnv);
  return (
    allowlist.find((u) => /^https:\/\/www\.klanvio\.com$/i.test(u)) ||
    allowlist.find((u) => /^https:\/\/klanvio\.com$/i.test(u)) ||
    allowlist[0]!
  );
}

/**
 * Retour OAuth : utilise l’origine du front (Origin / Referer) si elle est dans APP_URL,
 * sinon le défaut prod (www.klanvio.com).
 */
export function resolveOAuthReturnBase(
  rawEnv: string | undefined,
  hint?: string | null,
): string {
  const allowlist = parseAppUrlAllowlist(rawEnv);
  const normalizedHint = hint ? normalizeAppOrigin(hint) : "";
  if (normalizedHint) {
    const exact = allowlist.find((u) => u.toLowerCase() === normalizedHint.toLowerCase());
    if (exact) return exact;
    // Sous-domaines Vercel preview du projet (klanvio-xxx.vercel.app)
    try {
      const host = new URL(normalizedHint).hostname.toLowerCase();
      if (host.endsWith(".vercel.app") && host.startsWith("klanvio")) return normalizedHint;
    } catch {
      /* ignore */
    }
  }
  return resolveDefaultAppUrl(rawEnv);
}

export const config = {
  port,
  timezone: appTimezone,
  databaseUrl: process.env.DATABASE_URL?.trim() || "",
  jwtSecret: process.env.JWT_SECRET?.trim() || "",
  publicUrl: (process.env.PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, ""),
  /**
   * Chat principal = MiniMax partout (dialogue + boucle agent).
   * Filet Claude = génération de simulation uniquement (ANTHROPIC_API_KEY).
   * Activation campagne = déterministe, sans LLM.
   */
  llmProvider: resolveLlmProvider(),
  llmBaseUrl: resolveLlmBaseUrl(),
  /** Modèle chat (dialogue, accroches, outils agent). */
  openaiModel: resolveLlmModel(),
  /** Filet Claude pour simulation (pas le chat). */
  toolLlmConfigured: isToolLlmConfigured(),
  toolLlmProvider: resolveToolLlmProvider(),
  toolLlmBaseUrl: resolveToolLlmBaseUrl(),
  toolLlmModel: resolveToolLlmModel(),
  toolLlmApiKey: resolveToolLlmApiKey(),
  /** Login Google (GIS / ID token) — client distinct des intégrations. */
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
  /**
   * OAuth Web client « Intégrations » (Sheets / futur Forms, Calendar).
   * Séparé de GOOGLE_CLIENT_ID (login).
   */
  googleIntegrationsClientId: process.env.GOOGLE_INTEGRATIONS_CLIENT_ID?.trim() || "",
  googleIntegrationsClientSecret: process.env.GOOGLE_INTEGRATIONS_CLIENT_SECRET?.trim() || "",
  /** Optionnel — défaut = `{PUBLIC_URL}/api/integrations/google/callback`. */
  googleIntegrationsRedirectUri: process.env.GOOGLE_INTEGRATIONS_REDIRECT_URI?.trim() || "",
  /** Front par défaut (redirect OAuth sans hint) — www.klanvio.com si présent dans APP_URL. */
  appUrl: resolveDefaultAppUrl(process.env.APP_URL),
  /** Liste CSV des fronts autorisés pour le retour OAuth dynamique. */
  appUrlAllowlist: parseAppUrlAllowlist(process.env.APP_URL),
  typeformClientId: process.env.TYPEFORM_CLIENT_ID?.trim() || "",
  typeformClientSecret: process.env.TYPEFORM_CLIENT_SECRET?.trim() || "",
  /** Optionnel — défaut = `{PUBLIC_URL}/api/integrations/typeform/callback`. */
  typeformRedirectUri: process.env.TYPEFORM_REDIRECT_URI?.trim() || "",
  /**
   * Clé AES-256 (64 hex). Ne JAMAIS changer en prod : les tokens chiffrés
   * deviennent illisibles. Générer : openssl rand -hex 32
   */
  tokensEncryptionKey: process.env.TOKENS_ENCRYPTION_KEY?.trim() || "",
  defaultEvolutionBaseUrl: "http://localhost:8080",
  envOpenAiKey: resolveLlmApiKey(),
  envEvolutionBaseUrl: (process.env.EVOLUTION_API_BASE_URL?.trim() || "").replace(/\/$/, ""),
  envEvolutionApiKey: process.env.EVOLUTION_API_KEY?.trim() || "",
  /** Compte ops Hostinger — séparé des comptes clients. */
  adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() || "",
  adminPassword: process.env.ADMIN_PASSWORD?.trim() || "",
  /** Optionnel : bcrypt hash ; prioritaire sur ADMIN_PASSWORD si défini. */
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH?.trim() || "",
  /** URL API MoneyFusion (lien application généré dans leur console). */
  moneyFusionApiUrl: process.env.MONEYFUSION_API_URL?.trim() || "",
  /** URL de vérification d'un paiement : `${base}/{token}`. */
  moneyFusionVerifyBaseUrl:
    (process.env.MONEYFUSION_VERIFY_BASE_URL?.trim() ||
      "https://www.pay.moneyfusion.net/paiementNotif").replace(/\/$/, ""),
} as const;

/**
 * Exceptions de nommage d'instance Evolution par utilisateur.
 * Le compte opérateur historique (id=1) reste lié à l'instance déjà connectée
 * « automax-prospection ». Tous les autres comptes suivent le schéma standard.
 */
const INSTANCE_NAME_OVERRIDES: Record<number, string> = {
  1: "automax-prospection",
};

/** Instance Evolution dédiée par utilisateur (plateforme gérée). */
export function evolutionInstanceName(userId: number): string {
  return INSTANCE_NAME_OVERRIDES[userId] ?? `klanvio_${userId}`;
}

/** Résout l'userId à partir d'un nom d'instance (inverse d'evolutionInstanceName). */
export function userIdFromEvolutionInstance(instance: string): number | null {
  const name = String(instance ?? "").trim();
  for (const [id, override] of Object.entries(INSTANCE_NAME_OVERRIDES)) {
    if (override.toLowerCase() === name.toLowerCase()) return Number(id);
  }
  const m = /^klanvio_(\d+)$/i.exec(name);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}
