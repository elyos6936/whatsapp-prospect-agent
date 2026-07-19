/**
 * Parse OAuth callback query params from the raw URL.
 * Fastify/querystring treat bare "+" as space — that corrupts authorization codes.
 */

export function rawQueryParam(url: string, key: string): string | undefined {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return undefined;
  const query = url.slice(qIndex + 1).split("#")[0] ?? "";
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawVal = eq < 0 ? "" : part.slice(eq + 1);
    let decodedKey: string;
    try {
      decodedKey = decodeURIComponent(rawKey);
    } catch {
      decodedKey = rawKey;
    }
    if (decodedKey !== key) continue;
    try {
      // decodeURIComponent keeps literal "+" (unlike querystring.parse)
      return decodeURIComponent(rawVal);
    } catch {
      return rawVal;
    }
  }
  return undefined;
}
