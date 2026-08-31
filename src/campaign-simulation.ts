/**
 * Simulation campagne : formatage + génération directe (sans tool calling).
 */
import type OpenAI from "openai";
import { config } from "./config.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import {
  hasTemplatePlaceholders,
  stripOutboundMessageDecorations,
} from "./outbound-sanitize.js";
import {
  extractAssistantContent,
  llmExtrasForProvider,
  recommendedMaxTokensForProvider,
  resolveLlmRoleModel,
  resolveLlmRoleProvider,
} from "./llm.js";
import { resolveReplyTone, toneLabel } from "./reply-tone.js";
import {
  sanitizeSimInput,
  turnsContainPhoneDump,
  turnLooksVagueAfterYes,
} from "./simulation-sanitize.js";

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
    const text = stripOutboundMessageDecorations(String(turn.text ?? ""));
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
    const text = stripOutboundMessageDecorations(String(t.text ?? ""));
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

  // Tentative : extraire un objet JSON imbriqué dans du texte
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
    const text = stripOutboundMessageDecorations(m[2]);
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

function normalizeOpenerCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!…,:;«»"'"]/g, "")
    .trim();
}

/** Le modèle colle souvent présentation/pitch au tour 1 — on ancre sur l'accroche validée. */
export function clampSimulationOpenerTurn(
  turns: SimulationTurn[],
  approvedOpener: string | null | undefined,
  abVariantMessages?: string[]
): SimulationTurn[] {
  if (!turns.length || turns[0]?.speaker !== "toi") return turns;
  const candidates = [
    approvedOpener?.trim(),
    ...(abVariantMessages ?? []).map((m) => m.trim()),
  ].filter(Boolean) as string[];
  if (!candidates.length) return turns;

  const first = turns[0]!.text.trim();
  const firstNorm = normalizeOpenerCompare(first);

  for (const candidate of candidates) {
    const candNorm = normalizeOpenerCompare(candidate);
    if (!candNorm) continue;
    if (firstNorm === candNorm || firstNorm.startsWith(candNorm) || candNorm.startsWith(firstNorm)) {
      return [{ ...turns[0]!, text: candidate }, ...turns.slice(1)];
    }
  }

  // Opener court validé + pitch collé (« Bonjour… » + « Je suis Will… »)
  const anchor = candidates[0]!;
  const anchorNorm = normalizeOpenerCompare(anchor);
  if (anchorNorm && firstNorm.startsWith(anchorNorm.slice(0, Math.min(24, anchorNorm.length)))) {
    return [{ ...turns[0]!, text: anchor }, ...turns.slice(1)];
  }

  return [{ ...turns[0]!, text: anchor }, ...turns.slice(1)];
}

/**
 * Génère la simulation sans outils (JSON direct).
 */
