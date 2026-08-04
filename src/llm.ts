import OpenAI from "openai";
import { config } from "./config.js";

/**
 * Client LLM unique (API compatible OpenAI : DeepSeek / MiniMax / Mistral / OpenAI).
 * Infra inchangée : baseURL + clé + modèle via env.
 */
export function createLlmClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: config.llmBaseUrl,
  });
}

export function llmProviderLabel(): string {
  if (config.llmProvider === "deepseek") return "DeepSeek";
  if (config.llmProvider === "minimax") return "MiniMax";
  if (config.llmProvider === "mistral") return "Mistral";
  return "OpenAI";
}

/** Chunks Mistral (ThinkChunk + TextChunk) quand reasoning_effort=high. */
type MistralContentChunk = {
  type?: string;
  text?: string;
  thinking?: Array<{ type?: string; text?: string }>;
};

function isContentChunkArray(content: unknown): content is MistralContentChunk[] {
  return Array.isArray(content);
}

/**
 * Retire le monologue interne MiniMax / divers modèles
 * (`<think>…</think>`, balises redacted, etc.) du texte utilisateur.
 */
export function stripInternalThinking(text: string): string {
  if (!text) return "";
  let out = text;
  // MiniMax / modèles ouverts : balises think
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<\/?think\b[^>]*>/gi, "");
  // Variantes redacted_thinking
  out = out.replace(
    /<\s*redacted_?thinking\b[^>]*>[\s\S]*?<\s*\/\s*redacted_?thinking\s*>/gi,
    "",
  );
  // Filets orphelins / fuites partielles
  out = out.replace(/^\s*thinking\s*\n+/i, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Texte assistant affichable (sans raisonnement interne). */
export function extractAssistantContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  if (!message) return "";
  const content = message.content as unknown;

  if (typeof content === "string") {
    return stripInternalThinking(content);
  }

  // Mistral : ne garder que les chunks `text` (ignorer `thinking`)
  if (isContentChunkArray(content)) {
    const texts: string[] = [];
    for (const chunk of content) {
      if (chunk?.type === "text" && typeof chunk.text === "string") {
        texts.push(chunk.text);
      }
    }
    return stripInternalThinking(texts.join(""));
  }

  return "";
}

/** Champ reasoning_content (DeepSeek / MiniMax split) — hors typings OpenAI stricts. */
export function extractReasoningContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string | undefined {
  if (!message) return undefined;
  const reasoning = (message as { reasoning_content?: string | null }).reasoning_content;
  return typeof reasoning === "string" && reasoning.length > 0 ? reasoning : undefined;
}

/**
 * Message assistant à renvoyer dans le contexte multi-tours.
 * DeepSeek thinking : reasoning_content DOIT être rejoué (sinon HTTP 400).
 * Mistral / MiniMax : content (+ tool_calls) suffit.
 */
export function toAssistantHistoryMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  const base: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
  if (config.llmProvider !== "deepseek") return base;
  const reasoning = extractReasoningContent(message);
  if (!reasoning) return base;
  return {
    ...base,
    reasoning_content: reasoning,
  } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
}

/** Modèles DeepSeek en thinking mode par défaut (v4 / reasoner). */
export function isThinkingModel(model: string = config.openaiModel): boolean {
  const m = model.toLowerCase();
  return m.includes("v4") || m.includes("reasoner") || m.includes("r1");
}

/**
 * Params provider à merger dans chat.completions.create.
 * - MiniMax : thinking TOUJOURS off (évite fuites `<think>` + latence).
 * - Mistral : reasoning_effort selon opts (défaut high côté agent si non précisé).
 * - DeepSeek : thinking enabled/disabled selon opts.
 */
export function llmChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  const provider = config.llmProvider;

  if (provider === "minimax") {
    // Toujours désactivé pour Klanvio (SaaS : vitesse + pas de fuite thinking).
    return { thinking: { type: "disabled" } };
  }

  if (provider === "mistral") {
    const enable = opts?.enableThinking !== false;
    if (!enable) return { reasoning_effort: "none" };
    return { reasoning_effort: "high", top_p: 0.95 };
  }

  if (provider === "deepseek") {
    if (!isThinkingModel(config.openaiModel)) return {};
    const enable = opts?.enableThinking !== false;
    return { thinking: { type: enable ? "enabled" : "disabled" } };
  }

  return {};
}

/** Alias rétrocompat — tous les call sites passent par llmChatExtras. */
export function deepseekChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  return llmChatExtras(opts);
}

/** Alias rétrocompat (code Will / origin). */
export function mistralChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  return llmChatExtras(opts);
}

/**
 * DeepSeek thinking refuse tool_choice forcé. MiniMax / Mistral / OpenAI : OK.
 */
export function supportsForcedToolChoice(model: string = config.openaiModel): boolean {
  if (config.llmProvider === "deepseek") return !isThinkingModel(model);
  return true;
}

/**
 * Budget max_tokens. Pas de marge thinking pour MiniMax (thinking forcé off).
 */
export function recommendedMaxTokens(
  model: string,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  if (config.llmProvider === "minimax") {
    return desiredOutput;
  }
  if (config.llmProvider === "mistral") {
    const thinking = opts?.thinkingEnabled !== false;
    if (thinking) return Math.max(desiredOutput + 800, 1200);
    return desiredOutput;
  }
  const m = model.toLowerCase();
  const thinking =
    opts?.thinkingEnabled !== false && (m.includes("v4") || m.includes("reasoner"));
  if (thinking) {
    return Math.max(desiredOutput + 650, 800);
  }
  return desiredOutput;
}
