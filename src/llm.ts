import OpenAI from "openai";
import { config, type LlmProvider } from "./config.js";
import {
  createLlmClientForRole,
  llmExtrasForRole,
  llmExtrasForProvider,
  llmRoleLabel,
  recommendedMaxTokensForRole,
  recommendedMaxTokensForProvider,
} from "./llm-router.js";

export type { LlmRole } from "./llm-router.js";
export {
  createLlmClientForRole,
  llmExtrasForRole,
  llmExtrasForProvider,
  llmRoleLabel,
  recommendedMaxTokensForRole,
  recommendedMaxTokensForProvider,
  resolveLlmRoleModel,
  resolveLlmRoleProvider,
  supportsForcedToolChoiceForRole,
} from "./llm-router.js";

/**
 * Client LLM chat (MiniMax par défaut — dialogue + boucle agent partout).
 * Filet Claude : createLlmClientForRole("tools") pour la simulation uniquement.
 */
export function createLlmClient(apiKey: string): OpenAI {
  return createLlmClientForRole("chat", apiKey);
}

export function llmProviderLabel(): string {
  return llmRoleLabel("chat");
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
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<\/?think\b[^>]*>/gi, "");
  out = out.replace(
    /<\s*redacted_?thinking\b[^>]*>[\s\S]*?<\s*\/\s*redacted_?thinking\s*>/gi,
    "",
  );
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
 */
export function toAssistantHistoryMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
  provider: LlmProvider = config.llmProvider
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  const base: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
  if (provider !== "deepseek") return base;
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

/** Params provider chat (rétrocompat). */
export function llmChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  return llmExtrasForRole("chat", opts);
}

export function deepseekChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  return llmExtrasForRole("chat", opts);
}

export function mistralChatExtras(opts?: { enableThinking?: boolean }): Record<string, unknown> {
  return llmExtrasForRole("chat", opts);
}

export function supportsForcedToolChoice(model: string = config.openaiModel): boolean {
  if (config.llmProvider === "deepseek") return !isThinkingModel(model);
  return true;
}

export function recommendedMaxTokens(
  model: string,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  // Toujours caler sur le provider du modèle réellement appelé.
  if (config.toolLlmConfigured && model === config.toolLlmModel) {
    return recommendedMaxTokensForProvider(
      config.toolLlmProvider,
      config.toolLlmModel,
      desiredOutput,
      opts
    );
  }
  return recommendedMaxTokensForProvider(
    config.llmProvider,
    config.openaiModel,
    desiredOutput,
    opts
  );
}
