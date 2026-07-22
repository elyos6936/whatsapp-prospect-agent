/**
 * Notification WhatsApp optionnelle à un tiers (livreur, commercial…)
 * quand l'objectif campagne est atteint.
 */
import OpenAI from "openai";
import { config } from "./config.js";
import {
  addAutomationLog,
  getAppSettings,
  getContact,
  isContactBlocked,
  type Automation,
  type AutomationConfig,
} from "./db.js";
import {
  chatIdToDisplay,
  normalizePhoneToChatId,
  sendWhatsAppMessage,
} from "./evolutionapi.js";
import {
  createLlmClient,
  deepseekChatExtras,
  extractAssistantContent,
  llmProviderLabel,
  recommendedMaxTokens,
} from "./llm.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";

/** Prompt système dédié — distinct de WHATSAPP_REPLY_PROMPT (pas de pitch commercial). */
export const THIRD_PARTY_NOTIFICATION_PROMPT = `Tu rédiges un message WhatsApp opérationnel destiné à un TIERCE PERSONNE (livreur, commercial terrain, assistant…), PAS au prospect.

## Ton
- Factuel, clair, professionnel et courtois.
- Court : 2 à 4 phrases max, style WhatsApp.
- Pas de pitch commercial, pas de vente, pas d'emoji excessifs (0 ou 1 max).
- Pas de crochets ni placeholders ([nom], [adresse], etc.).
- N'invente AUCUNE info absente des données fournies.
- Adapte le registre au rôle indiqué (ex. livreur → livraison ; commercial → prise en charge).

## Contenu
Inclus uniquement les infos utiles au destinataire parmi celles fournies : qui a converti (nom / numéro), offre ou produit, objectif atteint, et le contexte / consignes de l'opérateur.
Si une info manque, omets-la sans inventer.

## Sortie
Réponds UNIQUEMENT avec le texte du message WhatsApp, rien d'autre.`;

export type ThirdPartyNotifyFacts = {
  role: string;
  context?: string;
  prospectName: string;
  prospectPhoneDisplay: string;
  productName?: string;
  price?: string;
  closingGoal?: string;
  campaignName: string;
};

function goalLabel(goal?: string): string | undefined {
  if (!goal) return undefined;
  const map: Record<string, string> = {
    payment: "paiement / commande",
    delivery: "livraison",
    link: "lien envoyé / inscription",
    appointment: "rendez-vous",
  };
  return map[goal] ?? goal;
}

/** Message opérationnel sans LLM — filet si la génération IA échoue. */
export function buildFallbackThirdPartyMessage(facts: ThirdPartyNotifyFacts): string {
  const lines = [
    `Salut — prospect converti : ${facts.prospectName} (${facts.prospectPhoneDisplay}).`,
    `Campagne : ${facts.campaignName}.`,
  ];
  const goal = goalLabel(facts.closingGoal);
  if (goal) lines.push(`Objectif : ${goal}.`);
  if (facts.productName?.trim()) lines.push(`Offre : ${facts.productName.trim()}.`);
  if (facts.context?.trim()) lines.push(facts.context.trim());
  return lines.join("\n");
}

