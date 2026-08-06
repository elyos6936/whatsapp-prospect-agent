/**
 * Module Support client — isolé de la prospection.
 * Brief, extraction déclencheurs/handoff, simulation inbound, nudges agent.
 * Ne pas importer depuis le chemin « 5 variantes / opener » prospection.
 */
import type OpenAI from "openai";
import type { AgentMessage } from "./db.js";
import type { BriefingAssessment } from "./campaign-briefing.js";
import {
  formatCampaignSimulationDisplay,
  type SimulationTurn,
} from "./campaign-simulation.js";
import { config } from "./config.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import {
  extractAssistantContent,
  llmExtrasForProvider,
  recommendedMaxTokensForProvider,
  resolveLlmRoleModel,
  resolveLlmRoleProvider,
} from "./llm.js";

/** Contexte système injecté UNIQUEMENT sur fil purpose=support. */
export const SUPPORT_FIL_SYSTEM_ADDENDUM = `## MODULE SUPPORT CLIENT (prioritaire sur toute consigne prospection)
- Le client écrit en premier. INTERDIT : accroche sortante, 5 variantes, « premier message de contact », A.I.D.A. Attention.
- create_automation = type keyword_sales + mode inbound_closing uniquement.
- Portée : phrases déclencheurs (guillemets) OU « tous les messages » (inbound_catch_all).
- Après stickers + notif tiers + handoff : demande « crée le brouillon » / « je valide » — le serveur crée le brouillon (tu n'as PAS besoin d'appeler create_automation avec des args MiniMax).
- Simulation = le client démarre (pas toi). Activation = « active » après sim, ou « lance sans simulation ».
- INTERDIT de parler d'accroches / rotation / group_prospect / contact_prospect.`;

/**
 * Phrases déclencheurs : guillemets + listes près de « déclencheur ».
 */
