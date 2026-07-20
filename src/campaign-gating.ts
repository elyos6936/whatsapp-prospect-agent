import {
  listActiveAutomations,
  listAutomationTargets,
  findMatchingAutomationTarget,
  setContactAutoReply,
  saveContact,
  getContact,
  getContactChatHistory,
  beginFreshCampaignConversation,
  setConversationCampaignId,
  type Automation,
  type TargetStatus,
} from "./db.js";
import { matchesAnyTriggerPhrase } from "./phrase-matching.js";

const OUTBOUND_TARGET_STATUSES: TargetStatus[] = [
  "pending",
  "contacted",
  "replied",
  "interested",
];

function isOutboundCampaign(auto: Automation): boolean {
  return (
    auto.type === "group_prospect" ||
    auto.type === "contact_prospect" ||
    auto.config.mode === "outbound_prospect"
  );
}

function isInboundClosingCampaign(auto: Automation): boolean {
  return auto.type === "keyword_sales" || auto.config.mode === "inbound_closing";
}

function getTriggerPhrases(auto: Automation): string[] {
  const phrases = auto.config.triggerPhrases ?? auto.config.keywords ?? [];
  return phrases.map((p) => p.trim()).filter(Boolean);
}

/** IDs de contacts déjà enrôlés dans une campagne active (déduplication inter-campagnes). */
export async function getActiveCampaignTargetIds(
  userId: number,
  excludeAutomationId?: number
): Promise<Set<string>> {
  const active = await listActiveAutomations(userId);
  const ids = new Set<string>();
  for (const auto of active) {
    if (excludeAutomationId != null && auto.id === excludeAutomationId) continue;
    const targets = await listAutomationTargets(userId, auto.id, { limit: 5000 });
    for (const t of targets) {
      if (t.status !== "stopped" && t.status !== "error") {
        ids.add(t.target_id);
      }
    }
  }
  return ids;
}

async function matchOutboundTarget(
  campaigns: Automation[],
  userId: number,
  chatId: string
): Promise<{ automation: Automation; targetId: string } | null> {
  for (const auto of campaigns) {
    if (!isOutboundCampaign(auto)) continue;
    const target = await findMatchingAutomationTarget(
      userId,
      auto.id,
      chatId,
      OUTBOUND_TARGET_STATUSES
    );
    if (target) return { automation: auto, targetId: target.target_id };
  }
  return null;
}

/**
 * Campagne de prospection liée à ce contact pour les réponses auto.
 * Préfère la campagne pointée par conversation_campaign_id (dernier opener),
 * sinon première campagne active où le contact est cible.
 */
export async function findActiveOutboundCampaign(
  userId: number,
  chatId: string
): Promise<{ automation: Automation; targetId: string } | null> {
  const active = await listActiveAutomations(userId);
  const contact = await getContact(userId, chatId);
  const preferredId =
    contact?.conversation_campaign_id != null
      ? Number(contact.conversation_campaign_id)
      : NaN;

  if (Number.isFinite(preferredId)) {
    const preferred = active.find((a) => a.id === preferredId);
    if (preferred && isOutboundCampaign(preferred)) {
      const target = await findMatchingAutomationTarget(
        userId,
        preferred.id,
        chatId,
        OUTBOUND_TARGET_STATUSES
      );
      if (target) {
        return { automation: preferred, targetId: target.target_id };
      }
    }
  }

  return matchOutboundTarget(active, userId, chatId);
}

/** Campagne e-commerce entrant dont un déclencheur exact correspond au message. */
export async function findMatchingInboundClosingCampaign(
  userId: number,
  text: string
): Promise<Automation | null> {
  const active = (await listActiveAutomations(userId)).filter(isInboundClosingCampaign);
  for (const auto of active) {
    const phrases = getTriggerPhrases(auto);
    if (phrases.length && matchesAnyTriggerPhrase(text, phrases)) {
      return auto;
    }
  }
  return null;
}

/**
 * Conversation de closing DÉJÀ engagée : le contact a été déclenché auparavant
 * (auto_reply activé) et un échange existe. On poursuit alors le fil même si le
 * message courant ne contient plus le mot déclencheur — sinon la vente se coupe.
 */
export async function findOngoingClosingConversation(
  userId: number,
  chatId: string
): Promise<Automation | null> {
  const active = (await listActiveAutomations(userId)).filter(isInboundClosingCampaign);
  if (!active.length) return null;

  const contact = await getContact(userId, chatId);
  if (!contact || contact.auto_reply !== 1) return null;

  const campaignId =
    contact.conversation_campaign_id != null
      ? Number(contact.conversation_campaign_id)
      : NaN;
  if (Number.isFinite(campaignId)) {
    const stopped = await findMatchingAutomationTarget(userId, campaignId, chatId, [
      "stopped",
    ]);
    if (stopped) return null;
  }

  const history = await getContactChatHistory(
    userId,
    chatId,
    6,
    contact.conversation_campaign_id
  );
  const hasOutbound = history.some((m) => m.direction === "sortant");
  const hasInbound = history.some((m) => m.direction === "entrant");
  if (!hasOutbound || !hasInbound) return null;

  return active[0];
}

export interface ReplyGateResult {
  allow: boolean;
  reason: string;
  outboundCampaign?: Automation;
  inboundCampaign?: Automation;
}

/**
 * Portier à deux régimes :
 * (a) prospect contacté en campagne sortante -> poursuite du fil jusqu'à conversion / refus
 * (b) entrant e-commerce -> déclencheur exact, puis fil engagé
 */
export async function passesReplyGate(
  userId: number,
  chatId: string,
  text: string
): Promise<ReplyGateResult> {
  const outbound = await findActiveOutboundCampaign(userId, chatId);
  if (outbound) {
    // Campagne active → auto-reply toujours ON pour ce prospect
    try {
      await setContactAutoReply(userId, chatId, true);
      await saveContact(userId, {
        phone: chatId,
        status: "en_conversation",
        autoReply: true,
      });
      // Aligne le pointeur sur la campagne matchée (évite de taguer l'entrant sur une ancienne auto).
      await setConversationCampaignId(userId, chatId, outbound.automation.id);
    } catch {
      /* best effort */
    }
    return {
      allow: true,
      reason: `prospect campagne « ${outbound.automation.name} »`,
      outboundCampaign: outbound.automation,
    };
  }

  const inbound = await findMatchingInboundClosingCampaign(userId, text);
  if (inbound) {
    try {
      // Nouveau déclencheur e-commerce = nouvelle conversation (sauf si déjà cette campagne)
      await beginFreshCampaignConversation(userId, chatId, inbound.id);
      await setContactAutoReply(userId, chatId, true);
      await saveContact(userId, { phone: chatId, status: "en_conversation", autoReply: true });
    } catch {
      /* best effort */
    }
    return {
      allow: true,
      reason: `déclencheur e-commerce « ${inbound.name} »`,
      inboundCampaign: inbound,
    };
  }

  const ongoing = await findOngoingClosingConversation(userId, chatId);
  if (ongoing) {
    return {
      allow: true,
      reason: `closing en cours « ${ongoing.name} »`,
      inboundCampaign: ongoing,
    };
  }

  return { allow: false, reason: "hors cadre campagne (pas de déclencheur exact)" };
}
