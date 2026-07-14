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
