/**
 * Certains modèles (DeepSeek V4, MiniMax tools, parfois Mistral) fuient des
 * appels d'outils en markup DSML / invoke dans `content` au lieu de `tool_calls`.
 *
 * Formats vus en prod :
 * - `<｜DSML｜tool_calls>…<｜DSML｜invoke name="fn">…</｜DSML｜invoke>…`
 * - `< | DSML | tool_calls>…` (ASCII)
 * - `< | | DSML | | tool_calls >…` (doubles pipes + espaces — MiniMax/DeepSeek)
 * - fragments UI : `+ | [DSML] | invoke: name="create_automation"`
 */

export type ParsedDsmlToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const DSML_MARK_RE =
  /(?:DSML|tool_calls\s*>|invoke\s+name\s*=|invoke\s*[:=]\s*name\s*=)/i;

/** Présence de balises / fuites DSML (même partielles / doubles pipes). */
export function containsDsmlToolMarkup(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = normalizeDsmlDelimiters(text);
  if (/\bDSML\b/i.test(n) && /(?:tool_calls|invoke)/i.test(n)) return true;
  if (DSML_MARK_RE.test(n) && /(?:invoke|tool_calls|parameter\s+name)/i.test(n)) return true;
  return /invoke\s*[:=]?\s*name\s*=\s*["']/i.test(n);
}

/**
 * Normalise tous les délimiteurs DSML vers `<|DSML|tag>`.
 * Gère `| |`, fullwidth `｜`, espaces parasites.
 */
export function normalizeDsmlDelimiters(raw: string): string {
  let s = raw.replace(/\uFF5C/g, "|");
  // Collapse « | | » / « || » → un seul pipe
  s = s.replace(/\|\s*\|+/g, "|");
  // Closing tags: </ | DSML | invoke >
  s = s.replace(
    /<\s*\/\s*\|\s*DSML\s*\|\s*([a-zA-Z_][\w]*)?\s*>/gi,
    (_m, tag?: string) => (tag ? `</|DSML|${tag}>` : `</|DSML|>`),
  );
  // Opening tags: < | DSML | tool_calls >
  s = s.replace(
    /<\s*\|\s*DSML\s*\|\s*([a-zA-Z_][\w]*)?\s*>/gi,
    (_m, tag?: string) => (tag ? `<|DSML|${tag}>` : `<|DSML|>`),
  );
  // Unclosed prefix: `< | DSML | invoke name=`
  s = s.replace(/<\s*\|\s*DSML\s*\|\s*/gi, "<|DSML|");
  s = s.replace(/<\/\s*\|\s*DSML\s*\|\s*/gi, "</|DSML|");
  s = s.replace(/\[\s*DSML\s*\]/gi, "DSML");
  s = s.replace(/\+\s*\|\s*DSML/gi, "|DSML");
  return s;
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function paramsToArguments(paramBlock: string): string {
  const params: Record<string, unknown> = {};
  const paramRe =
    /(?:<\|DSML\|)?parameter\s+name\s*=\s*["']([^"']+)["'][^>]*>\s*([\s\S]*?)\s*(?:<\/\|DSML\|parameter>|(?=<(?:\|DSML\|)?|<\/))/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = paramRe.exec(paramBlock)) !== null) {
    matched = true;
    const key = m[1].trim();
    let val = m[2].trim();
    val = val.replace(/<\/?\|DSML\|parameter>/gi, "").trim();
    try {
      params[key] = JSON.parse(val);
    } catch {
      params[key] = val;
    }
  }
  if (matched) return JSON.stringify(params);

  const json = extractJsonObject(paramBlock);
  if (json) {
    try {
      JSON.parse(json);
      return json;
    } catch {
      /* fall through */
    }
  }

  const afterName = paramBlock.replace(/^[\s\S]*?name\s*=\s*["'][^"']+["']\s*/i, "");
  const json2 = extractJsonObject(afterName);
  if (json2) {
    try {
      JSON.parse(json2);
      return json2;
    } catch {
      /* fall through */
    }
  }

  return "{}";
}

