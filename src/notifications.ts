import {
  chatIdToDisplay,
  chatIdsMatch,
  isLikelyPhoneJid,
  isLidJid,
  resolveInboundChatId,
  resolvePublicMediaUrl,
  sendWhatsAppMedia,
  sendWhatsAppMessage,
  sendWhatsAppPresence,
  testEvolutionConnection,
  getLastIncomingMessages,
  normalizeGroupParticipantId,
} from "./evolutionapi.js";
import {
  getAppSettings,
  saveWhatsAppMessage,
  whatsAppMessageExists,
  isAutoReplyEnabled,
  getBlockedContactIds,
  touchIncomingContact,
  findMatchingKeywordAutomations,
  listActiveAutomations,
  findMatchingAutomationTarget,
  existingWhatsAppMessageIds,
  findGroupReplyRule,
  addAutomationLog,
  updateAutomationStats,
  updateAutomationTarget,
  getContact,
  getContactChatHistory,
  getContactAutomationState,
  findProspectPhoneForLidReply,
  findUnansweredInboundMessages,
  hasOutboundReplyAfter,
  setContactWhatsappLid,
  saveAgentMessageForAutomation,
  saveContact,
  incrementAutoStopped,
  incrementMessagesHandled,
  stopAutomationTargetForContact,
  setConversationCampaignId,
  setContactAutoReply,
  enqueueSend,
  cancelPendingSendQueueForRecipient,
} from "./db.js";
import { computeInboundReplySendAtIso, INBOUND_REPLY_AB_VARIANT } from "./inbound-reply-batch.js";
import { userIdFromInstanceName, listActiveUserIds } from "./users.js";
import {
  scoreIncomingMessage,
  recordAutomationConversion,
  isCampaignObjectiveReached,
  wasVerballyClosed,
  isAppointmentSlotConfirmed,
  ensurePendingLinkInReply,
  alignOutboundVerbalClose,
} from "./lead-scoring.js";
import { fulfillOutboundPromises } from "./outbound-promise-guard.js";
import { recordAbReply } from "./ab-testing.js";
import { refreshContactMemory, getMemoryContextBlock } from "./contact-memory.js";
import { createKeywordHandoff, findMatchingHandoffKeyword, maybeCreateHandoff } from "./handoff.js";
import { passesReplyGate, findActiveOutboundCampaign } from "./campaign-gating.js";
import {
  detectInboundMedia,
  describeInboundMedia,
  placeholderForKind,
  typeMessageToKind,
} from "./media-understanding.js";
import {
  generateWhatsAppReply,
  getStopConfirmationReply,
  isPromptInjection,
  isStopRequest,
  nowFr,
} from "./whatsapp-reply.js";
import { enqueueAutoReply } from "./auto-reply-queue.js";
import { ANTI_BAN, clampPresenceMs } from "./anti-ban.js";
import { shouldStopConversation, stopReasonLabel, getStopFarewellReply, getObjectiveReachedReply, shouldSilenceAfterFarewell, detectRepeatedUnknownQuestion } from "./stop-policy.js";
import type { Automation, AutomationConfig } from "./db.js";
import { buildSupportConversationGuide } from "./support-flow.js";

function extractEvolutionInboundText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  if (typeof m.conversation === "string" && m.conversation.trim()) return m.conversation.trim();
  if (m.extendedTextMessage && typeof m.extendedTextMessage === "object") {
    const t = (m.extendedTextMessage as { text?: string }).text;
    if (t?.trim()) return t.trim();
  }
  return null;
}

/**
 * Détecte un vote de sondage (pollUpdateMessage) et produit une note lisible.
 * Note : WhatsApp chiffre les votes ; les options ne sont lisibles que si Evolution
 * les a déjà déchiffrées et exposées dans le payload. Sinon on note un vote générique.
 */
function extractPollVoteNote(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const pollUpdate = m.pollUpdateMessage as Record<string, unknown> | undefined;
  if (!pollUpdate) return null;

  const readSelected = (obj: unknown): string[] => {
    if (!obj || typeof obj !== "object") return [];
    const o = obj as Record<string, unknown>;
    const opts = o.selectedOptions ?? o.selectedValues ?? o.votes;
    if (Array.isArray(opts)) {
      return opts
        .map((v) =>
          typeof v === "string"
            ? v
            : v && typeof v === "object"
              ? String((v as { name?: string; optionName?: string }).name ?? (v as { optionName?: string }).optionName ?? "")
              : ""
        )
        .filter(Boolean);
    }
    return [];
  };

  const selected = [
    ...readSelected(pollUpdate.vote),
    ...readSelected((pollUpdate as { pollVotes?: unknown }).pollVotes),
    ...readSelected(m.pollUpdates),
  ];

  return selected.length > 0
    ? `[Vote sondage] ${[...new Set(selected)].join(", ")}`
    : "[Vote sondage reçu]";
}

/** Webhook Evolution API — messages, présence et groupes */
export async function handleEvolutionWebhook(payload: unknown): Promise<number> {
  if (!payload || typeof payload !== "object") return 0;
  const body = payload as Record<string, unknown>;
  const event = String(body.event ?? body.type ?? "").toUpperCase().replace(/\./g, "_");
  const isUpsert = event.includes("MESSAGES_UPSERT");
  const isUpdate = event.includes("MESSAGES_UPDATE") || event.includes("MESSAGES_EDITED") || event.includes("SEND_MESSAGE_UPDATE");
  const isPresence = event.includes("PRESENCE_UPDATE");
  const isConnection = event.includes("CONNECTION_UPDATE");
  const isGroup =
    event.includes("GROUPS_UPSERT") ||
    event.includes("GROUP_UPDATE") ||
    event.includes("GROUP_PARTICIPANTS");
  if (!isUpsert && !isUpdate && !isPresence && !isGroup && !isConnection) return 0;

  const instance = String(body.instance ?? body.instanceName ?? "");
  const userId = await userIdFromInstanceName(instance);
  if (!userId) {
    console.warn(`⚠️ Webhook Evolution ignoré — instance inconnue « ${instance} »`);
    return 0;
  }
  pollHealthFor(userId).lastWebhookAt = new Date().toISOString();

  const data = body.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];

  if (isConnection) {
    const { handleConnectionUpdate } = await import("./whatsapp-connection.js");
    return handleConnectionUpdate(userId, data ?? body);
  }

  if (isGroup) {
    return handleGroupWebhookEvent(userId, event, data);
  }

  if (isPresence) {
    return handlePresenceUpdate(userId, data);
  }

  if (isUpdate) {
    return handleMessagesUpdate(userId, items);
  }

  let processed = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = row.key as { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string } | undefined;
    if (!key || key.fromMe) continue;

    const rawChatId = key.remoteJid ?? "";
    if (isBroadcastOrStatusJid(rawChatId)) continue;

    const pollNote = extractPollVoteNote(row.message);
    if (pollNote) {
      const voterName = String(row.pushName ?? chatIdToDisplay(rawChatId));
      const voteId = key.id ?? `vote-${Date.now()}`;
      try {
        if (!(await whatsAppMessageExists(userId, voteId))) {
          await saveWhatsAppMessage(userId, {
            contactPhone: rawChatId.endsWith("@g.us") ? rawChatId : normalizeGroupParticipantId(rawChatId),
            direction: "entrant",
            body: `${pollNote} — ${voterName}`,
            greenApiId: voteId,
            senderName: voterName,
          });
          pollHealthFor(userId).lastIncomingAt = new Date().toISOString();
          processed++;
        }
      } catch (err) {
        console.error("Erreur enregistrement vote sondage:", err);
      }
      continue;
    }

    let text = extractEvolutionInboundText(row.message);
    const isGroupChat = rawChatId.endsWith("@g.us");

    // Média entrant (note vocale, image…) en DM : tenter d'interpréter avec OpenAI.
    if (!text && !isGroupChat) {
      const media = detectInboundMedia(row.message);
      if (media) {
        const mediaMsgId = key.id ?? "";
        // Évite de rappeler OpenAI si le message est déjà en base.
        if (mediaMsgId && (await whatsAppMessageExists(userId, mediaMsgId))) continue;
        text =
          (mediaMsgId ? await describeInboundMedia(userId, mediaMsgId, media) : null) ??
          placeholderForKind(media.kind);
      }
    }

    if (!text) continue;

    if (isGroupChat) {
      const senderName = String(row.pushName ?? chatIdToDisplay(rawChatId));
      void runGroupAutoReply(userId, rawChatId, senderName, text);
      continue;
    }

    const keyExtra = key as {
      senderPn?: string;
      remoteJidAlt?: string;
      participant?: string;
      participantPn?: string;
    };
    const rowExtra = row as {
      senderPn?: string;
      remoteJidAlt?: string;
      participant?: string;
      pushName?: string;
    };
    const senderPn =
      keyExtra.senderPn ||
      rowExtra.senderPn ||
      keyExtra.participantPn ||
      undefined;
    const remoteJidAlt = keyExtra.remoteJidAlt || rowExtra.remoteJidAlt || undefined;
    const participant = keyExtra.participant || rowExtra.participant || undefined;
    const senderName = String(row.pushName ?? chatIdToDisplay(rawChatId));

    const chatId = await resolveInboundChatId(userId, rawChatId, {
      senderPn,
      remoteJidAlt,
      participant,
      senderName,
    });
    // Si on a résolu un téléphone depuis un @lid, mémoriser le mapping
    if (
      /@lid$/i.test(rawChatId) &&
      chatId.endsWith("@c.us") &&
      !/@lid$/i.test(chatId)
    ) {
      try {
        await setContactWhatsappLid(userId, chatId, rawChatId);
      } catch {
        /* best effort */
      }
    }
    const msgId = key.id ?? `evo-${Date.now()}`;
    if (
      await ingestInboundMessage(userId, chatId, senderName, text, msgId, "notification", {
        senderPn,
        remoteJidAlt,
        participant,
      })
    ) {
      processed++;
    }
  }
  return processed;
}

