/**
 * Simulation campagne : formatage + génération directe (sans tool calling).
 * Fidélité mémoire = process prioritaire (variable par campagne).
 */
import type OpenAI from "openai";
import { config } from "./config.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { hasTemplatePlaceholders } from "./outbound-sanitize.js";
import {
  extractAssistantContent,
  llmExtrasForProvider,
  recommendedMaxTokensForProvider,
  resolveLlmRoleModel,
  resolveLlmRoleProvider,
} from "./llm.js";
import {
  assessSimulationMemoryFidelity,
  extractUrlsFromText,
} from "./simulation-memory-fidelity.js";

export type SimulationTurn = {
  speaker: "toi" | "prospect";
  name?: string;
  text: string;
};

const SIM_CHAT_FOOTER =
  "\n\nSimulation affichée sur le **téléphone à droite**. " +
  "Dis-moi ce qui te convient, ce qu'il faut changer, ou « c'est bon » pour activer.";

/**
 * Payload machine pour le téléphone (fence masquée dans le chat) + phrase courte visible.
 */
export function formatCampaignSimulationDisplay(
  turns: SimulationTurn[],
  opts?: { counterpartLabel?: string }
): string {
  const counterpart = (opts?.counterpartLabel || "Prospect").trim() || "Prospect";
  const limited = turns.slice(0, 7);
  if (limited.length < 3) {
    throw new Error("La simulation doit contenir au moins 3 messages.");
  }
  const lines: string[] = [];
  for (const turn of limited) {
    const text = String(turn.text ?? "").trim();
    if (!text) throw new Error("Un message de la simulation est vide.");
    if (hasTemplatePlaceholders(text)) {
      throw new Error("Crochets [ ] interdits dans la simulation.");
    }
    if (turn.speaker === "toi") {
      lines.push(`Toi → « ${text} »`);
    } else {
      const name = String(turn.name ?? counterpart).trim() || counterpart;
      lines.push(`${name} → « ${text} »`);
    }
  }
  return "```klanvio-sim\n" + lines.join("\n") + "\n```" + SIM_CHAT_FOOTER;
}

function normalizeTurns(raw: unknown[]): SimulationTurn[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const slice = raw.slice(0, 7);
  const out: SimulationTurn[] = [];
  for (const item of slice) {
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
  return out.length >= 3 ? out : null;
}

function parseTurnsFromModelText(content: string): SimulationTurn[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

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

  const brace = /\{[\s\S]*"turns"\s*:\s*\[[\s\S]*\][\s\S]*\}/.exec(trimmed);
  if (brace) {
    try {
      const parsed = JSON.parse(brace[0]) as { turns?: unknown[] };
      const normalized = normalizeTurns(parsed.turns ?? []);
      if (normalized) return normalized;
    } catch {
      /* continue */
    }
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
    if (turns.length >= 4) break;
  }
  return turns.length >= 3 && turns.length <= 4 ? turns : null;
}

async function runSimCompletion(
  client: OpenAI,
  system: string,
  user: string,
  temperature: number
): Promise<SimulationTurn[] | null> {
  const simRole = config.toolLlmConfigured ? "tools" : "chat";
  const simProvider = resolveLlmRoleProvider(simRole);
  const simModel = resolveLlmRoleModel(simRole);
  const body: Record<string, unknown> = {
    model: simModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: recommendedMaxTokensForProvider(simProvider, simModel, 1100, {
      thinkingEnabled: false,
    }),
    temperature,
    ...llmExtrasForProvider(simProvider, simModel, { enableThinking: false }),
  };

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    )
  );

  const content = extractAssistantContent(response.choices[0]?.message);
  const turns = parseTurnsFromModelText(content);
  if (!turns) {
    console.warn("[simulation] parse failed, raw:", content.slice(0, 400));
  }
  return turns;
}

