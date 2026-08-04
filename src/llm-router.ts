/**
 * Routeur LLM dual :
 * - chatLlm  = dialogue (MiniMax par défaut)
 * - toolLlm  = boucle outils (DeepSeek par défaut si clé présente)
 *
 * Les actions critiques (simuler / activer) passent par des chemins
 * déterministes sans LLM — voir deterministic-campaign.ts.
 */
import OpenAI from "openai";
import { config, type LlmProvider } from "./config.js";

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
  if (p === "deepseek") return "DeepSeek";
  if (p === "minimax") return "MiniMax";
  if (p === "mistral") return "Mistral";
  return "OpenAI";
}

export function createLlmClientForRole(role: LlmRole, apiKey?: string): OpenAI {
  const key = (apiKey?.trim() || resolveLlmRoleApiKey(role)).trim();
  return new OpenAI({
    apiKey: key,
    baseURL: resolveLlmRoleBaseUrl(role),
  });
}

/** Extras provider pour un rôle donné (thinking off MiniMax, etc.). */
export function llmExtrasForRole(
  role: LlmRole,
  opts?: { enableThinking?: boolean }
): Record<string, unknown> {
  const provider = resolveLlmRoleProvider(role);
  const model = resolveLlmRoleModel(role);

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

export function recommendedMaxTokensForRole(
  role: LlmRole,
  desiredOutput: number,
  opts?: { thinkingEnabled?: boolean }
): number {
  const provider = resolveLlmRoleProvider(role);
  const model = resolveLlmRoleModel(role);
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

export function supportsForcedToolChoiceForRole(role: LlmRole): boolean {
  const provider = resolveLlmRoleProvider(role);
  const model = resolveLlmRoleModel(role);
  if (provider === "deepseek") {
    const m = model.toLowerCase();
    return !(m.includes("v4") || m.includes("reasoner") || m.includes("r1"));
  }
  return true;
}
