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

/** Texte assistant utilisable. */
export function extractAssistantContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  return message?.content?.trim() ?? "";
}

/**
 * Message assistant à renvoyer dans le contexte multi-tours (tool calling).
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

/** Mistral accepte tool_choice forcé (required / named). */
export function supportsForcedToolChoice(_model: string = config.openaiModel): boolean {
  return true;
}

/** Budget max_tokens. */
export function recommendedMaxTokens(
  _model: string,
  desiredOutput: number,
  _opts?: { thinkingEnabled?: boolean }
): number {
  return desiredOutput;
}