/** Statuts d'accusé WhatsApp (Baileys) — code numérique → libellé. */
const WA_STATUS_LABELS: Record<string, string> = {
  "0": "erreur",
  "1": "en attente",
  "2": "envoyé",
  "3": "distribué",
  "4": "lu",
  "5": "écouté",
  ERROR: "erreur",
  PENDING: "en attente",
  SERVER_ACK: "envoyé",
  DELIVERY_ACK: "distribué",
  READ: "lu",
  PLAYED: "écouté",
};

/** Extrait le nouveau texte d'un message édité (structures Baileys/Evolution variées). */
function extractEditedText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const edited = m.editedMessage as Record<string, unknown> | undefined;
  const proto =
    (m.protocolMessage as Record<string, unknown> | undefined) ??
    (edited?.message as Record<string, unknown> | undefined)?.protocolMessage as
      | Record<string, unknown>
      | undefined;
  const inner = (proto?.editedMessage ?? edited) as Record<string, unknown> | undefined;
  if (inner) {
    const t = extractEvolutionInboundText(inner);
    if (t) return t;
  }
  return null;
}

/**
 * Webhook MESSAGES_UPDATE : accusés (distribué/lu), suppressions (revoke) et éditions.
 * Informatif — met à jour la santé du poller, journalise, et enregistre les
 * suppressions/éditions comme notes visibles dans l'historique.
 */
async function handleMessagesUpdate(userId: number, items: unknown[]): Promise<number> {
  let processed = 0;
  const h = pollHealthFor(userId);

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key =
      (row.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined) ??
      (row.keyId
        ? { remoteJid: String(row.remoteJid ?? ""), fromMe: Boolean(row.fromMe), id: String(row.keyId) }
        : undefined);
    const rawChatId = key?.remoteJid ?? String(row.remoteJid ?? "");
    const msgId = key?.id ?? String(row.keyId ?? row.messageId ?? "");
    if (!rawChatId || !msgId) continue;

    const update = (row.update as Record<string, unknown> | undefined) ?? row;
    const rawStatus = update.status ?? row.status;
    const statusKey = rawStatus != null ? String(rawStatus).toUpperCase() : "";
    const message = row.message ?? (update.message as unknown);

    // 1) Suppression (revoke)
    const isRevoke =
      statusKey === "DELETED" ||
      statusKey === "REVOKED" ||
      Number(update.messageStubType) === 1 ||
      hasRevokeProtocol(message);
    if (isRevoke) {
      const noteId = `${msgId}-deleted`;
      try {
        if (!(await whatsAppMessageExists(userId, noteId))) {
          await saveWhatsAppMessage(userId, {
            contactPhone: rawChatId.endsWith("@g.us") ? rawChatId : normalizeGroupParticipantId(rawChatId),
            direction: key?.fromMe ? "sortant" : "entrant",
            body: "[Message supprimé]",
            greenApiId: noteId,
          });
          processed++;
        }
      } catch (err) {
        console.error("Erreur enregistrement suppression:", err);
      }
      h.lastIncomingAt = new Date().toISOString();
      continue;
    }

    // 2) Édition
    const editedText = extractEditedText(message);
    if (editedText) {
      const noteId = `${msgId}-edited-${Math.floor(Date.now() / 1000)}`;
      try {
        if (!(await whatsAppMessageExists(userId, noteId))) {
          await saveWhatsAppMessage(userId, {
            contactPhone: rawChatId.endsWith("@g.us") ? rawChatId : normalizeGroupParticipantId(rawChatId),
            direction: key?.fromMe ? "sortant" : "entrant",
            body: `[Message modifié] ${editedText}`,
            greenApiId: noteId,
          });
          processed++;
        }
      } catch (err) {
        console.error("Erreur enregistrement édition:", err);
      }
      h.lastIncomingAt = new Date().toISOString();
      continue;
    }

    // 3) Accusé d'envoi / distribution / lecture (informatif — journalisé)
    if (statusKey && WA_STATUS_LABELS[statusKey]) {
      console.log(
        `📬 Accusé WhatsApp [${WA_STATUS_LABELS[statusKey]}] ${chatIdToDisplay(rawChatId)} (msg ${msgId})`
      );
      processed++;
    }
  }

  return processed;
}

/** Détecte un protocolMessage de type REVOKE (suppression). */
function hasRevokeProtocol(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  const proto = m.protocolMessage as Record<string, unknown> | undefined;
  if (!proto) return false;
  const type = proto.type;
  return type === 0 || String(type).toUpperCase() === "REVOKE";
}

export interface ContactPresence {
  chatId: string;
  /** available | unavailable | composing | recording | paused */
  presence: string;
  updatedAt: string;
}

/** Dernière présence connue par contact, par utilisateur (éphémère, en mémoire). */
const presenceStore = new Map<number, Map<string, ContactPresence>>();

function presenceStoreFor(userId: number): Map<string, ContactPresence> {
  let m = presenceStore.get(userId);
  if (!m) {
    m = new Map();
    presenceStore.set(userId, m);
  }
  return m;
}

/** Présence connue d'un contact (ou toutes si chatId omis). */
export function getContactPresence(userId: number, chatId?: string): ContactPresence | ContactPresence[] | null {
  const store = presenceStoreFor(userId);
  if (chatId) {
    const key = normalizeGroupParticipantId(chatId);
    return store.get(key) ?? store.get(chatId) ?? null;
  }
  return [...store.values()];
}

/** Webhook PRESENCE_UPDATE : mémorise la présence des contacts (en ligne, typing, recording…). */
function handlePresenceUpdate(userId: number, data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;
  const rawId = String(d.id ?? d.remoteJid ?? d.chatId ?? "");
  if (!rawId) return 0;

  // presences: { "<jid>": { lastKnownPresence: "composing" } }
  const presences = d.presences as Record<string, unknown> | undefined;
  let presence = "";
  if (presences && typeof presences === "object") {
    for (const val of Object.values(presences)) {
      if (val && typeof val === "object") {
        const p = (val as Record<string, unknown>).lastKnownPresence;
        if (p) {
          presence = String(p);
          break;
        }
      }
    }
  }
  if (!presence && d.presence) presence = String(d.presence);
  if (!presence) return 0;

  const chatId = normalizeGroupParticipantId(rawId);
  presenceStoreFor(userId).set(chatId, {
    chatId,
    presence,
    updatedAt: new Date().toISOString(),
  });
  return 1;
}

