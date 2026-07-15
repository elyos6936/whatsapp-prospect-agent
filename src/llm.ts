import OpenAI from "openai";
import { config } from "./config.js";

/**
 * Client LLM unique (DeepSeek via API compatible OpenAI).
 * Tous les modules agent / réponses / perso passent par ici.
 */
export function createLlmClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: config.llmBaseUrl,
  });
}

export function llmProviderLabel(): string {
  return config.llmProvider === "deepseek" ? "DeepSeek" : "OpenAI";
}

/** Texte assistant utilisable (ignore le raisonnement interne des modèles « thinking »). */
export function extractAssistantContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  return message?.content?.trim() ?? "";
}

/** Champ reasoning_content (DeepSeek thinking) — hors typings OpenAI stricts. */
export function extractReasoningContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string | undefined {
  if (!message) return undefined;
  const reasoning = (message as { reasoning_content?: string | null }).reasoning_content;
  return typeof reasoning === "string" && reasoning.length > 0 ? reasoning : undefined;
}

/**
 * Message assistant à renvoyer dans le contexte multi-tours.
 * Avec outils + thinking DeepSeek, reasoning_content DOIT être rejoué (sinon HTTP 400).
 */
export function toAssistantHistoryMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  const reasoning = extractReasoningContent(message);
  const base: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
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
 * Params DeepSeek à merger dans chat.completions.create.
 * Défaut : Thinking ON (qualité outils / campagnes / Pro).
 * Passer `{ enableThinking: false }` pour auto-reply courts (économie).
 */
export function deepseekChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  if (config.llmProvider !== "deepseek") return {};
  if (!isThinkingModel(config.openaiModel)) return {};
  const enable = opts?.enableThinking !== false;
  return {
    thinking: { type: enable ? "enabled" : "disabled" },
  };
}

/**
 * DeepSeek thinking mode refuse tool_choice "required" / fonction nommée (HTTP 400).
 * Seuls "auto" et "none" sont acceptés — on force donc via le prompt système.
 */
export function supportsForcedToolChoice(model: string = config.openaiModel): boolean {
  return !isThinkingModel(model);
}

/**
 * Budget max_tokens. Thinking ON → marge pour reasoning_content.
 */
export function recommendedMaxTokens(
  model: string,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  const m = model.toLowerCase();
  const thinking = opts?.thinkingEnabled !== false && (m.includes("v4") || m.includes("reasoner"));
  if (thinking) {
    return Math.max(desiredOutput + 650, 800);
  }
  return desiredOutput;
}
