import {
  chatIdToDisplay,
  chatIdsMatch,
  isLikelyPhoneJid,
  isLidJid,
  resolveInboundChatId,
  sendWhatsAppMessage,
  testEvolutionConnection,
  getLastIncomingMessages,
  normalizeGroupParticipantId,
} from "./evolutionapi.js";
import {
  getAppSettings,
  saveWhatsAppMessage,
  whatsAppMessageExists,
  isAutoReplyEnabled,
  isContactBlocked,
  blockContact,
  touchIncomingContact,
  findMatchingKeywordAutomations,
  listActiveAutomations,
  listAutomationTargets,
  findGroupReplyRule,
  addAutomationLog,
  updateAutomationStats,
  updateAutomationTarget,
  getContact,
  getContactChatHistory,
  findProspectPhoneForLidReply,
  findUnansweredInboundMessages,
  hasOutboundReplyAfter,
  setContactWhatsappLid,
  saveAgentMessage,
  setContactAutoReply,
  incrementAutoStopped,
  incrementMessagesHandled,
  cancelSequencesForContact,
} from "./db.js";
import { userIdFromInstanceName, listActiveUserIds } from "./users.js";
import { scoreIncomingMessage } from "./lead-scoring.js";
import { recordAbReply } from "./ab-testing.js";
import { refreshContactMemory, getMemoryContextBlock } from "./contact-memory.js";
import { maybeCreateHandoff } from "./handoff.js";
import { passesReplyGate, findActiveOutboundCampaign } from "./campaign-gating.js";
import {
  detectInboundMedia,
  describeInboundMedia,
  placeholderForKind,
  typeMessageToKind,
} from "./media-understanding.js";
import {
  generateWhatsAppReply,
  getAdaptiveReplyDelay,
  getStopConfirmationReply,
  isPromptInjection,
  isStopRequest,
  nowFr,
} from "./whatsapp-reply.js";
import { shouldStopConversation, stopReasonLabel, getStopFarewellReply } from "./stop-policy.js";
import type { Automation } from "./db.js";

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
  const isGroup =
    event.includes("GROUPS_UPSERT") ||
    event.includes("GROUP_UPDATE") ||
    event.includes("GROUP_PARTICIPANTS");
  if (!isUpsert && !isUpdate && !isPresence && !isGroup) return 0;

  const instance = String(body.instance ?? body.instanceName ?? "");
  const userId = await userIdFromInstanceName(instance);
  if (!userId) {
    console.warn(`⚠️ Webhook Evolution ignoré — instance inconnue « ${instance} »`);
    return 0;
  }

  const data = body.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];

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

    const keyExtra = key as { senderPn?: string; remoteJidAlt?: string; participant?: string };
    const chatId = await resolveInboundChatId(userId, rawChatId, {
      senderPn: keyExtra.senderPn,
      remoteJidAlt: keyExtra.remoteJidAlt,
      participant: keyExtra.participant,
      senderName: String(row.pushName ?? ""),
    });
    const msgId = key.id ?? `evo-${Date.now()}`;
    const senderName = String(row.pushName ?? chatIdToDisplay(chatId));
    if (await ingestInboundMessage(userId, chatId, senderName, text, msgId, "notification")) {
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
    lastError: null,
    webhookBlocked: false,
    authorized: true,
    processedTotal: 0,
    syncTotal: 0,
  };
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

const pendingReplyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingReplyPayloads = new Map<string, { userId: number; senderName: string; text: string }>();

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

