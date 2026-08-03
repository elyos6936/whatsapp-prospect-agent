import OpenAI from "openai";
import { config } from "./config.js";

/**
 * Client LLM unique (Mistral via API compatible OpenAI).
 * Tous les modules agent / réponses / perso passent par ici.
 */
export function createLlmClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: config.llmBaseUrl,
  });
}

export function llmProviderLabel(): string {
  return "Mistral";
}

/** Chunks Mistral quand reasoning_effort=high (ThinkChunk + TextChunk). */
type MistralContentChunk = {
  type?: string;
  text?: string;
  thinking?: Array<{ type?: string; text?: string }>;
};

function isContentChunkArray(content: unknown): content is MistralContentChunk[] {
  return Array.isArray(content);
}

/** Texte final uniquement (ignore les chunks `thinking`). */
export function extractAssistantContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  if (!message) return "";
  const content = message.content as unknown;
  if (typeof content === "string") return content.trim();
  if (!isContentChunkArray(content)) return "";

  const texts: string[] = [];
  for (const chunk of content) {
    if (chunk?.type === "text" && typeof chunk.text === "string") {
      texts.push(chunk.text);
    }
  }
  return texts.join("").trim();
}

/**
 * Message assistant à renvoyer dans le contexte multi-tours (tool calling).
 * Avec reasoning_effort=high, les ThinkChunks DOIVENT être rejoués (docs Mistral).
 */
export function toAssistantHistoryMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  return {
    role: "assistant",
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
}

/**
 * Params Mistral à merger dans chat.completions.create.
 * Défaut : reasoning ON (`high`) — recommandé pour agent / outils.
 * Passer `{ enableThinking: false }` pour tâches courtes (mémoire, perso).
 */
export function mistralChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  const enable = opts?.enableThinking !== false;
  return {
    reasoning_effort: enable ? "high" : "none",
  };
}

/** Mistral accepte tool_choice forcé (required / named). */
export function supportsForcedToolChoice(_model: string = config.openaiModel): boolean {
  return true;
}

/**
 * Budget max_tokens. Reasoning ON → marge pour le trace thinking (facturé en output).
 */
export function recommendedMaxTokens(
  model: string,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  const thinking = opts?.thinkingEnabled !== false;
  if (thinking) {
    return Math.max(desiredOutput + 800, 1200);
  }
  return desiredOutput;
}