/** Webhook groupes : création, mise à jour, participants add/remove/promote/demote. */
function handleGroupWebhookEvent(userId: number, event: string, data: unknown): number {
  const items = Array.isArray(data) ? data : data ? [data] : [];
  let processed = 0;
  const h = pollHealthFor(userId);

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const groupObj = row.group as Record<string, unknown> | undefined;
    const groupId = String(
      row.id ?? row.remoteJid ?? row.groupJid ?? groupObj?.id ?? groupObj?.remoteJid ?? ""
    );
    const subject = String(row.subject ?? groupObj?.subject ?? groupId);
    const action = String(row.action ?? row.type ?? "");

    let note = "";
    if (event.includes("GROUPS_UPSERT")) {
      note = `[Groupe créé/mis à jour] ${subject}`;
    } else if (event.includes("GROUP_PARTICIPANTS")) {
      const participants = row.participants ?? row.participant;
      const list = Array.isArray(participants)
        ? participants.map((p) => String((p as { id?: string }).id ?? p)).join(", ")
        : "";
      const labels: Record<string, string> = {
        add: "ajout",
        remove: "retrait",
        promote: "promotion admin",
        demote: "rétrogradation admin",
      };
      note = `[Groupe participants — ${labels[action] ?? action}] ${subject}${list ? ` : ${list}` : ""}`;
    } else if (event.includes("GROUP_UPDATE")) {
      note = `[Groupe modifié] ${subject}`;
    }

    if (note) {
      console.log(`👥 ${note}`);
      h.lastIncomingAt = new Date().toISOString();
      processed++;
    }
  }
  return processed;
}

export interface WhatsappPollHealth {
  lastPollAt: string | null;
  lastSyncAt: string | null;
  lastIncomingAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  webhookBlocked: boolean;
  authorized: boolean;
  processedTotal: number;
  syncTotal: number;
}

function newPollHealth(): WhatsappPollHealth {
  return {
  lastPollAt: null,
  lastSyncAt: null,
  lastIncomingAt: null,
  lastWebhookAt: null,
  lastError: null,
  webhookBlocked: false,
  authorized: true,
  processedTotal: 0,
  syncTotal: 0,
};
}

/** Webhook vivant récemment → pas besoin de relire tout l'historique Evolution. */
export const WEBHOOK_FRESH_MS = 120_000;

export function webhookIsFresh(
  lastWebhookAt: string | null | undefined,
  nowMs = Date.now(),
  windowMs = WEBHOOK_FRESH_MS
): boolean {
  if (!lastWebhookAt) return false;
  const t = new Date(lastWebhookAt).getTime();
  return Number.isFinite(t) && nowMs - t < windowMs;
}

/** État de santé du poller, isolé par tenant. */
const pollHealthByUser = new Map<number, WhatsappPollHealth>();

/** Horodatage global de dernière activité du poller (liveness, non lié à un tenant). */
const pollerLiveness = { lastPollAt: null as string | null, lastSyncAt: null as string | null };

function pollHealthFor(userId: number): WhatsappPollHealth {
  let h = pollHealthByUser.get(userId);
  if (!h) {
    h = newPollHealth();
    pollHealthByUser.set(userId, h);
  }
  return h;
}

/**
 * Santé du poller. Avec un userId → l'état de ce tenant. Sans → un résumé de
 * liveness du poller (utilisé par /api/health qui est public).
 */
export function getWhatsappPollHealth(userId?: number): WhatsappPollHealth {
  if (typeof userId === "number") {
    return { ...pollHealthFor(userId) };
  }
  return {
    ...newPollHealth(),
    lastPollAt: pollerLiveness.lastPollAt,
    lastSyncAt: pollerLiveness.lastSyncAt,
  };
}

function placeholderForType(type: string): string | null {
  switch (type) {
    case "audioMessage":
    case "voiceMessage":
      return "[Message vocal reçu]";
    case "imageMessage":
      return "[Image reçue]";
    case "videoMessage":
      return "[Vidéo reçue]";
    case "documentMessage":
      return "[Document reçu]";
    case "stickerMessage":
      return "[Sticker reçu]";
    default:
      return null;
  }
}

function isBroadcastOrStatusJid(jid: string): boolean {
  const j = jid.trim().toLowerCase();
  return j === "status@broadcast" || j.endsWith("@broadcast");
}

/** Seuls les vrais messages texte en DM déclenchent une réponse auto. */
function isAutoReplyEligible(text: string, remoteJid: string): boolean {
  if (isBroadcastOrStatusJid(remoteJid)) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Les placeholders média ([Message vocal reçu], [Sticker reçu]…) restent éligibles :
  // le portier de campagne (passesReplyGate) filtre déjà les non-prospects, et l'IA
  // doit pouvoir répondre à un prospect actif (ex. lui demander d'écrire en texte).
  return true;
}



const authCache = new Map<number, { checkedAtMs: number; ok: boolean }>();

async function ensureWhatsAppAuthorized(userId: number): Promise<boolean> {
  const now = Date.now();
  const cached = authCache.get(userId);
  if (cached && now - cached.checkedAtMs < 30_000) return cached.ok;
  const h = pollHealthFor(userId);
  let ok = true;
  try {
    const state = await testEvolutionConnection(userId);
    ok = state.connected;
    h.authorized = ok;
    if (!ok) {
      h.lastError = state.message;
    }
  } catch (err) {
    ok = false;
    h.authorized = false;
    h.lastError = err instanceof Error ? err.message : String(err);
  }
  authCache.set(userId, { checkedAtMs: now, ok });
  return ok;
}

async function recordAutomationEngagement(
  userId: number,
  chatId: string,
  text: string,
  interested: boolean
): Promise<void> {
  const outbound = await findActiveOutboundCampaign(userId, chatId);
  const campaigns = outbound
    ? [outbound.automation]
    : (await listActiveAutomations(userId)).filter(
        (a) =>
          a.type === "group_prospect" ||
          a.type === "contact_prospect" ||
          a.type === "custom_followup"
      );

  for (const auto of campaigns) {
    const target = await findMatchingAutomationTarget(userId, auto.id, chatId);
    if ((auto.type === "group_prospect" || auto.type === "contact_prospect") && !target) continue;
    if (target) {
      // Ne jamais rétrograder intéressé / stoppé
      if (target.status === "interested" || target.status === "stopped") continue;
      const nextStatus = interested ? "interested" : "replied";
      if (target.status === nextStatus) continue;
      await updateAutomationTarget(userId, auto.id, target.target_id, {
        status: nextStatus,
      });
      if (target.ab_variant) {
        await recordAbReply(userId, auto.id, target.ab_variant, interested);
      }
    }
  }
  void text;
}

/** Cadre Support injecté à CHAQUE reply (campagnes actives incluses). */
function buildRuntimeSupportFrame(cfg: AutomationConfig): string {
  return buildSupportConversationGuide({
    catchAll: Boolean(cfg.inboundCatchAll),
    triggers: (cfg.triggerPhrases || cfg.keywords || []).map(String),
    handoffKeywords: cfg.handoffKeywords,
    productHint: cfg.productName,
    price: cfg.price,
    link: cfg.closingLink,
    closingGoal: cfg.closingGoal,
  });
}