export function extractSupportTriggerPhrases(history: AgentMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const inner = raw.replace(/\s+/g, " ").trim();
    if (inner.length < 2 || inner.length > 100) return;
    if (/\?$/.test(inner) && inner.length > 40) return;
    const key = inner.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(inner);
  };

  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const quotes = m.content.match(/[«"]([^»"]{2,100})[»"]/g) || [];
    for (const q of quotes) push(q.replace(/^[«"]|[»"]$/g, ""));
  }

  // User : « déclencheurs : intéressé, je veux commander »
  for (const m of history) {
    if (m.role !== "user") continue;
    const block =
      /d[eé]clencheur[s]?\s*[:\-–]\s*([^\n]+)/i.exec(m.content) ||
      /phrases?\s*(exactes?|d[eé]clencheur[s]?)?\s*[:\-–]\s*([^\n]+)/i.exec(m.content) ||
      /quand\s+(?:quelqu.?un|un\s+client|il|elle)\s+[eé]crit\s*[:\-–]?\s*([^\n]+)/i.exec(
        m.content
      );
    const list = block?.[1] || block?.[2];
    if (!list) continue;
    for (const part of list.split(/[,;|/]| et /i)) {
      push(part.replace(/^[«"'\s]+|[»"'\s.]+$/g, ""));
    }
  }

  // Puces user après qu'on a parlé de déclencheur
  const blob = history.map((h) => h.content).join("\n");
  if (/d[eé]clencheur|mot[- ]?cl[eé]|phrase\s+exacte/i.test(blob)) {
    for (const m of history) {
      if (m.role !== "user") continue;
      const lines = m.content.split(/\n+/);
      for (const line of lines) {
        const bullet = /^\s*[-*•\d]+[.)]\s*(.+)$/.exec(line.trim());
        if (bullet?.[1]) push(bullet[1].replace(/^[«"]|[»"]$/g, ""));
      }
    }
  }

  return found.slice(0, 12);
}

/** Mots-clés handoff cités par l'utilisateur (après question handoff). */
export function extractSupportHandoffKeywords(history: AgentMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const inner = raw.replace(/\s+/g, " ").trim();
    if (inner.length < 2 || inner.length > 80) return;
    if (/^(non|nan|aucun|pas\s+besoin|rien)$/i.test(inner)) return;
    const key = inner.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(inner);
  };

  let afterHandoffQ = false;
  for (const m of history) {
    if (
      m.role === "assistant" &&
      /\b(passer\s+la\s+main|handoff|mots?\s*cl[eé]|humain)\b/i.test(m.content)
    ) {
      afterHandoffQ = true;
      continue;
    }
    if (!afterHandoffQ || m.role !== "user") continue;
    if (/^(non|nan|aucun|pas\s+besoin|rien)\b/i.test(m.content.trim())) {
      return [];
    }
    const quotes = m.content.match(/[«"]([^»"]{2,80})[»"]/g) || [];
    for (const q of quotes) push(q.replace(/^[«"]|[»"]$/g, ""));
    for (const part of m.content.split(/[,;|/]| et /i)) {
      const cleaned = part.replace(/^[«"'\s]+|[»"'\s.]+$/g, "").trim();
      if (
        cleaned.length >= 3 &&
        cleaned.length <= 40 &&
        !/^(oui|ok|voici|les|mots)/i.test(cleaned)
      ) {
        push(cleaned);
      }
    }
  }
  return found.slice(0, 12);
}

/**
 * Nudges Support uniquement — jamais d'opener / 5 variantes.
 */
export function buildSupportBriefingNudge(
  assessment: BriefingAssessment,
  _history: AgentMessage[],
  _userMessage: string
): string | null {
  if (!assessment.inCampaignFlow || !assessment.isInboundClosing) return null;

  if (assessment.readyForDraft) {
    if (!assessment.stickersQuestionAsked) {
      return (
        "Briefing SUPPORT : éléments essentiels réunis. " +
        "Pose UNE question — « Tu veux des stickers dans les réponses aux clients ? (oui/non) » — puis ARRÊTE-TOI. " +
        "INTERDIT : accroches, 5 variantes, create_automation dans ce message."
      );
    }
    if (!assessment.thirdPartyQuestionAsked) {
      return (
        "Briefing SUPPORT : pose UNE question — « Quand un client convertit / objectif atteint, tu veux qu'on prévienne automatiquement un tiers (livreur, associé…) sur WhatsApp ? (oui/non) ». " +
        "Si oui : numéro + rôle (une question à la fois). INTERDIT create_automation tant que ce n'est pas couvert."
      );
    }
    if (!assessment.handoffKeywordsQuestionAsked) {
      return (
        "Briefing SUPPORT : pose UNE question — « Y a-t-il des mots/phrases pour lesquels je dois arrêter et te passer la main " +
        "(ex. remboursement, plainte) ? Liste-les ou dis non. » Puis ARRÊTE-TOI."
      );
    }

    if (assessment.inboundCatchAll) {
      return (
        "SUPPORT prêt (compte entier). " +
        "Demande à l'utilisateur de répondre **« je valide »** ou **« crée le brouillon »** — le serveur enregistre keyword_sales + inbound_catch_all=true puis propose la simulation. " +
        "INTERDIT : 5 variantes, accroche sortante, inventer un fil Toi→ sans tool serveur. " +
        "Explique : l'IA répondra à tout message privé (hors groupes), sauf STOP / handoff."
      );
    }
    return (
      "SUPPORT prêt (phrases déclencheurs). " +
      "Demande **« je valide »** / **« crée le brouillon »** — le serveur crée keyword_sales + trigger_phrases + handoff_keywords, " +
      "puis simulation où le **client écrit en premier**. " +
      "INTERDIT : 5 variantes d'opener, contact_prospect, group_prospect."
    );
  }

  const next = assessment.missing[0] ?? "un détail concret encore flou";
  const q = assessment.questionsAsked;
  if (next.includes("déclencheur") || next.includes("tous les messages")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : il manque la **portée**. ` +
      `Pose UNE question : « Tu veux des **phrases déclencheurs** exactes (ex. « je suis intéressé »), ` +
      `ou que je gère **tous les messages privés** du compte ? »`
    );
  }
  if (next.includes("offre")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : pose UNE question ouverte — ` +
      `« Quel produit / service dois-je défendre dans les réponses clients ? »`
    );
  }
  if (next.includes("présentation") || next.includes("identité")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : pose UNE question — ` +
      `comment te présenter si un client demande « qui êtes-vous ? » (prénom + formule courte).`
    );
  }
  if (next.includes("objectif")) {
    return (
      `Briefing SUPPORT (${q} question(s)) : pose UNE question — ` +
      `quel objectif quand le client est prêt (lien, paiement, RDV, livraison…) ?`
    );
  }
  return (
    `## Briefing SUPPORT EN COURS\n` +
    `Il manque encore : **${next}**. Pose UNE seule question courte. ` +
    `INTERDIT : accroche sortante, 5 variantes, simuler avant brouillon, basculer en prospection.`
  );
}

/**
 * Simulation inbound : le client démarre (pas l'agent).
 * Même stack Claude/filet que la sim prospection (client OpenAI passé en arg).
 */
export async function generateSupportSimulationDirect(
  client: OpenAI,
  opts: {
    businessContext: string;
    recentTranscript: string;
    campaignBrief?: string | null;
    triggerPhrases?: string[];
    catchAll?: boolean;
  }
): Promise<{ display: string; turns: SimulationTurn[] } | null> {
  const triggers = (opts.triggerPhrases || []).filter(Boolean);
  const startRule = opts.catchAll
    ? `- Le 1er turn DOIT être speaker=prospect (client qui écrit en premier : bonjour / question produit).\n`
    : triggers.length
      ? `- Le 1er turn DOIT être speaker=prospect avec un message qui MATCH un déclencheur (ex. « ${triggers[0]} » ou proche).\n`
      : `- Le 1er turn DOIT être speaker=prospect (le client écrit en premier).\n`;

  const brief = opts.campaignBrief?.trim()
    ? `\n## Cadre support\n${opts.campaignBrief.trim().slice(0, 2800)}\n`
    : "";

  const system =
    "Tu rédiges une simulation WhatsApp SUPPORT CLIENT (closing entrant) pour Klanvio.\n" +
    "Le CLIENT écrit en premier — ce n'est PAS de la prospection sortante.\n" +
    "Réponds UNIQUEMENT avec un JSON :\n" +
    '{"turns":[{"speaker":"prospect","name":"Client","text":"..."},{"speaker":"toi","text":"..."}]}\n' +
    "Règles :\n" +
    "- Exactement 6 ou 7 turns\n" +
    "- Alternance prospect / toi en commençant par prospect\n" +
    startRule +
    "- « toi » = réponses support utiles (pas d'opener cold, pas de « je vous contacte pour… »)\n" +
    "- Vouvoiement, textes naturels, sans crochets [ ]\n" +
    "- Prix / lien seulement si le client engage et si présents dans le cadre\n" +
    "- Aucune phrase hors JSON";

  const user =
    `## Contexte business\n${opts.businessContext.slice(0, 3500)}\n` +
    brief +
    `\n## Fil agence\n${opts.recentTranscript.slice(0, 4000)}\n\n` +
    `Génère la simulation JSON support (client d'abord).`;

  const simRole = config.toolLlmConfigured ? "tools" : "chat";
  const simProvider = resolveLlmRoleProvider(simRole);
  const simModel = resolveLlmRoleModel(simRole);
  const body: Record<string, unknown> = {
    model: simModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: recommendedMaxTokensForProvider(simProvider, simModel, 900, {
      thinkingEnabled: false,
    }),
    temperature: 0.7,
    ...llmExtrasForProvider(simProvider, simModel, { enableThinking: false }),
  };

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    )
  );

  const content = extractAssistantContent(response.choices[0]?.message);
  const turns = parseSupportTurns(content);
  if (!turns) {
    console.warn("[support-sim] parse failed, raw:", content.slice(0, 400));
    return null;
  }

  try {
    return { display: formatCampaignSimulationDisplay(turns), turns };
  } catch (err) {
    console.warn("[support-sim] format failed:", err);
    return null;
  }
}

function parseSupportTurns(content: string): SimulationTurn[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const jsonCandidate = (fence?.[1] || trimmed).trim();
  try {
    const parsed = JSON.parse(jsonCandidate) as { turns?: unknown[] } | unknown[];
    const raw = Array.isArray(parsed) ? parsed : parsed.turns;
    if (!Array.isArray(raw) || raw.length < 3) return null;
    const out: SimulationTurn[] = [];
    for (const item of raw.slice(0, 7)) {
      if (!item || typeof item !== "object") return null;
      const t = item as { speaker?: string; name?: string; text?: string };
      const speaker = String(t.speaker ?? "").toLowerCase();
      const text = String(t.text ?? "").trim();
      if (!text) return null;
      if (speaker === "toi" || speaker === "moi" || speaker === "you" || speaker === "agent") {
        out.push({ speaker: "toi", text });
      } else {
        out.push({
          speaker: "prospect",
          name: t.name || "Client",
          text,
        });
      }
    }
    // Doit commencer par le client
    if (out[0]?.speaker !== "prospect") return null;
    return out.length >= 3 ? out : null;
  } catch {
    return null;
  }
}