export async function generateCampaignSimulationDirect(
  client: OpenAI,
  opts: {
    businessContext: string;
    recentTranscript: string;
    /** Accroche validée — le 1er tour « toi » doit coller à ce texte (légère reformulation OK). */
    approvedOpener?: string | null;
    /** Les 5 accroches enregistrées (rotation) — tour 1 = l'une d'elles, jamais un pitch. */
    abVariantMessages?: string[];
    /** Guide / prix / lien config (secondaire). */
    campaignBrief?: string | null;
    /** Instructions mémoire brutes — process à exécuter, non tronquées. */
    memoryInstructions?: string | null;
    memoryName?: string | null;
    /** Formalité mémoire (tu/vous). */
    memoryFormality?: "tu" | "vous" | null;
  }
): Promise<{ display: string; turns: SimulationTurn[] } | null> {
  const tone = resolveReplyTone({
    sentMessages: [opts.approvedOpener],
    memoryFormality: opts.memoryFormality,
    campaignTexts: [opts.campaignBrief, opts.businessContext, opts.memoryInstructions],
  });
  const toneLbl = toneLabel(tone);
  const variantHint =
    (opts.abVariantMessages ?? []).filter(Boolean).slice(0, 5).join(" » | « ") || null;
  const openerRule = opts.approvedOpener?.trim()
    ? `- Tour 1 « toi » = UNIQUEMENT l'accroche Attention validée (1 phrase, ${toneLbl}) : « ${opts.approvedOpener.trim().slice(0, 400)} »` +
      (variantHint ? ` (rotation parmi : « ${variantHint} »)` : "") +
      `. INTERDIT sur ce tour : prénom/nom, « je suis », bio, offre, prix, lien, pitch. Présentation = tour 3+ après réponse prospect.\n`
    : `- Le 1er message « toi » = accroche courte (format Attention recommandé, ${toneLbl}, sans prénom du prospect).\n`;

  const memoryBody = (opts.memoryInstructions ?? "").trim();
  const memorySection = memoryBody
    ? `\n## MÉMOIRE CAMPAGNE (SCRIPT PRIORITAIRE — « ${opts.memoryName || "Mémoire"} »)\n${memoryBody}\n`
    : "";
  const brief = opts.campaignBrief?.trim()
    ? `\n## Cadre config (secondaire si conflit → mémoire gagne)\n${opts.campaignBrief.trim().slice(0, 1800)}\n`
    : "";

  const system =
    "Tu rédiges une simulation WhatsApp courte pour valider une campagne Klanvio.\n" +
    "Cette simulation SERA la trajectoire suivie avec les VRAIS prospects.\n" +
    "Réponds UNIQUEMENT avec un JSON valide :\n" +
    '{"turns":[{"speaker":"toi","text":"..."},{"speaker":"prospect","name":"Prospect","text":"..."},{"speaker":"toi","text":"..."}]}\n' +
    "\n## PROCESS MÉMOIRE (prioritaire sur A.I.D.A. générique)\n" +
    "La mémoire = l'ordre des étapes de CETTE campagne (variable d'une offre à l'autre).\n" +
    "- Chaque « oui » du prospect = avancer d'UNE étape précise (ex. présenter l'offre, puis inscription, puis lien).\n" +
    "- DIRECT et précis. Varie les formulations, pas le process.\n" +
    "- INTERDIT : « comment préférez-vous finaliser », tourner en rond, dump de numéros.\n" +
    "- INTERDIT ABSOLU de recoller une liste de contacts / téléphones. Ça n'est JAMAIS un message prospect.\n" +
    "- A.I.D.A. = secours seulement si la mémoire est silencieuse sur une étape.\n" +
    "\n## Format\n" +
    "- Exactement 6 ou 7 turns\n" +
    "- Alternance toi / prospect (commencer par toi)\n" +
    openerRule +
    `- Les tours suivants : même pacing / mission ; ${toneLbl} ; pas le prénom du prospect à tout va\n` +
    "- Textes réels, 1-2 phrases, sans crochets [ ], sans liste de numéros\n" +
    "- Aucune phrase hors JSON";

  const user =
    memorySection +
    brief +
    `## Contexte business (secondaire)\n${sanitizeSimInput(opts.businessContext, 1800)}\n` +
    `\n## Fil agence (contexte seulement — NE PAS recopier listes / numéros)\n${sanitizeSimInput(opts.recentTranscript, 2000)}\n\n` +
    `Génère la simulation JSON (6 ou 7 turns). Exécute le process mémoire. Zéro numéro de téléphone dans les tours « toi ».`;

  const turns = await runSimCompletion(client, system, user, 0.4);
  if (!turns) return null;

  const needsRepair =
    turnsContainPhoneDump(turns) ||
    turns.some(
      (t, i) =>
        t.speaker === "toi" &&
        i > 0 &&
        turns[i - 1]?.speaker === "prospect" &&
        /^(oui|ouais|ok)\b/i.test(turns[i - 1]!.text.trim()) &&
        turnLooksVagueAfterYes(t.text)
    );

  let finalTurns = clampSimulationOpenerTurn(
    turns,
    opts.approvedOpener,
    opts.abVariantMessages
  );
  if (needsRepair) {
    console.warn("[simulation] sanitizing / repairing dump or vague-after-yes");
    const repaired = await runSimCompletion(
      client,
      system,
      user +
        "\n\nCORRECTION : la simulation précédente collait une liste ou une phrase vague. " +
        "Régénère SANS aucun numéro de téléphone, en exécutant la prochaine étape MÉMOIRE après chaque oui.",
      0.25
    );
    if (repaired && !turnsContainPhoneDump(repaired)) {
      finalTurns = clampSimulationOpenerTurn(
        repaired,
        opts.approvedOpener,
        opts.abVariantMessages
      );
    } else {
      finalTurns = clampSimulationOpenerTurn(
        turns.filter((t) => !turnsContainPhoneDump([t])),
        opts.approvedOpener,
        opts.abVariantMessages
      );
      if (finalTurns.length < 3) return null;
    }
  }

  try {
    return { display: formatCampaignSimulationDisplay(finalTurns), turns: finalTurns };
  } catch (err) {
    console.warn("[simulation] format failed:", err);
    return null;
  }
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
