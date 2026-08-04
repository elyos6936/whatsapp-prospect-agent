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

export type LlmProvider = "deepseek" | "openai" | "minimax" | "mistral";

function parseProvider(raw: string | undefined, fallback: LlmProvider): LlmProvider {
  const v = (raw || "").trim().toLowerCase();
  if (v === "openai" || v === "minimax" || v === "deepseek" || v === "mistral") return v;
  return fallback;
}

function resolveLlmProvider(): LlmProvider {
  const base = (process.env.LLM_BASE_URL || "").toLowerCase();
  const model = (
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    ""
  ).toLowerCase();

  // Endpoint / modèle MiniMax gagnent toujours (même si LLM_PROVIDER=openai|mistral).
  if (base.includes("minimax") || model.includes("minimax")) {
    return "minimax";
  }

  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase() || "deepseek";
  if (raw === "openai" || raw === "minimax" || raw === "deepseek" || raw === "mistral") {
    return raw;
  }
  if (base.includes("mistral")) return "mistral";
  console.warn(`⚠️ LLM_PROVIDER="${raw}" inconnu → deepseek.`);
  return "deepseek";
}

function defaultBaseUrl(provider: LlmProvider): string {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "minimax") return "https://api.minimax.io/v1";
  if (provider === "mistral") return "https://api.mistral.ai/v1";
  return "https://api.deepseek.com";
}

function defaultModel(provider: LlmProvider): string {
  if (provider === "openai") return "gpt-4o";
  if (provider === "minimax") return "MiniMax-M3";
  if (provider === "mistral") return "mistral-medium-3-5";
  return "deepseek-v4-pro";
}

function resolveApiKeyForProvider(provider: LlmProvider): string {
  const deepseek = process.env.DEEPSEEK_API_KEY?.trim() || "";
  const openai = process.env.OPENAI_API_KEY?.trim() || "";
  const minimax = process.env.MINIMAX_API_KEY?.trim() || "";
  const mistral = process.env.MISTRAL_API_KEY?.trim() || "";

  if (provider === "minimax") {
    return minimax || openai || mistral || deepseek;
  }
  if (provider === "mistral") {
    return mistral || openai || "";
  }
  if (provider === "deepseek") {
    if (deepseek) return deepseek;
    if (openai.startsWith("sk-proj-") || openai.startsWith("sk-svcacct-")) {
      console.error(
        "❌ DEEPSEEK_API_KEY manquante : OPENAI_API_KEY (OpenAI) ne peut pas être utilisée avec DeepSeek."
      );
      return "";
    }
    return openai;
  }
  return openai || deepseek || minimax || mistral;
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
  if (!raw || /flash/i.test(raw)) {
    if (/flash/i.test(raw)) {
      console.warn(`⚠️ LLM_MODEL="${raw}" (Flash) ignoré → deepseek-v4-pro.`);
    }
    return "deepseek-v4-pro";
  }
  return raw;
}

function resolveLlmBaseUrl(): string {
  const explicit = process.env.LLM_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return defaultBaseUrl(resolveLlmProvider());
}

/** Filet outils (DeepSeek recommandé). Si non configuré → même LLM que le chat. */
function resolveToolLlmProvider(): LlmProvider {
  const explicit = process.env.TOOL_LLM_PROVIDER?.trim().toLowerCase();
  if (explicit) return parseProvider(explicit, "deepseek");
  // Défaut : DeepSeek si clé présente, sinon chat
  if (process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
  return resolveLlmProvider();
}

function resolveToolLlmBaseUrl(): string {
  const explicit = process.env.TOOL_LLM_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return defaultBaseUrl(resolveToolLlmProvider());
}

function resolveToolLlmModel(): string {
  const raw = process.env.TOOL_LLM_MODEL?.trim() || "";
  if (raw) return raw;
  return defaultModel(resolveToolLlmProvider());
}

function resolveToolLlmApiKey(): string {
  return resolveApiKeyForProvider(resolveToolLlmProvider());
}

function isToolLlmConfigured(): boolean {
  // Actif si TOOL_LLM_* explicite OU DEEPSEEK_API_KEY présente (filet auto)
  if (process.env.TOOL_LLM_PROVIDER?.trim()) return Boolean(resolveToolLlmApiKey());
  if (process.env.DEEPSEEK_API_KEY?.trim()) return true;
  return false;
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
   * Fournisseur LLM chat (API compatible OpenAI : DeepSeek | MiniMax | Mistral | OpenAI).
   * Les outils critiques (sim/activate) sont déterministes ; filet tools = toolLlm*.
   */
  llmProvider: resolveLlmProvider(),
  llmBaseUrl: resolveLlmBaseUrl(),
  /** Modèle chat (dialogue, accroches). */
  openaiModel: resolveLlmModel(),
  /** Filet tool-calling (DeepSeek si DEEPSEEK_API_KEY / TOOL_LLM_*). */
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
