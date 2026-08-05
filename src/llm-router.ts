/**
 * Routeur LLM dual :
 * - chat = MiniMax partout (dialogue + boucle agent + outils)
 * - sim  = Claude filet pour génération de simulation seulement
 *   (alias historique du rôle "tools" — jamais le chat)
 *
 * Activation campagne = déterministe (sans LLM).
 *
 * RÈGLE : les extras (thinking, etc.) doivent suivre le *provider du client
 * réellement appelé*, jamais un autre rôle — sinon MiniMax sans
 * thinking:disabled → content vide → « Je n'ai pas pu générer de réponse ».
 */
import OpenAI from "openai";
import { config, type LlmProvider } from "./config.js";

/** "tools" = alias historique = filet simulation Claude (pas la boucle agent). */
export type LlmRole = "chat" | "tools";

export function resolveLlmRoleProvider(role: LlmRole): LlmProvider {
  if (role === "tools" && config.toolLlmConfigured) {
    return config.toolLlmProvider;
  }
  return config.llmProvider;
}

export function resolveLlmRoleModel(role: LlmRole): string {
  if (role === "tools" && config.toolLlmConfigured) {
    return config.toolLlmModel;
  }
  return config.openaiModel;
}

export function resolveLlmRoleBaseUrl(role: LlmRole): string {
  if (role === "tools" && config.toolLlmConfigured) {
    return config.toolLlmBaseUrl;
  }
  return config.llmBaseUrl;
}

export function resolveLlmRoleApiKey(role: LlmRole): string {
  if (role === "tools" && config.toolLlmConfigured) {
    return config.toolLlmApiKey;
  }
  return config.envOpenAiKey;
}

export function llmRoleLabel(role: LlmRole): string {
  const p = resolveLlmRoleProvider(role);
  if (p === "claude") return "Claude";
  if (p === "deepseek") return "DeepSeek";
  if (p === "minimax") return "MiniMax";
  if (p === "mistral") return "Mistral";
  return "OpenAI";
}

export function createLlmClientForRole(role: LlmRole, apiKey?: string): OpenAI {
  const key = (apiKey?.trim() || resolveLlmRoleApiKey(role)).trim();
  const provider = resolveLlmRoleProvider(role);
  return new OpenAI({
    apiKey: key,
    baseURL: resolveLlmRoleBaseUrl(role),
    ...(provider === "claude"
      ? { defaultHeaders: { "anthropic-version": "2023-06-01" } }
      : {}),
  });
}

/**
 * Extras API selon le provider réellement appelé (pas selon un rôle abstrait).
 * Toujours passer le même provider que le client OpenAI utilisé pour l'appel.
 */
export function llmExtrasForProvider(
  provider: LlmProvider,
  model: string,
  opts?: { enableThinking?: boolean }
): Record<string, unknown> {
  if (provider === "minimax") {
    return {
      thinking: { type: "disabled" },
      reasoning_split: true,
    };
  }
  if (provider === "mistral") {
    const enable = opts?.enableThinking !== false;
    if (!enable) return { reasoning_effort: "none" };
    return { reasoning_effort: "high", top_p: 0.95 };
  }
  if (provider === "deepseek") {
    const m = model.toLowerCase();
    const isThinking = m.includes("v4") || m.includes("reasoner") || m.includes("r1");
    if (!isThinking) return {};
    const enable = opts?.enableThinking !== false;
    return { thinking: { type: enable ? "enabled" : "disabled" } };
  }
  return {};
}

export function recommendedMaxTokensForProvider(
  provider: LlmProvider,
  model: string,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  if (provider === "minimax") return desiredOutput;
  if (provider === "mistral") {
    if (opts?.thinkingEnabled !== false) return Math.max(desiredOutput + 800, 1200);
    return desiredOutput;
  }
  if (provider === "deepseek") {
    const m = model.toLowerCase();
    const thinking =
      opts?.thinkingEnabled !== false &&
      (m.includes("v4") || m.includes("reasoner") || m.includes("r1"));
    if (thinking) return Math.max(desiredOutput + 650, 800);
  }
  return desiredOutput;
}

/** Préférer llmExtrasForProvider(provider, model) avec le provider du client. */
export function llmExtrasForRole(
  role: LlmRole,
  opts?: { enableThinking?: boolean }
): Record<string, unknown> {
  return llmExtrasForProvider(
    resolveLlmRoleProvider(role),
    resolveLlmRoleModel(role),
    opts
  );
}

/** Préférer recommendedMaxTokensForProvider. */
export function recommendedMaxTokensForRole(
  role: LlmRole,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  return recommendedMaxTokensForProvider(
    resolveLlmRoleProvider(role),
    resolveLlmRoleModel(role),
    desiredOutput,
    opts
  );
}

export function supportsForcedToolChoiceForRole(role: LlmRole): boolean {
  const provider = resolveLlmRoleProvider(role);
  const model = resolveLlmRoleModel(role);
  if (provider === "deepseek") {
    const m = model.toLowerCase();
    return !(m.includes("v4") || m.includes("reasoner") || m.includes("r1"));
  }
  return true;
}