function buildOutboundSimSystem(opts: {
  approvedOpener?: string | null;
  memoryInstructions?: string | null;
}): string {
  const openerRule = opts.approvedOpener?.trim()
    ? `- Le 1er message « toi » DOIT reprendre (presque mot pour mot) cette accroche validée : « ${opts.approvedOpener.trim().slice(0, 400)} » — micro-variation OK, PAS de nouvel angle.\n`
    : `- Le 1er message « toi » = accroche courte (format Attention recommandé si la mémoire ne dicte pas autrement).\n`;

  const mem = (opts.memoryInstructions ?? "").trim();
  const urls = extractUrlsFromText(mem);

  return (
    "Tu rédiges une simulation WhatsApp courte pour valider une campagne Klanvio.\n" +
    "Cette simulation SERA la trajectoire suivie avec les VRAIS prospects.\n" +
    "Réponds UNIQUEMENT avec un JSON valide :\n" +
    '{"turns":[{"speaker":"toi","text":"..."},{"speaker":"prospect","name":"Prospect","text":"..."},{"speaker":"toi","text":"..."}]}\n' +
    "\n## PRIORITÉ ABSOLUE — MÉMOIRE / PROCESS CAMPAGNE\n" +
    "La mémoire (bloc ci-dessous) = SCRIPT D'EXÉCUTION. Elle varie d'une campagne à l'autre.\n" +
    "- Suis l'ORDRE des étapes mémoire (ex. oui → présenter l'offre → demander inscription → puis lien).\n" +
    "- Chaque réponse « oui/ok » du prospect = avancer d'UNE étape précise du process — jamais une phrase vague.\n" +
    "- Sois DIRECT, FIDÈLE et PRÉCIS. Légèrement créatif sur les formulations seulement.\n" +
    "- INTERDIT : « comment préférez-vous finaliser », « on avance avec vous », tourner en rond.\n" +
    "- A.I.D.A. générique = SECOURS seulement si la mémoire est silencieuse sur une étape.\n" +
    (urls.length
      ? `- Liens mémoire à coller au BON moment du process (pas trop tôt) : ${urls.join(" ")}\n`
      : "") +
    "\n## Format\n" +
    "- Exactement 6 ou 7 turns (JAMAIS plus)\n" +
    "- Alternance toi / prospect (commencer par toi)\n" +
    openerRule +
    "- Textes réels, naturels, sans crochets [ ]\n" +
    "- Aucune phrase hors JSON"
  );
}

/**
 * Génère la simulation sans outils (JSON direct), fidèle à la mémoire campagne.
 */
export async function generateCampaignSimulationDirect(
  client: OpenAI,
  opts: {
    businessContext: string;
    recentTranscript: string;
    /** Accroche validée — le 1er tour « toi » doit coller à ce texte (légère reformulation OK). */
    approvedOpener?: string | null;
    /**
     * Brief campagne (guide/config). Peut inclure la mémoire ; préférer aussi memoryInstructions
     * pour le contrôle de fidélité et le budget dédié.
     */
    campaignBrief?: string | null;
    /** Instructions mémoire brutes (source de vérité process). */
    memoryInstructions?: string | null;
    memoryName?: string | null;
  }
): Promise<{ display: string; turns: SimulationTurn[] } | null> {
  const memoryInstructions = (opts.memoryInstructions ?? "").trim();
  // Si seule campaignBrief contient déjà le bloc mémoire, on s'en sert pour le check
  const fidelitySource =
    memoryInstructions ||
    (opts.campaignBrief?.includes("MÉMOIRE CAMPAGNE")
      ? opts.campaignBrief
      : opts.campaignBrief) ||
    "";

  const system = buildOutboundSimSystem({
    approvedOpener: opts.approvedOpener,
    memoryInstructions: memoryInstructions || fidelitySource,
  });

  // Mémoire en premier, non tronquée ; business / transcript ensuite (tronqués)
  const memorySection = memoryInstructions
    ? `\n## MÉMOIRE CAMPAGNE (SCRIPT — PRIORITAIRE)\n« ${opts.memoryName || "Mémoire"} »\n${memoryInstructions}\n`
    : "";
  const briefSection = opts.campaignBrief?.trim()
    ? `\n## Cadre campagne (secondaire si conflit avec la mémoire)\n${opts.campaignBrief.trim().slice(0, 2000)}\n`
    : "";

  const user =
    memorySection +
    briefSection +
    `## Contexte business (secondaire)\n${opts.businessContext.slice(0, 2000)}\n` +
    `\n## Fil récent (agence)\n${opts.recentTranscript.slice(0, 2500)}\n\n` +
    `Génère maintenant la simulation JSON (6 ou 7 turns). Exécute le process mémoire étape par étape.`;

  let turns = await runSimCompletion(client, system, user, 0.4);
  if (!turns) return null;

  const firstCheck = assessSimulationMemoryFidelity(turns, fidelitySource);
  if (!firstCheck.ok && firstCheck.repairHint) {
    console.warn(
      "[simulation] fidelity issues:",
      firstCheck.issues.map((i) => i.code).join(", ")
    );
    const repairUser =
      user +
      `\n\n## CORRECTION OBLIGATOIRE\nLa simulation précédente violait la mémoire :\n` +
      JSON.stringify(turns, null, 0).slice(0, 2500) +
      `\n\n${firstCheck.repairHint}\n` +
      `Régénère TOUTE la simulation JSON corrigée (6-7 turns), fidèle au process mémoire.`;
    const repaired = await runSimCompletion(client, system, repairUser, 0.25);
    if (repaired) {
      const second = assessSimulationMemoryFidelity(repaired, fidelitySource);
      if (second.ok || second.issues.length <= firstCheck.issues.length) {
        turns = repaired;
      }
    }
  }

  try {
    return { display: formatCampaignSimulationDisplay(turns), turns };
  } catch (err) {
    console.warn("[simulation] format failed:", err);
    return null;
  }
}
