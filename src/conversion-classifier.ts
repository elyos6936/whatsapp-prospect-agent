import type OpenAI from "openai";
import { config } from "./config.js";
import {
  findMatchingAutomationTarget,
  getAppSettings,
  getAutomation,
  getContact,
  getContactChatHistory,
  listAutomations,
  type Automation,
  type WhatsAppMessage,
} from "./db.js";
import { createLlmClient, deepseekChatExtras, extractAssistantContent, recommendedMaxTokens } from "./llm.js";
import { callOpenAiWithRetry } from "./openai-retry.js";

export type ConversionConfidence = "high" | "low";

export interface ConversionVerdict {
  reached: boolean;
  confidence: ConversionConfidence;
}

const CLASSIFIER_TIMEOUT_MS = 8_000;

/** Mots / expressions qui justifient d'appeler le classifier (préfiltre local). */
const CANDIDATE_RE =
  /\b(ok|okay|oui|ouais|d['']accord|dac|parfait|super|impeccable|nickel|top|merci|partant|volontiers|allons[- ]y|c['']est (bon|not[eé]|fait|commande)|j['']ai |je (suis|veux|valide|confirme|prends|reserve|r[eé]serve)|lien |rdv|rendez[- ]vous|pay[eé]|paiement|commande|cliqu[eé]|reserv[eé]|r[eé]serv[eé]|transfert|re[cç]u)\b/i;

/** Accusé de réception court — ne déclenche le LLM que si l'agent vient d'offrir une action. */
const SHORT_ACK_RE = /^(ok|okay|oui|ouais|d['']accord|dac|parfait|super|merci|top|nickel|impeccable|c['']est bon)[\s!.?]*$/i;

/** L'agent a proposé lien / prix / créneau / RDV juste avant. */
const ACTION_OFFERED_RE =
  /https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/|fcfa|prix|payer|paiement|cr[eé]neau|calendly|lien|rendez[- ]vous|\brdv\b|r[eé]serv/i;

export const CONVERSION_CLASSIFIER_SYSTEM_PROMPT = `Tu es un classificateur strict pour une campagne WhatsApp commerciale (Afrique francophone).

Ta seule tâche : décider si l'OBJECTIF DE LA CAMPAGNE est réellement ATTEINT dans cet échange, d'après l'historique + le dernier message du prospect.

Règles (non négociables) :
1. "reached"=true UNIQUEMENT si le prospect confirme sans ambiguïté que l'action objectif est faite OU acceptée de façon définitive (ex. a payé, a commandé, a cliqué/rejoint le lien, a pris/confirmé le RDV, accepte clairement après qu'on lui a proposé l'action concrète).
2. Un "ok", "d'accord", "merci", "oui" isolé ou de politesse → reached=false, confidence="low" SAUF si le message agent juste avant proposait clairement l'action objectif (lien/prix/RDV) ET la confirmation ne laisse aucun doute.
3. Intérêt ("ça m'intéresse", "je suis partant" AVANT qu'un lien/créneau/paiement ait été proposé) → pas encore atteint (reached=false).
4. En cas de DOUTE → reached=false, confidence="low". Préfère un faux négatif à un faux positif qui coupe la conversation.
5. confidence="high" seulement si tu es sûr à >90%. Sinon "low".

Réponds UNIQUEMENT avec un JSON compact, sans markdown :
{"reached":true|false,"confidence":"high"|"low"}`;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "'")
    .trim();
}

/** Préfiltre local — évite un appel LLM sur chaque message. */
export function shouldRunConversionClassifier(
  incomingText: string,
  recentHistory: Pick<WhatsAppMessage, "direction" | "body">[]
): boolean {
  const t = normalizeText(incomingText);
  if (!t || t.startsWith("[")) return false;
  if (CANDIDATE_RE.test(t)) return true;

  const lastOut = [...recentHistory].reverse().find((m) => m.direction === "sortant");
  if (lastOut && ACTION_OFFERED_RE.test(lastOut.body) && SHORT_ACK_RE.test(t)) {
    return true;
  }
  return false;
}