/**
 * Extrait des tool_calls OpenAI-compatibles depuis du texte DSML.
 */
export function parseDsmlToolCalls(text: string): {
  toolCalls: ParsedDsmlToolCall[];
  contentWithoutDsml: string;
} {
  const normalized = normalizeDsmlDelimiters(text);
  const toolCalls: ParsedDsmlToolCall[] = [];

  const invokeRe =
    /(?:<\|DSML\|)?invoke\s*(?::)?\s*name\s*=\s*["']([^"']+)["']\s*(?:[^>]*>)?([\s\S]*?)(?:<\/\|DSML\|invoke>|(?=<(?:\|DSML\|)?invoke)|$)/gi;

  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(normalized)) !== null) {
    const name = m[1].trim();
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    const args = paramsToArguments(m[2] || "");
    toolCalls.push({
      id: `dsml_${toolCalls.length}_${Date.now().toString(36)}`,
      type: "function",
      function: { name, arguments: args },
    });
  }

  if (toolCalls.length === 0) {
    const looseRe =
      /invoke\s*[:=]?\s*name\s*=\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*([\s\S]{0,8000})/gi;
    while ((m = looseRe.exec(normalized)) !== null) {
      const name = m[1].trim();
      const args = paramsToArguments(m[2] || "");
      toolCalls.push({
        id: `dsml_${toolCalls.length}_${Date.now().toString(36)}`,
        type: "function",
        function: { name, arguments: args },
      });
    }
  }

  return {
    toolCalls,
    contentWithoutDsml: stripDsmlMarkup(text),
  };
}

/** Retire balises / fuites DSML pour affichage / persistance utilisateur. */
export function stripDsmlMarkup(text: string): string {
  if (!text) return "";
  let out = normalizeDsmlDelimiters(text);

  // Blocs complets tool_calls / invoke / parameter
  out = out.replace(/<\|DSML\|tool_calls>[\s\S]*?(?:<\/\|DSML\|tool_calls>|$)/gi, "");
  out = out.replace(/<\|DSML\|invoke[\s\S]*?(?:<\/\|DSML\|invoke>|$)/gi, "");
  out = out.replace(/<\|DSML\|parameter[\s\S]*?(?:<\/\|DSML\|parameter>|$)/gi, "");
  out = out.replace(/<\/?\|DSML\|[^>]*>/gi, "");
  // Résidus non normalisés (doubles pipes, etc.)
  out = out.replace(/<\s*\/?\s*\|[\s|]*DSML[\s|]*[^>]*>/gi, "");
  out = out.replace(/\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)[^\n]*/gi, "");
  out = out.replace(/\[\s*DSML\s*\][^\n]*/gi, "");
  out = out.replace(/\binvoke\s*[:=]?\s*name\s*=\s*["'][^"']+["'][^\n]*/gi, "");
  out = out.replace(/\btool_calls\s*:?\s*/gi, "");
  out = out.replace(/\bDSML\b/gi, "");
  out = out.replace(/^\s*[+|]+\s*$/gm, "");
  out = out.replace(/[<>]\s*[|/]+\s*/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  // Si encore du markup technique → message neutre (jamais de fuite UI)
  if (containsDsmlToolMarkup(out) || /invoke\s*name\s*=/i.test(out)) {
    return "";
  }

  return out;
}

/** Texte sûr pour l'utilisateur (jamais de DSML brut). */
export function userSafeAssistantText(
  text: string | null | undefined,
  fallback = "Je finalise l'action… Un instant.",
): string {
  const cleaned = stripDsmlMarkup(String(text ?? "")).trim();
  if (!cleaned) return fallback;
  if (containsDsmlToolMarkup(cleaned)) return fallback;
  return cleaned;
}

export const DSML_RETRY_NUDGE =
  "Tu as écrit un appel d'outil en texte DSML / invoke dans le contenu au lieu du champ tool_calls. " +
  "Rappelle MAINTENANT l'outil voulu via l'API tools native (function call). " +
  "INTERDIT de coller DSML, invoke name=, ou tool_calls: dans le message utilisateur.";