function findAutomationTarget(
  targets: Array<{ target_id: string; status?: string; ab_variant?: string | null }>,
  chatId: string
) {
  return targets.find((t) => chatIdsMatch(t.target_id, chatId));
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
    const targets = await listAutomationTargets(userId, auto.id, { limit: 2000 });
    const target = findAutomationTarget(targets, chatId);
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

function buildActiveCampaignContext(auto: Automation): string {
  const cfg = auto.config;
  const goalLabels: Record<string, string> = {
    payment: "obtenir le paiement",
    delivery: "organiser la livraison",
    link: "envoyer un lien",
    appointment: "fixer un rendez-vous",
  };
  const goal = cfg.closingGoal ? goalLabels[cfg.closingGoal] ?? cfg.closingGoal : "engager le prospect vers une action concrète";

  const lines = [
    `=== CAMPAGNE ACTIVE : « ${auto.name} » (#${auto.id}) ===`,
    `Type : ${auto.type}`,
    `Objectif de la campagne : ${goal}`,
    cfg.initialMessage ? `Premier message déjà envoyé au prospect : « ${cfg.initialMessage} »` : "",
    cfg.conversationGuide
      ? `TON & APPROCHE (suis à la lettre, c'est le cœur de la campagne) :\n${cfg.conversationGuide}`
      : "",
    cfg.productName ? `Produit / offre : ${cfg.productName}` : "",
    cfg.price
      ? `Prix EXACT à citer si demandé : ${cfg.price}`
      : `Prix : NON RENSEIGNÉ — si on te demande le prix, dis que tu confirmes juste après. JAMAIS écrire [prix].`,
    cfg.closingLink
      ? `Lien à envoyer au prospect (URL réelle) : ${cfg.closingLink}`
      : "",
    cfg.salesScript ? `Argumentaire : ${cfg.salesScript}` : "",
    `RÈGLES DE RÉPONSE : messages COURTS (1-2 phrases max), ton WhatsApp naturel, va droit au but selon l'objectif. Ne re-pitche pas. Ne te re-présente pas. AUCUN texte entre crochets [ ].`,
  ].filter(Boolean);
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
    parts.push(buildActiveCampaignContext(activeCampaign));
  }

  const memory = await getMemoryContextBlock(userId, chatId);
  if (memory) parts.push(memory);

  const contact = await getContact(userId, chatId);
  if (contact && contact.lead_score > 0) {
    parts.push(`Score prospect : ${contact.lead_score}/100`);
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
      const targets = await listAutomationTargets(userId, auto.id, { limit: 500 });
      const target = findAutomationTarget(targets, chatId);
      if ((auto.type === "group_prospect" || auto.type === "contact_prospect") && !target) continue;
      if (auto.config.conversationGuide) {
        parts.push(buildActiveCampaignContext(auto));
      }
    }
  }

  return parts.length ? parts.join("\n\n") : undefined;
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
  if (await isContactBlocked(userId, chatId)) {
    console.log(`📩 ${senderName} (pas de réponse — STOP): ${text.slice(0, 40)}`);
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

  try {
    let reply: string;

    if (isStopRequest(text)) {
      reply = getStopConfirmationReply();
      await blockContact(userId, chatId);
      if (activeCampaign) {
        const targets = await listAutomationTargets(userId, activeCampaign.id, { limit: 500 });
        const target = findAutomationTarget(targets, chatId);
        if (target) {
          await updateAutomationTarget(userId, activeCampaign.id, target.target_id, { status: "stopped" });
        }
        await cancelSequencesForContact(userId, chatId);
      }
    } else if (text.startsWith("[") && text.includes("reçu")) {
      // Média non interprétable (transcription/vision indisponible ou sticker/vidéo).
      const isVoice = /vocal|audio/i.test(text);
      reply = isVoice
        ? "Merci pour ton vocal ! Je n'ai pas pu l'écouter correctement de mon côté — tu peux m'écrire en quelques mots ? 🙂"
        : "Merci ! Tu peux m'en dire un mot en texte pour que je te réponde au mieux ? 🙂";
    } else {
      const settings = await getAppSettings(userId);
      const history = await getContactChatHistory(userId, chatId, 20);
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

      if (stopReason && activeCampaign) {
        reply = getStopFarewellReply(stopReason);
        await blockContact(userId, chatId);
        await setContactAutoReply(userId, chatId, false);
        const targets = await listAutomationTargets(userId, activeCampaign.id, { limit: 500 });
        const target = findAutomationTarget(targets, chatId);
        if (target) {
          await updateAutomationTarget(userId, activeCampaign.id, target.target_id, {
            status: "stopped",
            notes: stopReasonLabel(stopReason),
          });
        }
        await cancelSequencesForContact(userId, chatId);
        await incrementAutoStopped(userId, activeCampaign.id);
        await saveAgentMessage(
          userId,
          "assistant",
          `⚠️ Prospection arrêtée avec ${senderName} (${chatIdToDisplay(chatId)}) — ${stopReasonLabel(stopReason)}. Campagne « ${activeCampaign.name} » (#${activeCampaign.id}). Relances annulées.`
        );
        console.log(`🛑 Prospection arrêtée — ${stopReasonLabel(stopReason)} (${senderName})`);

        const sent = await sendWhatsAppMessage(userId, chatId, reply, {
          enableAutoReply: false,
          countsTowardQuota: false,
        });
        console.log(`✅ Clôture envoyée → ${senderName} à ${nowFr()} (${sent.idMessage})`);
        return;
      }

      const scoring = await scoreIncomingMessage(userId, text, chatId);
      await recordAutomationEngagement(userId, chatId, text, scoring.interested);
      void refreshContactMemory(userId, chatId).catch(() => {});

      const automationContext = await buildAutomationContext(userId, text, chatId, activeCampaign);
      const handoff = await maybeCreateHandoff(userId, {
        chatId,
        senderName,
        incomingText: text,
        scoring,
        automationContext,
      });
      if (handoff) {
        console.log(`🙋 Handoff créé pour ${senderName} (score ${scoring.newScore})`);
      }

      reply = await generateWhatsAppReply(userId, {
        chatId,
        senderName,
        incomingText: text,
        automationContext,
      });
    }

    const sent = await sendWhatsAppMessage(userId, chatId, reply, {
      enableAutoReply: false,
      countsTowardQuota: false,
    });
    if (activeCampaign) {
      await incrementMessagesHandled(userId, activeCampaign.id);
    }
    console.log(`✅ Réponse → ${senderName} à ${nowFr()} (${sent.idMessage})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Réponse auto échouée pour ${senderName}:`, msg);
    pollHealthFor(userId).lastError = `Auto-reply: ${msg}`;
  }
}