function goalDescription(auto: Automation): string {
  const cfg = auto.config;
  const labels: Record<string, string> = {
    payment: "obtenir le paiement (preuve / confirmation de paiement)",
    delivery: "organiser / confirmer la livraison",
    link: "faire cliquer / rejoindre / utiliser le lien fourni",
    appointment: "fixer ou confirmer un rendez-vous / créneau",
  };
  const goal = cfg.closingGoal
    ? labels[cfg.closingGoal] ?? cfg.closingGoal
    : "amener le prospect à l'action concrète de la campagne";
  const extras = [
    cfg.productName ? `Offre : ${cfg.productName}` : "",
    cfg.price ? `Prix : ${cfg.price}` : "",
    cfg.closingLink ? `Lien campagne : ${cfg.closingLink}` : "",
  ].filter(Boolean);
  return [`Objectif (closingGoal) : ${goal}`, ...extras].join("\n");
}

function parseVerdict(raw: string): ConversionVerdict {
  const fallback: ConversionVerdict = { reached: false, confidence: "low" };
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallback;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      reached?: unknown;
      confidence?: unknown;
    };
    const reached = parsed.reached === true;
    const confidence: ConversionConfidence =
      parsed.confidence === "high" ? "high" : "low";
    // Filet de sécurité : reached sans high → on n'agit pas
    if (reached && confidence !== "high") {
      return { reached: false, confidence: "low" };
    }
    return { reached, confidence };
  } catch {
    return fallback;
  }
}

/**
 * Jugement LLM contextuel. En cas d'erreur / timeout / doute → pas de clôture.
 */
export async function classifyObjectiveReached(
  userId: number,
  input: {
    chatId: string;
    senderName: string;
    incomingText: string;
    campaign: Automation;
    history?: WhatsAppMessage[];
  }
): Promise<ConversionVerdict> {
  const safe: ConversionVerdict = { reached: false, confidence: "low" };

  try {
    const history =
      input.history ??
      (await getContactChatHistory(userId, input.chatId, 20, input.campaign.id));

    if (!shouldRunConversionClassifier(input.incomingText, history)) {
      return safe;
    }

    const key = (await getAppSettings(userId)).openai_api_key;
    if (!key) return safe;

    const transcript = history
      .map((m) => {
        const who = m.direction === "entrant" ? input.senderName : "Agent";
        return `${who}: ${m.body}`;
      })
      .join("\n");

    const userContent = `## Campagne
Nom : ${input.campaign.name}
Statut campagne : ${input.campaign.status}
${goalDescription(input.campaign)}

## Historique (campagne)
${transcript || "(vide)"}

## Dernier message du prospect
${input.senderName}: ${input.incomingText}

L'objectif est-il atteint maintenant ? JSON uniquement.`;

    const client = createLlmClient(key);
    const work = callOpenAiWithRetry(() =>
      client.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: "system", content: CONVERSION_CLASSIFIER_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        max_tokens: recommendedMaxTokens(config.openaiModel, 60, { thinkingEnabled: false }),
        temperature: 0.1,
        ...deepseekChatExtras({ enableThinking: false }),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
    );

    const timed = await Promise.race([
      work,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), CLASSIFIER_TIMEOUT_MS)
      ),
    ]);

    if (!timed) {
      console.warn("⏳ Classifier objectif : timeout — pas de clôture");
      return safe;
    }

    const raw = extractAssistantContent(timed.choices[0]?.message);
    if (!raw) return safe;
    return parseVerdict(raw);
  } catch (err) {
    console.error("Classifier objectif — erreur (continue sans clôturer):", err);
    return safe;
  }
}

/**
 * Campagne liée au contact mais non active (pausée / terminée), pour alerte conversion manquée.
 */
export async function findLinkedInactiveCampaign(
  userId: number,
  chatId: string
): Promise<Automation | null> {
  try {
    const contact = await getContact(userId, chatId);
    const preferredId =
      contact?.conversation_campaign_id != null
        ? Number(contact.conversation_campaign_id)
        : NaN;

    if (Number.isFinite(preferredId)) {
      const auto = await getAutomation(userId, preferredId);
      if (auto && auto.status !== "active") return auto;
    }

    const autos = await listAutomations(userId, { limit: 80 });
    let best: Automation | null = null;
    let bestAt = 0;
    for (const auto of autos) {
      if (auto.status === "active") continue;
      const target = await findMatchingAutomationTarget(userId, auto.id, chatId, [
        "interested",
        "replied",
        "contacted",
      ]);
      if (!target) continue;
      const at = target.last_action_at ? Date.parse(target.last_action_at) : 0;
      if (!best || at >= bestAt) {
        best = auto;
        bestAt = at;
      }
    }
    return best;
  } catch {
    return null;
  }
}