function buildActiveCampaignContext(
  auto: Automation,
  extras?: { memoryBlock?: string; playbookBlock?: string }
): string {
  const cfg = auto.config;
  const hasMemory = Boolean(extras?.memoryBlock?.trim());
  const inbound =
    auto.type === "keyword_sales" || cfg.mode === "inbound_closing";
  const goalLabels: Record<string, string> = {
    payment: "obtenir le paiement",
    delivery: "organiser la livraison",
    link: "envoyer un lien",
    appointment: "fixer un rendez-vous",
  };
  const goal = cfg.closingGoal
    ? goalLabels[cfg.closingGoal] ?? cfg.closingGoal
    : "engager le prospect vers une action concrète";

  const lines = [
    `=== CAMPAGNE ACTIVE : « ${auto.name} » ===`,
    `Type : ${auto.type}`,
    `Mode : ${inbound ? "ENTRANT (le client écrit en premier — support / closing)" : "SORTANT (tu as initié)"}`,
    `Objectif de la campagne : ${goal}`,
    !inbound && cfg.initialMessage
      ? `Premier message déjà envoyé au prospect : « ${cfg.initialMessage} »`
      : "",
    inbound && cfg.initialMessage
      ? `Réponse type / ton de référence (PAS un opener sortant) : « ${cfg.initialMessage} »`
      : "",
    // Campagnes déjà actives : injecte le cadre Support même si le guide DB est vieux / prospection.
    inbound ? buildRuntimeSupportFrame(cfg) : "",
    hasMemory
      ? "Offre / prix / liens / ton : voir bloc MÉMOIRE CAMPAGNE ci-dessous (seule source — ignore le profil Réglages)."
      : "",
    !hasMemory && cfg.conversationGuide
      ? `TON & APPROCHE (suis à la lettre, c'est le cœur de la campagne) :\n${cfg.conversationGuide}`
      : "",
    !hasMemory && cfg.productName ? `Produit / offre : ${cfg.productName}` : "",
    !hasMemory && cfg.price
      ? `Prix EXACT à citer si demandé : ${cfg.price}`
      : !hasMemory
        ? `Prix : NON RENSEIGNÉ — si on te demande le prix, dis que tu confirmes juste après. JAMAIS écrire [prix].`
        : "",
    !hasMemory && cfg.closingLink
      ? `Lien à envoyer au prospect (URL réelle — SEULE URL autorisée) : ${cfg.closingLink}`
      : !hasMemory
        ? `Lien : AUCUN en config — INTERDIT d'inventer https://… (example.com, faux lien commande, etc.).`
        : "",
    cfg.mediaUrl
      ? `Photo / média produit à envoyer si le client demande une photo/image : ${cfg.mediaUrl}`
      : "",
    !hasMemory && cfg.salesScript ? `Argumentaire : ${cfg.salesScript}` : "",
    cfg.handoffKeywords?.length
      ? `Mots-clés handoff humain (si le prospect les écrit, l'IA s'arrête) : ${cfg.handoffKeywords.join(", ")}`
      : "",
    extras?.memoryBlock ? `\n${extras.memoryBlock}` : "",
    extras?.playbookBlock ? `\n${extras.playbookBlock}` : "",
    "",
    inbound
      ? [
          `PARCOURS ENTRANT (support — prioritaire sur toute mémoire prospection) :`,
          `1. Le client a initié — accueille / réponds. JAMAIS « Bonjour c'est X, je vous contacte… ».`,
          `2. Intérêt (« je suis intéressé », « plus d'infos », fautes OK) → remercie + offre CONCRÈTE (prix / produit). INTERDIT « quel type de tâche », « secteur d'activité », qualification froide.`,
          `3. Salutation courte (« salut ») → accueil + 1 question utile produit (taille, quantité) — pas une enquête.`,
          `4. Demande photo → confirme ; le système enverra le média si configuré.`,
          `5. Objectif « ${goal} » : suis le playbook Support (livraison = demander le LIEU ; paiement / RDV / lien réel seulement s'il est en config).`,
          `6. Ack court (ok / okay / « 1 ») : traite la réponse puis pose la prochaine question utile — souvent le lieu de livraison. INTERDIT inventer un lien. INTERDIT clôturer (« Bonne continuation », « C'est noté »).`,
          `7. Objectif livraison : adresse notée + confirmation livreur/boutique → courte confirmation puis STOP. Pas de boucle « le livreur vous appelle ».`,
          `8. Commence chaque message par une MAJUSCULE. INTERDIT réactions vides et pitch cold outreach.`,
        ].join("\n")
      : [
          `PARCOURS CONVERSATION (raisonne — même mission, seuls les mots varient) :`,
          `1. Après le 1er message, POURSUIS — ne coupe que sur refus d'intérêt clair OU objectif atteint.`,
          `2. À chaque message : relis ton dernier sortant → déduis l'intention → réponds à CETTE intention (pas de script).`,
          `3. Identité (« c'est qui ? ») → prénom business + pourquoi on écrit EN UN SOUFFLE.`,
          `4. Oui / ok après une offre d'action (lien, montrer, expliquer…) → EXÉCUTE. Confusion → clarifie, jamais de reset / re-présentation / question déjà posée.`,
          `5. Inattendu ou hors-sujet → clarifie ou recadre en 1 phrase, reste sur la mission (${goal}).`,
          `6. Intéressé → substance réelle, puis avance. Prêt → lien/prix/créneau RÉEL.`,
          `7. Refus d'intérêt (« ça vous intéresse ? » → non / non merci / pas intéressé) → accepte + STOP. « Non » à une Q diagnostic (« utilisez-vous déjà… ? ») → continue et avance.`,
          `8. INTERDIT réactions vides, cold opener mid-fil, re-présentation, questions déjà posées / hors fil.`,
          `9. N'utilise PAS le prénom du prospect à tout va.`,
          `10. Mémoire + playbook = même source que la simulation — ne dérive pas.`,
        ].join("\n"),
    `RÈGLES : 1-2 phrases naturelles (court ≠ sec), ton WhatsApp, VOUS (jamais tu/ton/ta/te). Ne re-pitche pas en boucle. Ne te re-présente pas si déjà fait. Ne répète jamais une question déjà posée. AUCUN texte entre crochets [ ].`,
  ].filter((l) => l !== undefined && l !== "");
  return lines.join("\n");
}

async function buildAutomationContext(
  userId: number,
  text: string,
  chatId: string,
  activeCampaign?: Automation
): Promise<string | undefined> {
  const parts: string[] = [];

  if (activeCampaign) {
    const {
      formatCampaignMemoryForWhatsApp,
      formatLivePlaybookForWhatsApp,
      getLinkedMemoryForAutomation,
    } = await import("./campaign-sync.js");

    let memoryBlock = "";
    try {
      const mem = await getLinkedMemoryForAutomation(userId, activeCampaign.id);
      if (mem) memoryBlock = formatCampaignMemoryForWhatsApp(mem);
    } catch {
      /* ignore */
    }

    let playbookBlock = "";
    const pb = activeCampaign.config.livePlaybook;
    if (pb?.turns?.length) {
      const inbound =
        activeCampaign.type === "keyword_sales" ||
        activeCampaign.config.mode === "inbound_closing";
      playbookBlock = formatLivePlaybookForWhatsApp(pb, { inbound });
    }

    parts.push(
      buildActiveCampaignContext(activeCampaign, { memoryBlock, playbookBlock })
    );
  }

  const memory = await getMemoryContextBlock(userId, chatId, activeCampaign?.id);
  if (memory) parts.push(memory);

  const contact = await getContact(userId, chatId);
  let leadScore = contact?.lead_score ?? 0;
  if (activeCampaign) {
    const state = await getContactAutomationState(userId, chatId, activeCampaign.id);
    if (state) leadScore = state.lead_score;
  }
  if (leadScore > 0) {
    parts.push(`Score prospect : ${leadScore}/100`);
  }

  const keywordAutos = await findMatchingKeywordAutomations(userId, text);
  for (const auto of keywordAutos) {
    if (activeCampaign && auto.id === activeCampaign.id) continue;
    const lines = [
      `Automatisation « ${auto.name} » (vente sur mots-clés)`,
      auto.config.productName ? `Produit : ${auto.config.productName}` : "",
      auto.config.price ? `Prix : ${auto.config.price}` : "",
      auto.config.salesScript ? `Script : ${auto.config.salesScript}` : "",
      auto.config.conversationGuide ? `Consignes : ${auto.config.conversationGuide}` : "",
    ].filter(Boolean);
    parts.push(lines.join("\n"));
    await addAutomationLog(userId, auto.id, "info", `Message entrant déclencheur de ${chatIdToDisplay(chatId)}`);
    const stats = auto.stats;
    await updateAutomationStats(userId, auto.id, {
      messagesHandled: (stats.messagesHandled ?? 0) + 1,
      lastActionAt: new Date().toISOString(),
    });
  }

  if (!activeCampaign) {
  const followups = (await listActiveAutomations(userId)).filter(
      (a) =>
        a.type === "group_prospect" ||
        a.type === "contact_prospect" ||
        a.type === "custom_followup"
  );
  for (const auto of followups) {
      const target = await findMatchingAutomationTarget(userId, auto.id, chatId);
      if ((auto.type === "group_prospect" || auto.type === "contact_prospect") && !target) continue;
      if (auto.config.conversationGuide || auto.config.initialMessage || auto.config.livePlaybook?.turns?.length) {
        let memoryBlock = "";
        let playbookBlock = "";
        try {
          const {
            formatCampaignMemoryForWhatsApp,
            formatLivePlaybookForWhatsApp,
            getLinkedMemoryForAutomation,
          } = await import("./campaign-sync.js");
          const mem = await getLinkedMemoryForAutomation(userId, auto.id);
          if (mem) memoryBlock = formatCampaignMemoryForWhatsApp(mem);
          if (auto.config.livePlaybook?.turns?.length) {
            playbookBlock = formatLivePlaybookForWhatsApp(auto.config.livePlaybook, {
              inbound:
                auto.type === "keyword_sales" ||
                auto.config.mode === "inbound_closing",
            });
          }
        } catch {
          /* ignore */
        }
      parts.push(
          buildActiveCampaignContext(auto, { memoryBlock, playbookBlock })
      );
      }
    }
  }

  return parts.length ? parts.join("\n\n") : undefined;
}

