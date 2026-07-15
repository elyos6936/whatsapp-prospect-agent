/**
 * Simulation campagne : formatage + génération directe (sans tool_choice).
 * DeepSeek v4 thinking refuse tool_choice forcé → on génère hors boucle outils.
 */
import type OpenAI from "openai";
import { config } from "./config.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { hasTemplatePlaceholders } from "./outbound-sanitize.js";
import { isThinkingModel, recommendedMaxTokens } from "./llm.js";

export type SimulationTurn = {
  speaker: "toi" | "prospect";
  name?: string;
  text: string;
};

const SIM_FOOTER =
  "\n\n---\n" +
  "*(Simulation courte — 3 à 4 messages max.)*\n\n" +
  "Dis-moi concrètement :\n" +
  "• ce qui te convient\n" +
  "• ce que tu veux changer (ton, accroche, CTA, prix, lien…)\n\n" +
  "Ou réponds « c'est bon » si on peut passer à l'activation.";

export function formatCampaignSimulationDisplay(turns: SimulationTurn[]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    const text = String(turn.text ?? "").trim();
    if (!text) throw new Error("Un message de la simulation est vide.");
    if (hasTemplatePlaceholders(text)) {
      throw new Error("Crochets [ ] interdits dans la simulation.");
    }
    if (turn.speaker === "toi") {
      lines.push(`Toi → « ${text} »`);
    } else {
      const name = String(turn.name ?? "Prospect").trim() || "Prospect";
      lines.push(`${name} → « ${text} »`);
    }
  }
  return lines.join("\n") + SIM_FOOTER;
}

function normalizeTurns(raw: unknown[]): SimulationTurn[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 4) return null;
  const out: SimulationTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const t = item as { speaker?: string; name?: string; text?: string };
    const speaker = String(t.speaker ?? "").toLowerCase();
    const text = String(t.text ?? "").trim();
    if (!text) return null;
    if (speaker === "toi" || speaker === "moi" || speaker === "you") {
      out.push({ speaker: "toi", text });
    } else if (speaker === "prospect" || speaker.length > 0) {
      out.push({
        speaker: "prospect",
        name: speaker === "prospect" ? t.name || "Prospect" : t.name || t.speaker || "Prospect",
        text,
      });
    } else {
      return null;
    }
  }
  return out;
}

function parseTurnsFromModelText(content: string): SimulationTurn[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // JSON direct ou dans un fence
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const jsonCandidate = fence?.[1]?.trim() || trimmed;
  try {
    const parsed = JSON.parse(jsonCandidate) as { turns?: unknown[] } | unknown[];
    const turns = Array.isArray(parsed) ? parsed : parsed.turns;
    const normalized = normalizeTurns(turns ?? []);
    if (normalized) return normalized;
  } catch {
    /* fall through → lignes Toi → */
  }

  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const turns: SimulationTurn[] = [];
  const turnRe = /^(.+?)\s*(?:→|->)\s*[«"“]?\s*(.+?)\s*[»"”]?\s*$/;
  for (const line of lines) {
    const m = turnRe.exec(line);
    if (!m) continue;
    const who = m[1].trim();
    const text = m[2]
      .replace(/^[«"“]\s*/, "")
      .replace(/\s*[»"”]$/, "")
      .trim();
    if (text.length < 2) continue;
    if (/^(toi|moi|vous|you)$/i.test(who)) {
      turns.push({ speaker: "toi", text });
    } else {
      turns.push({ speaker: "prospect", name: who || "Prospect", text });
    }
  }
  return turns.length >= 3 && turns.length <= 4 ? turns : null;
}

/**
 * Génère la simulation sans outils ni tool_choice (évite le 400 DeepSeek thinking).
 */
export async function generateCampaignSimulationDirect(
  client: OpenAI,
  opts: {
    businessContext: string;
    recentTranscript: string;
  }
): Promise<string | null> {
  const system =
    "Tu rédiges une simulation WhatsApp courte pour valider une campagne Klanvio.\n" +
    "Réponds UNIQUEMENT avec un JSON valide de la forme :\n" +
    '{"turns":[{"speaker":"toi","text":"..."},{"speaker":"prospect","name":"Prospect","text":"..."},{"speaker":"toi","text":"..."}]}\n' +
    "Règles strictes :\n" +
    "- Exactement 3 ou 4 turns\n" +
    "- Alternance toi / prospect\n" +
    "- Textes réels, naturels, sans crochets [ ]\n" +
    "- Inclure prix / lien s'ils sont connus dans le contexte\n" +
    "- Aucune phrase hors JSON";

  const user =
    `## Contexte business\n${opts.businessContext.slice(0, 3500)}\n\n` +
    `## Fil récent (agence)\n${opts.recentTranscript.slice(0, 4000)}\n\n` +
    `Génère maintenant la simulation JSON.`;

  const body: Record<string, unknown> = {
    model: config.openaiModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: recommendedMaxTokens(config.openaiModel, 900),
  };

  // Désactive le thinking pour cette requête isolée (pas d'outils) → plus fiable.
  if (isThinkingModel(config.openaiModel)) {
    body.thinking = { type: "disabled" };
  }

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    )
  );

  const content = response.choices[0]?.message?.content?.trim() ?? "";
  const turns = parseTurnsFromModelText(content);
  if (!turns) return null;

  try {
    return formatCampaignSimulationDisplay(turns);
  } catch {
    return null;
  }
}
