/**
 * DeepSeek V4 fuit parfois ses appels d'outils en DSML dans `content`
 * au lieu du champ structuré `tool_calls`. On récupère / nettoie.
 *
 * Formats vus en prod :
 * - `<｜DSML｜tool_calls>…<｜DSML｜invoke name="fn">…</｜DSML｜invoke>…`
 * - `< | DSML | tool_calls>…` (ASCII)
 * - fragments UI : `+ | [DSML] | invoke: name="create_automation"`
 */

export type ParsedDsmlToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const DSML_MARK_RE =
  /(?:<\s*[|｜]\s*DSML\s*[|｜]|\[\s*DSML\s*\]|\bDSML\b\s*[|｜:]?\s*(?:tool_calls|invoke))/i;

/** Présence de balises / fuites DSML (même partielles). */
export function containsDsmlToolMarkup(text: string | null | undefined): boolean {
  if (!text) return false;
  return DSML_MARK_RE.test(text) || /invoke\s*[:=]\s*name\s*=\s*["']/i.test(text);
}

function normalizeDsmlDelimiters(raw: string): string {
  return raw
    .replace(/\uFF5C/g, "|") // fullwidth｜
    .replace(/<\s*\|\s*DSML\s*\|\s*/gi, "<|DSML|")
    .replace(/\|\s*DSML\s*\|\s*>/gi, "|DSML|>")
    .replace(/\[\s*DSML\s*\]/gi, "DSML")
    .replace(/\+\s*\|\s*DSML/gi, "|DSML");
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
    /(?:<\s*\|?\s*DSML\s*\|?\s*)?parameter\s+name\s*=\s*["']([^"']+)["'][^>]*>\s*([\s\S]*?)\s*(?:<\/\s*\|?\s*DSML\s*\|?\s*parameter\s*>|(?=<(?:\s*\|?\s*DSML)?|<\/))/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = paramRe.exec(paramBlock)) !== null) {
    matched = true;
    const key = m[1].trim();
    let val = m[2].trim();
    val = val.replace(/<\/?\s*\|?\s*DSML\s*\|?\s*parameter\s*>/gi, "").trim();
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

  // name="fn"{...} ou name="fn" {...}
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
 * Retourne aussi le contenu naturel restant (sans balises).
 */
export function parseDsmlToolCalls(text: string): {
  toolCalls: ParsedDsmlToolCall[];
  contentWithoutDsml: string;
} {
  const normalized = normalizeDsmlDelimiters(text);
  const toolCalls: ParsedDsmlToolCall[] = [];

  // Blocs invoke complets
  const invokeRe =
    /(?:<\s*\|?\s*DSML\s*\|?\s*)?invoke\s*(?::)?\s*name\s*=\s*["']([^"']+)["']\s*(?:[^>]*>)?([\s\S]*?)(?:<\/\s*\|?\s*DSML\s*\|?\s*invoke\s*>|(?=<(?:\s*\|?\s*DSML\s*\|?\s*)?invoke)|$)/gi;

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

  // Fallback : invoke: name="x" suivi d'un JSON
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

/** Retire balises / fuites DSML pour affichage utilisateur. */
export function stripDsmlMarkup(text: string): string {
  if (!text) return "";
  let out = normalizeDsmlDelimiters(text);

  out = out.replace(/<\s*\|?\s*DSML\s*\|?\s*tool_calls\s*>[\s\S]*?(?:<\/\s*\|?\s*DSML\s*\|?\s*tool_calls\s*>|$)/gi, "");
  out = out.replace(/<\s*\|?\s*DSML\s*\|?\s*invoke[\s\S]*?(?:<\/\s*\|?\s*DSML\s*\|?\s*invoke\s*>|$)/gi, "");
  out = out.replace(/<\s*\|?\s*DSML\s*\|?\s*parameter[\s\S]*?(?:<\/\s*\|?\s*DSML\s*\|?\s*parameter\s*>|$)/gi, "");
  out = out.replace(/<\s*\|?\s*DSML\s*\|?[^>]*>/gi, "");
  out = out.replace(/<\/\s*\|?\s*DSML\s*\|?\s*\w*\s*>/gi, "");
  out = out.replace(/\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)[^\n]*/gi, "");
  out = out.replace(/\[\s*DSML\s*\][^\n]*/gi, "");
  out = out.replace(/\binvoke\s*[:=]\s*name\s*=\s*["'][^"']+["'][^\n]*/gi, "");
  out = out.replace(/\btool_calls\s*:?\s*/gi, "");
  out = out.replace(/^\s*[+|]+\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

export const DSML_RETRY_NUDGE =
  "Tu as écrit un appel d'outil en texte DSML / invoke dans le contenu au lieu du champ tool_calls. " +
  "Rappelle MAINTENANT l'outil voulu via l'API tools native (function call). " +
  "INTERDIT de coller [DSML], invoke name=, ou tool_calls: dans le message utilisateur.";