/** Client demande une photo / image produit. */
export function prospectRequestsCampaignMedia(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(photo|image|pic|visuel|screenshot|capture)\b/i.test(t) ||
    /montre[- ]?(moi )?(la |une |les )?(photo|image|visuel)/i.test(t) ||
    /envoie[- ]?(moi )?(la |une |les )?(photo|image)/i.test(t) ||
    /voir (la |une )?(photo|image|le produit)/i.test(t) ||
    /t'as (une |la )?photo|as[- ]tu (une |la )?photo/i.test(t)
  );
}

async function runGroupAutoReply(
  userId: number,
  groupId: string,
  senderName: string,
  text: string
): Promise<void> {
  const rule = await findGroupReplyRule(userId, groupId, text);
  if (!rule) return;

  const automationContext = rule.reply_guide
    ? `Réponse dans le groupe « ${rule.group_label || groupId} » — consignes : ${rule.reply_guide}`
    : undefined;

  try {
    const reply = await generateWhatsAppReply(userId, {
      chatId: groupId,
      senderName,
      incomingText: text,
      automationContext,
      allowEmojis: false,
    });
    await sendWhatsAppMessage(userId, groupId, reply, { enableAutoReply: false });
    console.log(`✅ Réponse groupe → ${rule.group_label || groupId}`);
  } catch (err) {
    console.error("❌ Réponse groupe échouée:", err);
  }
}

