import OpenAI from "openai";

const DEFAULT_MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 60_000;

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

/** Délai conseillé par OpenAI (headers ou texte « try again in … »). */
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

  // Sans délai explicite : pour un TPM saturé, attendre un peu avant de retenter.
  if (isTpm) return 3000;
  return null;
}

/**
 * Exécute un appel OpenAI en gérant les erreurs transitoires (429/500/503).
 * - Respecte le header Retry-After quand OpenAI l'envoie.
 * - Back-off exponentiel plafonné + jitter sinon.
 * - N'insiste PAS sur une erreur de quota (crédit épuisé) : c'est inutile,
 *   on remonte immédiatement l'erreur pour afficher un message clair.
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

/** Message clair et actionnable pour l'utilisateur à partir d'une erreur OpenAI. */
export function describeOpenAiError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) {
      return "Clé API OpenAI invalide (401). Vérifiez votre clé dans Connexions.";
    }
    if (isQuotaError(err)) {
      return (
        "Crédit OpenAI épuisé (quota atteint). Ce n'est pas une simple limite de vitesse : " +
        "il faut recharger le solde du compte OpenAI (facturation) ou utiliser une clé disposant de crédit. " +
        "Dès que le crédit est rétabli, tout refonctionne sans rien changer ici."
      );
    }
    if (err.status === 429) {
      return (
        "Trop de requêtes en peu de temps (limite de vitesse OpenAI). " +
        "Patientez quelques secondes puis réessayez. Si cela revient souvent, augmentez le palier (tier) de votre compte OpenAI."
      );
    }
    if (err.status === 500 || err.status === 503) {
      return "OpenAI est temporairement indisponible. Réessayez dans un moment.";
    }
    return `Erreur OpenAI (${err.status}) : ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
