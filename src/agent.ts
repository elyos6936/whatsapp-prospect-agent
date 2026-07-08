import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import { getAppSettings, getRecentAgentMessages, type AgentMessage } from "./db.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;

function getOpenAiClient(): OpenAI {
  const key = getAppSettings().openai_api_key;
  if (!key) {
    throw new Error(
      "Clé OpenAI manquante. Ouvrez « Connexions » et renseignez votre clé API OpenAI."
    );
  }
  return new OpenAI({ apiKey: key });
}

function toOpenAiMessages(history: AgentMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function formatOpenAiError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) return "Clé API OpenAI invalide (401). Vérifiez votre clé dans Connexions.";
    if (err.status === 429) return "Limite OpenAI atteinte (429). Réessayez dans quelques secondes.";
    if (err.status === 500 || err.status === 503) {
      return "OpenAI temporairement indisponible. Réessayez dans un moment.";
    }
    return `Erreur OpenAI (${err.status}) : ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function chatWithAgent(_userMessage: string): Promise<string> {
  const client = getOpenAiClient();
  const history = getRecentAgentMessages(50);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...toOpenAiMessages(history),
  ];

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: config.openaiModel,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        max_tokens: 4096,
      });
    } catch (err) {
      throw new Error(formatOpenAiError(err));
    }

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("Réponse OpenAI vide.");
    }

    const assistantMsg = choice.message;

    if (assistantMsg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: assistantMsg.content ?? null,
        tool_calls: assistantMsg.tool_calls,
      });

      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.type !== "function") continue;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        let result: string;
        try {
          result = await executeTool(toolCall.function.name, args);
        } catch (err) {
          result = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      continue;
    }

    const text = assistantMsg.content?.trim();
    if (!text) {
      return "Je n'ai pas pu générer de réponse. Réessayez.";
    }
    return text;
  }

  return "Trop d'étapes d'exécution. Reformulez votre demande de façon plus simple.";
}
