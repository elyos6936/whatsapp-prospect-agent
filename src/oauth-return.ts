import type { FastifyRequest } from "fastify";
import { config, resolveOAuthReturnBase } from "./config.js";

/** Origine front depuis Origin / Referer (connect OAuth depuis le navigateur). */
export function pickOAuthReturnBase(request: FastifyRequest): string {
  const origin = request.headers.origin?.trim();
  if (origin) {
    return resolveOAuthReturnBase(process.env.APP_URL, origin);
  }
  const referer = request.headers.referer?.trim();
  if (referer) {
    try {
      return resolveOAuthReturnBase(process.env.APP_URL, new URL(referer).origin);
    } catch {
      /* ignore */
    }
  }
  return config.appUrl;
}

export function appSettingsRedirectUrl(
  query: Record<string, string>,
  baseUrl: string = config.appUrl,
): string {
  const url = new URL("/app", baseUrl.replace(/\/$/, ""));
  url.searchParams.set("settings", "integrations");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}