async function runAutoReply(
  userId: number,
  chatId: string,
  senderName: string,
  text: string
): Promise<void> {
  if (!(await isAutoReplyEnabled(userId))) {
    console.log(`📩 ${senderName} (pas de réponse — auto globale OFF): ${text.slice(0, 40)}`);
    return;
  }
  // Liste réglages « blocked_contacts » uniquement — pas contacts.status (stop = cible campagne).
  const blockedIds = await getBlockedContactIds(userId);
  if (blockedIds.some((id) => chatIdsMatch(id, chatId))) {
    console.log(`📩 ${senderName} (pas de réponse — blocked_contacts): ${text.slice(0, 40)}`);
    return;
  }

  const gate = await passesReplyGate(userId, chatId, text);
  if (!gate.allow) {
    console.log(`📩 ${senderName} (pas de réponse — ${gate.reason}): ${text.slice(0, 40)}`);
    return;
  }

  if (isPromptInjection(text)) {
    console.warn(`⚠️ Injection détectée de ${senderName} — ignorée`);
    return;
  }

  const activeCampaign = gate.outboundCampaign ?? gate.inboundCampaign;

  // Handoff humain déjà en cours → l'IA ne répond plus
  try {
    const existing = await getContact(userId, chatId);
    if (existing?.handoff_status === "pending") {
      console.log(`📩 ${senderName} (pas de réponse — handoff humain en cours): ${text.slice(0, 40)}`);
      return;
    }
  } catch {
    /* ignore */
  }

  // Nouveau fil entrant : respecter plafond jour / essai (sans toucher aux fils ouverts)
  try {
    const { classifyNewConversationKind, canStartNewConversation, ensureDefaultAgentThread, saveAgentMessage } =
      await import("./db.js");
    const newKind = await classifyNewConversationKind(
      userId,
      chatId,
      activeCampaign?.id ?? null
    );
    if (newKind !== "none") {
      const convGate = await canStartNewConversation(userId, newKind);
      if (!convGate.ok) {
        console.log(
          `📩 ${senderName} (pas de réponse — ${convGate.code}): ${text.slice(0, 40)}`
        );
        if (activeCampaign) {
          await saveAgentMessageForAutomation(
            userId,
            activeCampaign.id,
            "assistant",
            `Nouveau fil avec ${senderName} reporté — ${convGate.reason}`
          );
        } else {
          const thread = await ensureDefaultAgentThread(userId);
          await saveAgentMessage(
            userId,
            thread.id,
            "assistant",
            `Nouveau fil avec ${senderName} reporté — ${convGate.reason}`
          );
        }
        return;
      }
    }
  } catch (err) {
    console.warn("[outreach] gate auto-reply:", err);
  }

  try {
    let reply: string;
    /** RDV oral confirmé : on laisse l'IA envoyer le lien, puis conversion + notif tiers. */
    let pendingAppointmentClose = false;
    let attachFromPromise = false;

    if (isStopRequest(text)) {
      reply = getStopConfirmationReply();
      if (activeCampaign) {
        await stopAutomationTargetForContact(
          userId,
          activeCampaign.id,
          chatId,
          "STOP demandé"
        );
        await incrementAutoStopped(userId, activeCampaign.id);
        try {
          await setContactAutoReply(userId, chatId, false);
        } catch {
          /* best effort */
        }
        await saveAgentMessageForAutomation(
          userId,
          activeCampaign.id,
          "assistant",
          `🛑 STOP demandé par ${senderName} (${chatIdToDisplay(chatId)}) — campagne « ${activeCampaign.name} ». Relances de cette campagne annulées.`
        );
      }
    } else if (text.startsWith("[") && text.includes("reçu")) {
      // Média non interprétable (transcription/vision indisponible ou sticker/vidéo).
      const isVoice = /vocal|audio/i.test(text);
      reply = isVoice
        ? "Merci pour votre vocal ! Je n'ai pas pu l'écouter correctement de mon côté — vous pouvez m'écrire en quelques mots ? 🙂"
        : "Merci ! Vous pouvez m'en dire un mot en texte pour que je vous réponde au mieux ? 🙂";
    } else {
      const settings = await getAppSettings(userId);
      const history = await getContactChatHistory(
        userId,
        chatId,
        20,
        activeCampaign?.id
      );
      const stopReason = shouldStopConversation(
        text,
        {
          offer: settings.business_offer,
          price: settings.business_price,
          ownerName: settings.business_owner_name,
        },
        activeCampaign?.config,
        history
      );

      // unknown_question : ne coupe jamais — l'IA répond (ou reconnaît ne pas savoir).
      const actionableStop =
        stopReason && stopReason !== "unknown_question" ? stopReason : null;

      const unknownRepeat = detectRepeatedUnknownQuestion(
        text,
        history,
        {
          offer: settings.business_offer,
          price: settings.business_price,
          ownerName: settings.business_owner_name,
        },
        activeCampaign?.config
      );
      if (unknownRepeat?.alert && activeCampaign) {
        console.warn(
          `[outreach] unknown-question-repeat topic=${unknownRepeat.topic} n=${unknownRepeat.count} chat=${chatId}`
        );
        if (unknownRepeat.count === 2) {
          await saveAgentMessageForAutomation(
            userId,
            activeCampaign.id,
            "assistant",
            `⚠️ Question sans réponse en config (${unknownRepeat.topic}) — 2 fois de suite ` +
              `(${senderName}, ${chatIdToDisplay(chatId)}). Campagne « ${activeCampaign.name} ». ` +
              `L'IA continue — pas d'arrêt.`
          );
        }
      }

      if (actionableStop && activeCampaign) {
        await stopAutomationTargetForContact(
          userId,
          activeCampaign.id,
          chatId,
          stopReasonLabel(actionableStop)
        );
        await incrementAutoStopped(userId, activeCampaign.id);
        try {
          await setContactAutoReply(userId, chatId, false);
        } catch {
          /* best effort */
        }
        await saveAgentMessageForAutomation(
          userId,
          activeCampaign.id,
          "assistant",
          `⚠️ Prospection arrêtée avec ${senderName} (${chatIdToDisplay(chatId)}) — ${stopReasonLabel(actionableStop)}. Campagne « ${activeCampaign.name} ». Relances annulées.`
        );
        console.log(`🛑 Prospection arrêtée — ${stopReasonLabel(actionableStop)} (${senderName})`);

        // Adieu déjà envoyé + ack court → silence (pas de 2e « Bonne journée »).
        if (shouldSilenceAfterFarewell(text, history)) {
          console.log(`🤫 Silence post-adieu → ${senderName}`);
          return;
        }

        reply = getStopFarewellReply(actionableStop);
        const sent = await sendWhatsAppMessage(userId, chatId, reply, {
          enableAutoReply: false,
          outboundProfile: "auto_reply",
          automationId: activeCampaign.id,
        });
        console.log(`✅ Clôture envoyée → ${senderName} à ${nowFr()} (${sent.idMessage})`);
        return;
      }

      const scoring = await scoreIncomingMessage(userId, text, chatId);
      await recordAutomationEngagement(userId, chatId, text, scoring.interested);
      void refreshContactMemory(userId, chatId, activeCampaign?.id).catch(() => {});

      // Mots-clés handoff configurés → stop IA + passer la main
      const matchedHandoffKw = findMatchingHandoffKeyword(
        text,
        activeCampaign?.config.handoffKeywords
      );
      if (matchedHandoffKw && activeCampaign) {
        await createKeywordHandoff(userId, {
          chatId,
          senderName,
          incomingText: text,
          matchedKeyword: matchedHandoffKw,
          campaignName: activeCampaign.name,
        });
        await cancelPendingSendQueueForRecipient(userId, chatId).catch(() => {});
        await saveAgentMessageForAutomation(
          userId,
          activeCampaign.id,
          "assistant",
          `🙋 Handoff humain — ${senderName} (${chatIdToDisplay(chatId)}) a écrit « ${matchedHandoffKw} ». ` +
            `Campagne « ${activeCampaign.name} ». L'IA s'est arrêtée en silence (rien envoyé au contact) ; ` +
            `reprenez depuis WhatsApp.`
        );
        console.log(
          `🙋 Handoff mot-clé « ${matchedHandoffKw} » → ${senderName} (IA stoppée, pas de msg prospect)`
        );
        // Silence côté client : pas d'annonce de transfert (révèlerait l'IA).
        // Le propriétaire est déjà notifié sur son propre numéro.
        return;
      }

      if (scoring.interested) {
        try {
          await saveContact(userId, {
            phone: chatId,
            status: "interesse",
            autoReply: true,
          });
        } catch {
          /* best effort */
        }
      }

      // Objectif atteint : lien / handoff livraison / preuve paiement + ack → on coupe.
      // PAS un simple prix + « okay » (Support : ça doit faire avancer, pas clôturer).
      if (
        activeCampaign &&
        isCampaignObjectiveReached(text, history, activeCampaign.config)
      ) {
        try {
          await recordAutomationConversion(userId, activeCampaign.id);
          await stopAutomationTargetForContact(
            userId,
            activeCampaign.id,
            chatId,
            "objectif atteint"
          );
        } catch (err) {
          console.error("Erreur conversion:", err);
        }

        // Side-effect isolé : notif tiers (ne doit pas bloquer la clôture).
        void import("./third-party-notification.js")
          .then((m) =>
            m.maybeNotifyThirdPartyOnConversion({
              userId,
              automation: activeCampaign,
              prospectChatId: chatId,
              prospectName: senderName,
            })
          )
          .catch((err) => console.error("Erreur notif tiers:", err));

        // Si l'IA a déjà clôturé à l'oral (« je transmets au livreur… »), silence :
        // pas de 2e « Parfait merci » qui rallonge le fil.
        if (wasVerballyClosed(history)) {
          console.log(
            `✅ Objectif atteint (déjà clôturé à l'oral, silence) → ${senderName}`
          );
          return;
        }

        reply = getObjectiveReachedReply();
        try {
          const typingMs = clampPresenceMs(
            ANTI_BAN.presenceMinMs +
              Math.floor(Math.random() * (ANTI_BAN.presenceMaxMs - ANTI_BAN.presenceMinMs + 1))
          );
          await sendWhatsAppPresence(userId, chatId, "composing", typingMs);
        } catch {
          /* best effort */
        }
        const sent = await sendWhatsAppMessage(userId, chatId, reply, {
          enableAutoReply: false,
          outboundProfile: "auto_reply",
          automationId: activeCampaign.id,
        });
        await incrementMessagesHandled(userId, activeCampaign.id);
        console.log(`✅ Objectif atteint (confirmation) → ${senderName} à ${nowFr()} (${sent.idMessage})`);

        return;
      }

      // Créneau RDV confirmé oralement (ex. « mardi à 14h ») : on continue pour
      // envoyer le lien, puis on convertit + notifie le tiers après l'envoi.
      if (
        activeCampaign &&
        isAppointmentSlotConfirmed(text, history, activeCampaign.config)
      ) {
        pendingAppointmentClose = true;
      }

      const automationContext = await buildAutomationContext(userId, text, chatId, activeCampaign);
      const handoff = await maybeCreateHandoff(userId, {
        chatId,
        senderName,
        incomingText: text,
        scoring,
        automationContext,
      });
      if (handoff) {
        console.log(`🙋 Handoff créé pour ${senderName} (score ${scoring.newScore}) — silence prospect`);
        await cancelPendingSendQueueForRecipient(userId, chatId).catch(() => {});
        if (activeCampaign) {
          await saveAgentMessageForAutomation(
            userId,
            activeCampaign.id,
            "assistant",
            `🙋 Handoff humain — ${senderName} (${chatIdToDisplay(chatId)}). ` +
              `${scoring.handoffReason || "Intervention recommandée"}. ` +
              `L'IA s'est arrêtée en silence ; reprenez depuis WhatsApp.`
          );
        }
        // Pas de réponse au contact : éviter de révéler le transfert / l'IA.
        return;
      }

      reply = await generateWhatsAppReply(userId, {
        chatId,
        senderName,
        incomingText: text,
        automationContext,
        allowEmojis: activeCampaign?.config.stickersEnabled === true,
        automationId: activeCampaign?.id,
        closingLink: activeCampaign?.config.closingLink,
        closingGoal: activeCampaign?.config.closingGoal,
        configuredPrice:
          activeCampaign?.config.price || settings.business_price,
        conversationMode:
          activeCampaign &&
          (activeCampaign.type === "keyword_sales" ||
            activeCampaign.config.mode === "inbound_closing")
            ? "inbound"
            : "outbound",
        toneSources: [
          activeCampaign?.config.initialMessage,
          activeCampaign?.config.conversationGuide,
          activeCampaign?.config.livePlaybook?.openerSnapshot,
        ],
        knownLinkSources: [
          activeCampaign?.config.initialMessage,
          activeCampaign?.config.conversationGuide,
          activeCampaign?.config.closingLink,
          ...(activeCampaign?.config.abVariants?.map((v) => v.message) ?? []),
        ],
      });
      // Silence post-adieu (défense en profondeur si le générateur renvoie vide).
      if (!reply.trim()) {
        console.log(`🤫 Silence (réponse vide) → ${senderName}`);
        return;
      }
      // Filet : oui après offre de lien → URL absente de la réponse LLM → on l'ajoute.
      if (activeCampaign?.config.closingLink) {
        reply = ensurePendingLinkInReply(
          reply,
          activeCampaign.config.closingLink,
          text,
          history
        );
      }
      {
        const { sanitizeInventedCampaignUrls } = await import("./outbound-sanitize.js");
        reply = sanitizeInventedCampaignUrls(reply, {
          allowedLink: activeCampaign?.config.closingLink,
          closingGoal: activeCampaign?.config.closingGoal,
          knownLinkSources: [
            activeCampaign?.config.initialMessage,
            activeCampaign?.config.conversationGuide,
            activeCampaign?.config.closingLink,
            ...(activeCampaign?.config.abVariants?.map((v) => v.message) ?? []),
          ],
        });
      }
      {
        const aligned = alignOutboundVerbalClose(
          reply,
          text,
          history,
          activeCampaign?.config
        );
        if (aligned.premature && activeCampaign) {
          console.warn(`[outreach] premature-verbal-close chat=${chatId}`);
          await saveAgentMessageForAutomation(
            userId,
            activeCampaign.id,
            "assistant",
            `⚠️ Clôture orale sans objectif D — ${senderName} (${chatIdToDisplay(chatId)}). ` +
              `Campagne « ${activeCampaign.name} ». Message recadré, campagne non arrêtée.`
          );
        }
        reply = aligned.reply;
      }
      {
        const promised = fulfillOutboundPromises(reply, {
          closingLink: activeCampaign?.config.closingLink,
          hasMedia: !!activeCampaign?.config.mediaUrl,
        });
        if (promised.appendLink) {
          console.warn(`[outreach] promise-link-fulfilled chat=${chatId}`);
        }
        if (promised.strippedLinkPromise) {
          console.warn(`[outreach] promise-link-stripped chat=${chatId}`);
        }
        if (promised.attachMedia) {
          console.warn(`[outreach] promise-media-attached chat=${chatId}`);
        }
        if (promised.strippedMediaPromise) {
          console.warn(`[outreach] promise-media-stripped chat=${chatId}`);
        }
        if (promised.notes.length && activeCampaign) {
          await saveAgentMessageForAutomation(
            userId,
            activeCampaign.id,
            "assistant",
            promised.notes.join(" ") +
              ` — ${senderName} (${chatIdToDisplay(chatId)}). Campagne « ${activeCampaign.name} ».`
          ).catch(() => {});
        }
        reply = promised.reply;
        attachFromPromise = promised.attachMedia;
      }
    }

    const attachMedia =
      !!activeCampaign?.config.mediaUrl &&
      (prospectRequestsCampaignMedia(text) || attachFromPromise);
    const mediaUrl = attachMedia
      ? resolvePublicMediaUrl(String(activeCampaign!.config.mediaUrl))
      : null;
    const mediaType =
      (activeCampaign?.config.mediaType as "image" | "document" | "audio" | undefined) ||
      "image";

    // Closing entrant : file par vagues (sauf STOP/objectif déjà gérés en immédiat plus haut,
    // et sauf confirmation RDV chaude où on envoie tout de suite).
    const inboundPaced =
      !!activeCampaign &&
      !gate.outboundCampaign &&
      !pendingAppointmentClose &&
      (activeCampaign.type === "keyword_sales" ||
        activeCampaign.config.mode === "inbound_closing");

    if (inboundPaced && activeCampaign) {
      try {
        await cancelPendingSendQueueForRecipient(userId, chatId);
        const sendAt = await computeInboundReplySendAtIso(
          userId,
          activeCampaign.id,
          activeCampaign.config
        );
        const queued = await enqueueSend(userId, {
          recipient: chatId,
          recipientLabel: senderName,
          message: reply,
          ...(mediaUrl
            ? { mediaUrl, mediaType: mediaType === "audio" ? "audio" : mediaType }
            : {}),
          priority: 6,
          sendAt,
          automationId: activeCampaign.id,
          abVariant: INBOUND_REPLY_AB_VARIANT,
        });
        await addAutomationLog(
          userId,
          activeCampaign.id,
          "info",
          `Réponse planifiée pour ${senderName} à ${sendAt} (vague anti-blocage #${queued.id})${
            mediaUrl ? " + média produit" : ""
          }.`
        );
        console.log(
          `📥 Réponse entrante mise en file → ${senderName} à ${sendAt} (queue #${queued.id})`
        );
      } catch (err) {
        console.error(`❌ File réponse entrante échouée pour ${senderName}:`, err);
        // Fallback immédiat pour ne pas perdre la réponse
        try {
          const typingMs = clampPresenceMs(
            ANTI_BAN.presenceMinMs +
              Math.floor(Math.random() * (ANTI_BAN.presenceMaxMs - ANTI_BAN.presenceMinMs + 1))
          );
          await sendWhatsAppPresence(userId, chatId, "composing", typingMs);
        } catch {
          /* best effort */
        }
        if (mediaUrl) {
          await sendWhatsAppMedia(
            userId,
            chatId,
            { url: mediaUrl, type: mediaType === "audio" ? "image" : mediaType, caption: reply },
            { enableAutoReply: false, automationId: activeCampaign.id }
          );
        } else {
    const sent = await sendWhatsAppMessage(userId, chatId, reply, {
      enableAutoReply: false,
            outboundProfile: "auto_reply",
            automationId: activeCampaign.id,
          });
          console.log(`✅ Réponse (fallback immédiat) → ${senderName} (${sent.idMessage})`);
        }
        await incrementMessagesHandled(userId, activeCampaign.id);
      }
      return;
    }

    // Présence « écrit… » juste avant l'envoi (rythme commercial humain).
    try {
      const typingMs = clampPresenceMs(
        ANTI_BAN.presenceMinMs +
          Math.floor(Math.random() * (ANTI_BAN.presenceMaxMs - ANTI_BAN.presenceMinMs + 1))
      );
      await sendWhatsAppPresence(userId, chatId, "composing", typingMs);
    } catch {
      /* best effort — l'envoi suit quand même */
    }

    if (mediaUrl && activeCampaign) {
      await sendWhatsAppMedia(
        userId,
        chatId,
        {
          url: mediaUrl,
          type: mediaType === "audio" ? "image" : mediaType,
          caption: reply,
        },
        { enableAutoReply: false, automationId: activeCampaign.id }
      );
    } else {
      const sent = await sendWhatsAppMessage(userId, chatId, reply, {
        enableAutoReply: false,
        outboundProfile: "auto_reply",
        automationId: activeCampaign?.id ?? null,
    });
    console.log(`✅ Réponse → ${senderName} à ${nowFr()} (${sent.idMessage})`);
    }
    if (activeCampaign) {
      await incrementMessagesHandled(userId, activeCampaign.id);
    }
    if (mediaUrl) {
      console.log(`✅ Réponse + média → ${senderName} à ${nowFr()}`);
    }

    if (pendingAppointmentClose && activeCampaign) {
      try {
        await recordAutomationConversion(userId, activeCampaign.id);
        await stopAutomationTargetForContact(
          userId,
          activeCampaign.id,
          chatId,
          "objectif atteint"
        );
      } catch (err) {
        console.error("Erreur conversion RDV:", err);
      }
      void import("./third-party-notification.js")
        .then((m) =>
          m.maybeNotifyThirdPartyOnConversion({
            userId,
            automation: activeCampaign,
            prospectChatId: chatId,
            prospectName: senderName,
          })
        )
        .catch((err) => console.error("Erreur notif tiers:", err));
      console.log(`✅ RDV confirmé → clôture + notif tiers (${senderName})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Réponse auto échouée pour ${senderName}:`, msg);
    pollHealthFor(userId).lastError = `Auto-reply: ${msg}`;
  }
}

function scheduleAutoReply(userId: number, chatId: string, senderName: string, text: string): void {
  enqueueAutoReply({ userId, chatId, senderName, text }, async (job) => {
    await runAutoReply(job.userId, job.chatId, job.senderName, job.text);
  });
}

async function resolveInboundForStorage(
  userId: number,
  rawChatId: string,
  senderName?: string,
  meta: { senderPn?: string; remoteJidAlt?: string; participant?: string } = {}
): Promise<{ chatId: string; rawLid?: string }> {
  const raw = rawChatId.trim();
  const chatId = await resolveInboundChatId(userId, raw, { ...meta, senderName });
  const rawLid = isLidJid(raw) ? raw : !isLikelyPhoneJid(raw) ? `${raw.replace(/@c\.us$/i, "").replace(/\D/g, "")}@lid` : undefined;
  if (rawLid && isLikelyPhoneJid(chatId)) {
    await setContactWhatsappLid(userId, chatId, rawLid);
  }
  return { chatId, rawLid };
}

async function ingestInboundMessage(
  userId: number,
  rawChatId: string,
  senderName: string,
  text: string,
  greenApiId: string,
  source: "notification" | "history",
  meta: { senderPn?: string; remoteJidAlt?: string; participant?: string } = {}
): Promise<boolean> {
  if (rawChatId.endsWith("@g.us") || !text.trim()) return false;
  if (await whatsAppMessageExists(userId, greenApiId)) return false;

  const { chatId } = await resolveInboundForStorage(userId, rawChatId, senderName, meta);
  if (chatId === "inconnu") return false;

  try {
    // Aligne le pointeur AVANT le tag automation_id (sinon l'entrant part sur une ancienne campagne).
    let automationId: number | null = null;
    const outbound = await findActiveOutboundCampaign(userId, chatId).catch(() => null);
    if (outbound) {
      automationId = outbound.automation.id;
      await setConversationCampaignId(userId, chatId, automationId).catch(() => {});
    } else {
      // Closing entrant : taguer dès le message déclencheur (stats « personnes en discussion »)
      const { findMatchingInboundClosingCampaign, findOngoingClosingConversation } =
        await import("./campaign-gating.js");
      const inbound =
        (await findMatchingInboundClosingCampaign(userId, text).catch(() => null)) ||
        (await findOngoingClosingConversation(userId, chatId).catch(() => null));
      if (inbound) {
        automationId = inbound.id;
        await setConversationCampaignId(userId, chatId, automationId).catch(() => {});
      } else {
        const contact = await getContact(userId, chatId).catch(() => null);
        automationId = contact?.conversation_campaign_id ?? null;
      }
    }

    await saveWhatsAppMessage(userId, {
      contactPhone: chatId,
      direction: "entrant",
      body: text,
      greenApiId,
      senderName,
      automationId,
    });

    try {
      await touchIncomingContact(userId, chatId, senderName);
    } catch (err) {
      console.error("Erreur upsert contact:", err);
    }

    const h = pollHealthFor(userId);
    h.lastIncomingAt = new Date().toISOString();
    if (source === "history") {
      h.syncTotal += 1;
    } else {
      h.processedTotal += 1;
    }

    const tag = source === "history" ? "sync" : "notif";
    console.log(`📩 WhatsApp entrant [${tag}] de ${senderName} → ${chatIdToDisplay(chatId)}: ${text.slice(0, 60)}…`);

    // Compter la réponse prospect dès réception (pas seulement après la réponse IA).
    try {
      await recordAutomationEngagement(userId, chatId, text, false);
    } catch (err) {
      console.error("Erreur stats engagement:", err);
    }

    if (isAutoReplyEligible(text, rawChatId)) {
      scheduleAutoReply(userId, chatId, senderName, text);
    } else {
      console.log(`   ↳ ignoré pour réponse auto (statut/média/broadcast)`);
    }
    return true;
  } catch (err) {
    console.error("Erreur enregistrement message entrant:", err);
    pollHealthFor(userId).lastError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function reprocessPendingAutoRepliesForUser(userId: number): Promise<number> {
  if (!(await isAutoReplyEnabled(userId))) return 0;

  const pending = await findUnansweredInboundMessages(userId, 40);
  let queued = 0;

  for (const msg of pending) {
    let chatId = msg.contact_phone;
    const digits = chatId.replace(/@c\.us|@lid|@s\.whatsapp\.net/gi, "").replace(/\D/g, "");

    if (isLidJid(chatId) || !isLikelyPhoneJid(chatId)) {
      const lid = isLidJid(chatId) ? chatId : `${digits}@lid`;
      const resolved = await findProspectPhoneForLidReply(userId, lid, msg.sender_name ?? undefined);
      if (!resolved) continue;
      chatId = resolved;
      await setContactWhatsappLid(userId, resolved, lid);
    }

    const gate = await passesReplyGate(userId, chatId, msg.body);
    if (!gate.allow) continue;
    if (await hasOutboundReplyAfter(userId, msg.id, chatId, msg.contact_phone)) continue;
    if (!isAutoReplyEligible(msg.body, chatId)) continue;

    const senderName = msg.sender_name || chatIdToDisplay(chatId);
    console.log(`🔄 Relance réponse auto → ${senderName} (${chatIdToDisplay(chatId)})`);
    scheduleAutoReply(userId, chatId, senderName, msg.body);
    queued++;
  }

  if (queued > 0) {
    console.log(`🔄 ${queued} réponse(s) auto remise(s) en file`);
  }
  return queued;
}

async function reprocessPendingAutoReplies(userId?: number): Promise<number> {
  if (typeof userId === "number") {
    return reprocessPendingAutoRepliesForUser(userId);
  }
  const userIds = await listActiveUserIds();
  let queued = 0;
  for (const id of userIds) {
    try {
      queued += await reprocessPendingAutoRepliesForUser(id);
    } catch (err) {
      console.error(`Erreur reprocess auto-reply user ${id}:`, err);
    }
  }
  return queued;
}

export { reprocessPendingAutoReplies };

async function syncIncomingFromHistoryForUser(userId: number): Promise<number> {
  if (webhookIsFresh(pollHealthFor(userId).lastWebhookAt)) {
    return 0;
  }
  const settings = await getAppSettings(userId);
  if (!settings.evolution_api_key || !settings.evolution_instance_name) return 0;
  if (!(await ensureWhatsAppAuthorized(userId))) return 0;

  let added = 0;
  try {
    const items = await getLastIncomingMessages(userId);
    const candidateIds = items
      .map((m) => m.idMessage)
      .filter((id): id is string => Boolean(id));
    const already = await existingWhatsAppMessageIds(userId, candidateIds);
    for (const m of items) {
      if (m.typeMessage === "reactionMessage" || m.typeMessage === "deletedMessage") continue;

      const rawChatId = m.chatId ?? m.senderId ?? "";
      if (!rawChatId || rawChatId.endsWith("@g.us") || isBroadcastOrStatusJid(rawChatId)) continue;

      const greenApiId = m.idMessage;
      if (!greenApiId) continue;
      if (already.has(greenApiId)) continue;

      let text = m.textMessage?.trim() || m.extendedTextMessageData?.text?.trim() || "";

      // Pas de texte → tenter d'interpréter le média (audio/image) avec OpenAI.
      if (!text) {
        const kind = typeMessageToKind(m.typeMessage);
        if (kind) {
          text =
            (await describeInboundMedia(userId, greenApiId, { kind })) ??
            placeholderForKind(kind);
        } else {
          text = placeholderForType(m.typeMessage) ?? "";
        }
      }

      if (!text) continue;

      const senderName = m.senderName || m.senderContactName || chatIdToDisplay(rawChatId);
      if (
        await ingestInboundMessage(userId, rawChatId, senderName, text, greenApiId, "history", {
          senderPn: m.senderPn,
          remoteJidAlt: m.remoteJidAlt,
          participant: m.senderId,
        })
      ) {
        added++;
      }
    }
    if (added > 0) {
      pollHealthFor(userId).lastError = null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pollHealthFor(userId).lastError = `Sync historique: ${msg}`;
    console.error(`❌ Sync lastIncomingMessages (user ${userId}):`, msg);
  }

  return added;
}

export async function syncIncomingFromHistory(): Promise<number> {
  pollerLiveness.lastSyncAt = new Date().toISOString();

  const userIds = await listActiveUserIds();
  let added = 0;
  for (const userId of userIds) {
    try {
    added += await syncIncomingFromHistoryForUser(userId);
    } catch (err) {
      console.error(`❌ Sync historique user ${userId}:`, err instanceof Error ? err.message : err);
    }
  }
  return added;
}

export async function pollOneNotification(): Promise<number> {
  pollerLiveness.lastPollAt = new Date().toISOString();
  return syncIncomingFromHistory();
}

let polling = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startNotificationPoller(intervalMs = 90_000): void {
  if (intervalHandle) return;

  console.log(`🔔 Filet sync Evolution (toutes les ${intervalMs / 1000}s si webhook silencieux)`);
  console.log(`📥 Webhook : POST /api/evolution/webhook (chemin principal)`);
  console.log(`📦 Conversations prospects → PostgreSQL, pas le chat agent (multi-tenant)`);

  void syncIncomingFromHistory();
  void reprocessPendingAutoReplies();

  intervalHandle = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await pollOneNotification();
    } catch (err) {
      console.error("Erreur sync Evolution API:", err);
    } finally {
      polling = false;
    }
  }, intervalMs);
}

export function stopNotificationPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