export async function generateThirdPartyNotificationMessage(
  userId: number,
  facts: ThirdPartyNotifyFacts
): Promise<string> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) throw new Error(`Clé ${llmProviderLabel()} manquante.`);
  const client = createLlmClient(key);

  const lines = [
    `Rôle du destinataire : ${facts.role || "tiers opérationnel"}`,
    facts.context?.trim() ? `Consignes opérateur : ${facts.context.trim()}` : null,
    `Campagne : ${facts.campaignName}`,
    `Prospect converti : ${facts.prospectName} (${facts.prospectPhoneDisplay})`,
    facts.productName ? `Produit / offre : ${facts.productName}` : null,
    facts.price ? `Prix : ${facts.price}` : null,
    goalLabel(facts.closingGoal) ? `Objectif atteint : ${goalLabel(facts.closingGoal)}` : null,
  ].filter(Boolean);

  const userContent =
    `Rédige le message WhatsApp à envoyer au tiers à partir de ces faits :\n` +
    lines.map((l) => `- ${l}`).join("\n");

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: THIRD_PARTY_NOTIFICATION_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 280, { thinkingEnabled: false }),
      temperature: 0.4,
      ...deepseekChatExtras({ enableThinking: false }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  );

  const raw = extractAssistantContent(response?.choices[0]?.message);
  if (!raw?.trim()) {
    throw new Error(`${llmProviderLabel()} n'a pas généré le message tiers.`);
  }

  let text = sanitizeOutboundWhatsAppText(raw.trim());
  text = text.replace(/^["'«「]|["'»」]$/g, "");
  text = text.replace(/^```\w*\n?|\n?```$/g, "");
  return text.trim();
}

function resolveThirdPartyChatId(phoneRaw: string): string {
  const trimmed = phoneRaw.trim();
  if (!trimmed) throw new Error("Numéro du tiers manquant.");
  if (trimmed.endsWith("@c.us") || trimmed.endsWith("@s.whatsapp.net")) {
    return normalizePhoneToChatId(trimmed);
  }
  return normalizePhoneToChatId(trimmed);
}

async function alertOperator(
  userId: number,
  automationId: number,
  message: string
): Promise<void> {
  console.warn(`⚠️ Notif tiers #${automationId}: ${message}`);
  // Journal campagne uniquement — pas de message dans le chat agent.
  await addAutomationLog(userId, automationId, "warning", message).catch(() => {});
}

/**
 * Side-effect isolé : notifie le tiers si configuré.
 * Ne doit jamais faire échouer la clôture prospect.
 */
export async function maybeNotifyThirdPartyOnConversion(input: {
  userId: number;
  automation: Automation;
  prospectChatId: string;
  prospectName: string;
}): Promise<void> {
  const cfg = input.automation.config.thirdPartyNotification;
  if (!cfg?.enabled) return;

  const autoId = input.automation.id;
  let thirdPartyChatId: string;
  try {
    thirdPartyChatId = resolveThirdPartyChatId(cfg.phone || "");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await alertOperator(
      input.userId,
      autoId,
      `Notification tiers échouée (campagne « ${input.automation.name} ») — numéro invalide ou manquant` +
        (detail ? ` (${detail})` : "") +
        `. Prospect converti : ${input.prospectName} (${chatIdToDisplay(input.prospectChatId)}).`
    );
    return;
  }

  if (await isContactBlocked(input.userId, thirdPartyChatId)) {
    await alertOperator(
      input.userId,
      autoId,
      `Notification tiers échouée (campagne « ${input.automation.name} ») — le numéro ${chatIdToDisplay(thirdPartyChatId)} est en STOP. ` +
        `Prospect converti : ${input.prospectName} (${chatIdToDisplay(input.prospectChatId)}).`
    );
    return;
  }

  try {
    const contact = await getContact(input.userId, input.prospectChatId).catch(() => null);
    const prospectName =
      contact?.name?.trim() || input.prospectName || chatIdToDisplay(input.prospectChatId);

    const facts: ThirdPartyNotifyFacts = {
      role: cfg.role?.trim() || "tiers",
      context: cfg.context,
      prospectName,
      prospectPhoneDisplay: chatIdToDisplay(input.prospectChatId),
      productName: input.automation.config.productName,
      price: input.automation.config.price,
      closingGoal: input.automation.config.closingGoal,
      campaignName: input.automation.name,
    };

    let message: string;
    try {
      message = await generateThirdPartyNotificationMessage(input.userId, facts);
    } catch (llmErr) {
      const detail = llmErr instanceof Error ? llmErr.message : String(llmErr);
      console.warn(`⚠️ Notif tiers #${autoId}: LLM indisponible (${detail}) — fallback template`);
      message = buildFallbackThirdPartyMessage(facts);
    }

    await sendWhatsAppMessage(input.userId, thirdPartyChatId, message, {
      enableAutoReply: false,
      countsTowardQuota: false,
      outboundProfile: "auto_reply",
      automationId: null,
    });

    console.log(
      `📤 Notif tiers → ${chatIdToDisplay(thirdPartyChatId)} (campagne #${autoId}, prospect ${chatIdToDisplay(input.prospectChatId)})`
    );
    await addAutomationLog(
      input.userId,
      autoId,
      "success",
      `Notification tiers envoyée à ${chatIdToDisplay(thirdPartyChatId)} (prospect ${prospectName}).`
    ).catch(() => {});
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await alertOperator(
      input.userId,
      autoId,
      `Notification tiers échouée (campagne « ${input.automation.name} ») vers ${chatIdToDisplay(thirdPartyChatId)} : ${detail.slice(0, 200)}. ` +
        `Prospect converti : ${input.prospectName} (${chatIdToDisplay(input.prospectChatId)}).`
    );
  }
}

/** Parse les args create/update → bloc config (ou undefined si non fourni). */
export function parseThirdPartyNotificationArgs(
  args: Record<string, unknown>
): AutomationConfig["thirdPartyNotification"] | undefined {
  if (args.third_party_notification_enabled === false) {
    return { enabled: false, phone: "" };
  }

  const phone = args.third_party_phone != null ? String(args.third_party_phone).trim() : "";
  const wantsEnable =
    args.third_party_notification_enabled === true ||
    (phone.length > 0 && args.third_party_notification_enabled !== false);

  if (!wantsEnable) return undefined;

  return {
    enabled: true,
    phone,
    role: args.third_party_role != null ? String(args.third_party_role).trim() || undefined : undefined,
    context:
      args.third_party_context != null
        ? String(args.third_party_context).trim() || undefined
        : undefined,
  };
}
