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

/**
 * deepseek-v4-pro / reasoner consomment des tokens en reasoning_content :
 * il faut réserver assez de marge pour que content ne soit pas vide.
 */
export function recommendedMaxTokens(model: string, desiredOutput: number): number {
  const m = model.toLowerCase();
  // v4-pro / reasoner : le budget max_tokens inclut reasoning_content.
  // Sans marge large, content reste vide (finish_reason=length).
  if (m.includes("v4") || m.includes("reasoner")) {
    return Math.max(desiredOutput + 650, 800);
  }
  return desiredOutput;
}