function scheduleAutoReply(userId: number, chatId: string, senderName: string, text: string): void {
  const timerKey = `${userId}:${chatId}`;
  pendingReplyPayloads.set(timerKey, { userId, senderName, text });
  const existing = pendingReplyTimers.get(timerKey);
  if (existing) clearTimeout(existing);

  void (async () => {
    const delay = await getAdaptiveReplyDelay(userId, chatId);
    console.log(`⏳ Réponse auto à ${senderName} dans ${Math.round(delay / 1000)}s…`);

    const timer = setTimeout(() => {
      pendingReplyTimers.delete(timerKey);
      const payload = pendingReplyPayloads.get(timerKey);
      pendingReplyPayloads.delete(timerKey);
      if (!payload) return;
      void runAutoReply(payload.userId, chatId, payload.senderName, payload.text);
    }, delay);

    pendingReplyTimers.set(timerKey, timer);
  })();
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
    await saveWhatsAppMessage(userId, {
      contactPhone: chatId,
      direction: "entrant",
      body: text,
      greenApiId,
      senderName,
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
  const settings = await getAppSettings(userId);
  if (!settings.evolution_api_key || !settings.evolution_instance_name) return 0;
  if (!(await ensureWhatsAppAuthorized(userId))) return 0;

  let added = 0;
  try {
    const items = await getLastIncomingMessages(userId);
    for (const m of items) {
      if (m.typeMessage === "reactionMessage" || m.typeMessage === "deletedMessage") continue;

      const rawChatId = m.chatId ?? m.senderId ?? "";
      if (!rawChatId || rawChatId.endsWith("@g.us") || isBroadcastOrStatusJid(rawChatId)) continue;

      const greenApiId = m.idMessage;
      if (!greenApiId) continue;

      let text = m.textMessage?.trim() || m.extendedTextMessageData?.text?.trim() || "";

      // Pas de texte → tenter d'interpréter le média (audio/image) avec OpenAI.
      if (!text) {
        const kind = typeMessageToKind(m.typeMessage);
        if (kind) {
          // Vérification avant appel OpenAI pour éviter les doublons coûteux.
          const alreadyStored = await whatsAppMessageExists(userId, greenApiId);
          text = alreadyStored
            ? placeholderForKind(kind)
            : (await describeInboundMedia(userId, greenApiId, { kind })) ?? placeholderForKind(kind);
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
let syncTick = 0;

export function startNotificationPoller(intervalMs = 3000): void {
  if (intervalHandle) return;

  console.log(`🔔 Sync messages entrants Evolution API (toutes les ${intervalMs / 1000}s)`);
  console.log(`📥 Webhook : POST /api/evolution/webhook (recommandé en production)`);
  console.log(`📦 Conversations prospects → PostgreSQL, pas le chat agent (multi-tenant)`);

  void syncIncomingFromHistory();
  void reprocessPendingAutoReplies();

  intervalHandle = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      for (let i = 0; i < 4; i++) {
        const n = await pollOneNotification();
        if (n === 0) break;
      }
      syncTick += 1;
      if (syncTick % 2 === 0) {
        await syncIncomingFromHistory();
      }
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
