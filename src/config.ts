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

function resolveLlmApiKey(): string {
  const deepseek = process.env.DEEPSEEK_API_KEY?.trim() || "";
  const openai = process.env.OPENAI_API_KEY?.trim() || "";
  const provider = (process.env.LLM_PROVIDER?.trim().toLowerCase() || "deepseek") as "deepseek" | "openai";

  if (provider === "deepseek") {
    if (deepseek) return deepseek;
    // Une clé OpenAI (sk-proj-…) envoyée à DeepSeek provoque un 401 trompeur.
    if (openai.startsWith("sk-proj-") || openai.startsWith("sk-svcacct-")) {
      console.error(
        "❌ DEEPSEEK_API_KEY manquante : OPENAI_API_KEY (OpenAI) ne peut pas être utilisée avec DeepSeek."
      );
      return "";
    }
    // Anciennes clés DeepSeek parfois mises dans OPENAI_API_KEY
    return openai;
  }
  return openai || deepseek;
}

export const config = {
  port,
  timezone: appTimezone,
  databaseUrl: process.env.DATABASE_URL?.trim() || "",
  jwtSecret: process.env.JWT_SECRET?.trim() || "",
  publicUrl: (process.env.PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, ""),
  /**
   * Fournisseur LLM. DeepSeek = API compatible OpenAI (baseURL + modèle).
   * Clé : DEEPSEEK_API_KEY prioritaire, sinon OPENAI_API_KEY (rétrocompat).
   */
  llmProvider: (process.env.LLM_PROVIDER?.trim().toLowerCase() || "deepseek") as "deepseek" | "openai",
  llmBaseUrl: (
    process.env.LLM_BASE_URL?.trim() ||
    (process.env.LLM_PROVIDER?.trim().toLowerCase() === "openai"
      ? "https://api.openai.com/v1"
      : "https://api.deepseek.com")
  ).replace(/\/$/, ""),
  /** Modèle chat + tool calling. Défaut DeepSeek V4 Pro (qualité / tools). */
  openaiModel:
    process.env.LLM_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    (process.env.LLM_PROVIDER?.trim().toLowerCase() === "openai" ? "gpt-4o" : "deepseek-v4-pro"),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
  defaultEvolutionBaseUrl: "http://localhost:8080",
  envOpenAiKey: resolveLlmApiKey(),
  envEvolutionBaseUrl: (process.env.EVOLUTION_API_BASE_URL?.trim() || "").replace(/\/$/, ""),
  envEvolutionApiKey: process.env.EVOLUTION_API_KEY?.trim() || "",
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
