import OpenAI from "openai";
import { llmProviderLabel } from "./llm.js";

const DEFAULT_MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 60_000;
const PROVIDER = () => llmProviderLabel();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Erreur 429 « quota / crédit épuisé » : réessayer ne changera RIEN.
 * (À distinguer d'une simple limite de vitesse, elle, temporaire.)
 */
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  if (err.status !== 429) return false;
  const code = String((err as { code?: unknown }).code ?? "");
  return code === "insufficient_quota" || /quota|billing|insufficient/i.test(err.message || "");
}

/** Délai conseillé par le fournisseur (headers ou texte « try again in … »). */
function retryAfterMs(err: unknown): number | null {
  const message = err instanceof Error ? err.message : "";
  const isTpm = /tokens per min|TPM|rate limit/i.test(message);

  if (err instanceof OpenAI.APIError && err.headers) {
    const headers = err.headers as Record<string, string | null | undefined>;
    const ms = headers["retry-after-ms"];
    if (ms != null) {
      const n = Number(ms);
      if (Number.isFinite(n) && n >= 0) {
        return Math.min(Math.max(n, isTpm ? 2000 : 0), MAX_BACKOFF_MS);
      }
    }
    const sec = headers["retry-after"];
    if (sec != null) {
      const n = Number(sec);
      if (Number.isFinite(n) && n >= 0) {
        return Math.min(Math.max(n * 1000, isTpm ? 2000 : 0), MAX_BACKOFF_MS);
      }
    }
  }

  const m = /try again in\s+(\d+(?:\.\d+)?)\s*(ms|s|seconds?)/i.exec(message);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const parsed = unit.startsWith("ms") ? n : n * 1000;
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(Math.max(parsed, isTpm ? 2000 : 0), MAX_BACKOFF_MS);
    }
  }

  if (isTpm) return 3000;
  return null;
}

/**
 * Exécute un appel LLM en gérant les erreurs transitoires (429/500/503).
 */
export async function callOpenAiWithRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number } = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const status = err instanceof OpenAI.APIError ? err.status : undefined;
      const retryable = status === 429 || status === 500 || status === 503;
      if (isQuotaError(err) || !retryable || attempt > maxRetries) {
        throw err;
      }
      const backoff = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      const jitter = Math.floor(Math.random() * 400);
      const wait = (retryAfterMs(err) ?? backoff) + jitter;
      await sleep(wait);
    }
  }
}

/** Message clair pour l'utilisateur à partir d'une erreur LLM. */
export function describeOpenAiError(err: unknown): string {
  const name = PROVIDER();
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) {
      return `Clé API ${name} invalide (401). Vérifiez DEEPSEEK_API_KEY / OPENAI_API_KEY sur le serveur.`;
    }
    if (isQuotaError(err)) {
      return (
        `Crédit ${name} épuisé (quota atteint). Rechargez le solde du compte ${name} ` +
        `ou utilisez une clé disposant de crédit.`
      );
    }
    if (err.status === 429) {
      return (
        `Trop de requêtes en peu de temps (limite de vitesse ${name}). ` +
        `Patientez quelques secondes puis réessayez.`
      );
    }
    if (err.status === 500 || err.status === 503) {
      return `${name} est temporairement indisponible. Réessayez dans un moment.`;
    }
    return `Erreur ${name} (${err.status}) : ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
