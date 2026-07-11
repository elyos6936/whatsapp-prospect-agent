import {
  chatIdToDisplay,
  chatIdsMatch,
  isLikelyPhoneJid,
  isLidJid,
  resolveInboundChatId,
  sendWhatsAppMessage,
  testEvolutionConnection,
  getLastIncomingMessages,
} from "./evolutionapi.js";
import {
  getAppSettings,
  saveWhatsAppMessage,
  whatsAppMessageExists,
  isAutoReplyEnabled,
  shouldAutoReplyContact,
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
  findProspectPhoneForLidReply,
  findUnansweredInboundMessages,
  hasOutboundReplyAfter,
  setContactWhatsappLid,
} from "./db.js";
import { scoreIncomingMessage } from "./lead-scoring.js";
import { recordAbReply } from "./ab-testing.js";
import { refreshContactMemory, getMemoryContextBlock } from "./contact-memory.js";
import { maybeCreateHandoff } from "./handoff.js";
import {
  generateWhatsAppReply,
  getAdaptiveReplyDelay,
  getStopConfirmationReply,
  isPromptInjection,
  isStopRequest,
  nowFr,
} from "./whatsapp-reply.js";

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

/** Webhook Evolution API — MESSAGES_UPSERT */
export async function handleEvolutionWebhook(payload: unknown): Promise<number> {
  if (!payload || typeof payload !== "object") return 0;
  const body = payload as Record<string, unknown>;
  const event = String(body.event ?? body.type ?? "").toUpperCase();
  if (!event.includes("MESSAGES_UPSERT") && !event.includes("MESSAGES.UPSERT")) return 0;

  const data = body.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];
  let processed = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = row.key as { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string } | undefined;
    if (!key || key.fromMe) continue;

    const rawChatId = key.remoteJid ?? "";
    if (isBroadcastOrStatusJid(rawChatId)) continue;

    const text = extractEvolutionInboundText(row.message);
    if (!text) continue;

    if (rawChatId.endsWith("@g.us")) {
      const senderName = String(row.pushName ?? chatIdToDisplay(rawChatId));
      void runGroupAutoReply(rawChatId, senderName, text);
      continue;
    }

    const keyExtra = key as { senderPn?: string; remoteJidAlt?: string; participant?: string };
    const chatId = await resolveInboundChatId(rawChatId, {
      senderPn: keyExtra.senderPn,
      remoteJidAlt: keyExtra.remoteJidAlt,
      participant: keyExtra.participant,
      senderName: String(row.pushName ?? ""),
    });
    const msgId = key.id ?? `evo-${Date.now()}`;
    const senderName = String(row.pushName ?? chatIdToDisplay(chatId));
    if (await ingestInboundMessage(chatId, senderName, text, msgId, "notification")) {
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

const pollHealth: WhatsappPollHealth = {
  lastPollAt: null,
  lastSyncAt: null,
  lastIncomingAt: null,
  lastError: null,
  webhookBlocked: false,
  authorized: true,
  processedTotal: 0,
  syncTotal: 0,
};

export function getWhatsappPollHealth(): WhatsappPollHealth {
  return { ...pollHealth };
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
  if (trimmed.startsWith("[") && /reçu|reçue|Message vocal|Image|Vidéo|Document|Sticker|Audio|Photo|Video/i.test(trimmed)) {
    return false;
  }
  return true;
}

const pendingReplyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingReplyPayloads = new Map<string, { senderName: string; text: string }>();

let lastAuthCheckMs = 0;
let lastAuthOk = true;

async function ensureWhatsAppAuthorized(): Promise<boolean> {
  const now = Date.now();
  if (now - lastAuthCheckMs < 30_000) return lastAuthOk;
  lastAuthCheckMs = now;
  try {
    const state = await testEvolutionConnection();
    lastAuthOk = state.connected;
    pollHealth.authorized = lastAuthOk;
    if (!lastAuthOk) {
      pollHealth.lastError = state.message;
    }
  } catch (err) {
    lastAuthOk = false;
    pollHealth.authorized = false;
    pollHealth.lastError = err instanceof Error ? err.message : String(err);
  }
  return lastAuthOk;
}

function findAutomationTarget(
  targets: Array<{ target_id: string; ab_variant?: string | null }>,
  chatId: string
) {
  return targets.find((t) => chatIdsMatch(t.target_id, chatId));
}

async function recordAutomationEngagement(
  chatId: string,
  text: string,
  interested: boolean
): Promise<void> {
  const followups = (await listActiveAutomations()).filter(
    (a) => a.type === "group_prospect" || a.type === "custom_followup"
  );
  for (const auto of followups) {
    const targets = await listAutomationTargets(auto.id, { limit: 500 });
    const target = findAutomationTarget(targets, chatId);
    if (auto.type === "group_prospect" && !target) continue;
    if (target) {
      await updateAutomationTarget(auto.id, target.target_id, {
        status: interested ? "interested" : "replied",
      });
      if (target.ab_variant) {
        await recordAbReply(auto.id, target.ab_variant, interested);
      }
    }
  }
  void text;
}

async function buildAutomationContext(text: string, chatId: string): Promise<string | undefined> {
  const parts: string[] = [];
  const memory = await getMemoryContextBlock(chatId);
  if (memory) parts.push(memory);

  const contact = await getContact(chatId);
  if (contact && contact.lead_score > 0) {
    parts.push(`Score prospect : ${contact.lead_score}/100`);
  }

  const keywordAutos = await findMatchingKeywordAutomations(text);
  for (const auto of keywordAutos) {
    const lines = [
      `Automatisation « ${auto.name} » (vente sur mots-clés)`,
      auto.config.productName ? `Produit : ${auto.config.productName}` : "",
      auto.config.price ? `Prix : ${auto.config.price}` : "",
      auto.config.salesScript ? `Script : ${auto.config.salesScript}` : "",
      auto.config.conversationGuide ? `Consignes : ${auto.config.conversationGuide}` : "",
    ].filter(Boolean);
    parts.push(lines.join("\n"));
    await addAutomationLog(auto.id, "info", `Message entrant déclencheur de ${chatIdToDisplay(chatId)}`);
    const stats = auto.stats;
    await updateAutomationStats(auto.id, {
      messagesHandled: (stats.messagesHandled ?? 0) + 1,
      lastActionAt: new Date().toISOString(),
    });
  }

  const followups = (await listActiveAutomations()).filter(
    (a) => a.type === "group_prospect" || a.type === "custom_followup"
  );
  for (const auto of followups) {
    const targets = await listAutomationTargets(auto.id, { limit: 500 });
    const target = findAutomationTarget(targets, chatId);
    if (auto.type === "group_prospect" && !target) continue;
    if (auto.config.conversationGuide) {
      parts.push(
        `Automatisation « ${auto.name} » (${auto.type}) — consignes : ${auto.config.conversationGuide}`
      );
    }
  }

  return parts.length ? parts.join("\n\n") : undefined;
}

async function runGroupAutoReply(
  groupId: string,
  senderName: string,
  text: string
): Promise<void> {
  const rule = await findGroupReplyRule(groupId, text);
  if (!rule) return;

  const automationContext = rule.reply_guide
    ? `Réponse dans le groupe « ${rule.group_label || groupId} » — consignes : ${rule.reply_guide}`
    : undefined;

  try {
    const reply = await generateWhatsAppReply({
      chatId: groupId,
      senderName,
      incomingText: text,
      automationContext,
    });
    await sendWhatsAppMessage(groupId, reply, { enableAutoReply: false });
    console.log(`✅ Réponse groupe → ${rule.group_label || groupId}`);
  } catch (err) {
    console.error("❌ Réponse groupe échouée:", err);
  }
}

async function runAutoReply(chatId: string, senderName: string, text: string): Promise<void> {
  if (!(await shouldAutoReplyContact(chatId))) {
    const reason = (await isContactBlocked(chatId))
      ? "STOP"
      : !(await isAutoReplyEnabled())
        ? "auto globale OFF"
        : "auto contact OFF";
    console.log(`📩 ${senderName} (pas de réponse — ${reason}): ${text.slice(0, 40)}`);
    return;
  }

  if (isPromptInjection(text)) {
    console.warn(`⚠️ Injection détectée de ${senderName} — ignorée`);
    return;
  }

  try {
    let reply: string;

    if (isStopRequest(text)) {
      reply = getStopConfirmationReply();
      await blockContact(chatId);
    } else if (text.startsWith("[") && text.includes("reçu")) {
      reply =
        "Merci pour votre message ! Pour que je puisse vous répondre précisément, pourriez-vous m'écrire votre question en texte ? 🙂";
    } else {
      const scoring = await scoreIncomingMessage(text, chatId);
      await recordAutomationEngagement(chatId, text, scoring.interested);
      void refreshContactMemory(chatId).catch(() => {});

      const automationContext = await buildAutomationContext(text, chatId);
      const handoff = await maybeCreateHandoff({
        chatId,
        senderName,
        incomingText: text,
        scoring,
        automationContext,
      });
      if (handoff) {
        console.log(`🙋 Handoff créé pour ${senderName} (score ${scoring.newScore})`);
      }

      reply = await generateWhatsAppReply({
        chatId,
        senderName,
        incomingText: text,
        automationContext,
      });
    }

    const sent = await sendWhatsAppMessage(chatId, reply, {
      enableAutoReply: false,
      countsTowardQuota: false,
    });
    console.log(`✅ Réponse → ${senderName} à ${nowFr()} (${sent.idMessage})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Réponse auto échouée pour ${senderName}:`, msg);
    pollHealth.lastError = `Auto-reply: ${msg}`;
  }
}

function scheduleAutoReply(chatId: string, senderName: string, text: string): void {
  pendingReplyPayloads.set(chatId, { senderName, text });
  const existing = pendingReplyTimers.get(chatId);
  if (existing) clearTimeout(existing);

  void (async () => {
    const delay = await getAdaptiveReplyDelay(chatId);
    console.log(`⏳ Réponse auto à ${senderName} dans ${Math.round(delay / 1000)}s…`);

    const timer = setTimeout(() => {
      pendingReplyTimers.delete(chatId);
      const payload = pendingReplyPayloads.get(chatId);
      pendingReplyPayloads.delete(chatId);
      if (!payload) return;
      void runAutoReply(chatId, payload.senderName, payload.text);
    }, delay);

    pendingReplyTimers.set(chatId, timer);
  })();
}

async function resolveInboundForStorage(
  rawChatId: string,
  senderName?: string,
  meta: { senderPn?: string; remoteJidAlt?: string; participant?: string } = {}
): Promise<{ chatId: string; rawLid?: string }> {
  const raw = rawChatId.trim();
  const chatId = await resolveInboundChatId(raw, { ...meta, senderName });
  const rawLid = isLidJid(raw) ? raw : !isLikelyPhoneJid(raw) ? `${raw.replace(/@c\.us$/i, "").replace(/\D/g, "")}@lid` : undefined;
  if (rawLid && isLikelyPhoneJid(chatId)) {
    await setContactWhatsappLid(chatId, rawLid);
  }
  return { chatId, rawLid };
}

async function ingestInboundMessage(
  rawChatId: string,
  senderName: string,
  text: string,
  greenApiId: string,
  source: "notification" | "history",
  meta: { senderPn?: string; remoteJidAlt?: string; participant?: string } = {}
): Promise<boolean> {
  if (rawChatId.endsWith("@g.us") || !text.trim()) return false;
  if (await whatsAppMessageExists(greenApiId)) return false;

  const { chatId } = await resolveInboundForStorage(rawChatId, senderName, meta);
  if (chatId === "inconnu") return false;

  try {
    await saveWhatsAppMessage({
      contactPhone: chatId,
      direction: "entrant",
      body: text,
      greenApiId,
      senderName,
    });

    try {
      await touchIncomingContact(chatId, senderName);
    } catch (err) {
      console.error("Erreur upsert contact:", err);
    }

    pollHealth.lastIncomingAt = new Date().toISOString();
    if (source === "history") {
      pollHealth.syncTotal += 1;
    } else {
      pollHealth.processedTotal += 1;
    }

    const tag = source === "history" ? "sync" : "notif";
    console.log(`📩 WhatsApp entrant [${tag}] de ${senderName} → ${chatIdToDisplay(chatId)}: ${text.slice(0, 60)}…`);

    if (isAutoReplyEligible(text, rawChatId)) {
      scheduleAutoReply(chatId, senderName, text);
    } else {
      console.log(`   ↳ ignoré pour réponse auto (statut/média/broadcast)`);
    }
    return true;
  } catch (err) {
    console.error("Erreur enregistrement message entrant:", err);
    pollHealth.lastError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function reprocessPendingAutoReplies(): Promise<number> {
  if (!(await isAutoReplyEnabled())) return 0;

  const pending = await findUnansweredInboundMessages(40);
  let queued = 0;

  for (const msg of pending) {
    let chatId = msg.contact_phone;
    const digits = chatId.replace(/@c\.us|@lid|@s\.whatsapp\.net/gi, "").replace(/\D/g, "");

    if (isLidJid(chatId) || !isLikelyPhoneJid(chatId)) {
      const lid = isLidJid(chatId) ? chatId : `${digits}@lid`;
      const resolved = await findProspectPhoneForLidReply(lid, msg.sender_name ?? undefined);
      if (!resolved) continue;
      chatId = resolved;
      await setContactWhatsappLid(resolved, lid);
    }

    if (!(await shouldAutoReplyContact(chatId))) continue;
    if (await hasOutboundReplyAfter(msg.id, chatId, msg.contact_phone)) continue;
    if (!isAutoReplyEligible(msg.body, chatId)) continue;

    const senderName = msg.sender_name || chatIdToDisplay(chatId);
    console.log(`🔄 Relance réponse auto → ${senderName} (${chatIdToDisplay(chatId)})`);
    scheduleAutoReply(chatId, senderName, msg.body);
    queued++;
  }

  if (queued > 0) {
    console.log(`🔄 ${queued} réponse(s) auto remise(s) en file`);
  }
  return queued;
}

export { reprocessPendingAutoReplies };

export async function syncIncomingFromHistory(): Promise<number> {
  pollHealth.lastSyncAt = new Date().toISOString();

  const settings = await getAppSettings();
  if (!settings.evolution_api_key || !settings.evolution_instance_name) return 0;
  if (!(await ensureWhatsAppAuthorized())) return 0;

  let added = 0;
  try {
    const items = await getLastIncomingMessages();
    for (const m of items) {
      if (m.typeMessage === "reactionMessage" || m.typeMessage === "deletedMessage") continue;

      const rawChatId = m.chatId ?? m.senderId ?? "";
      if (!rawChatId || rawChatId.endsWith("@g.us") || isBroadcastOrStatusJid(rawChatId)) continue;

      const text =
        m.textMessage?.trim() ||
        m.extendedTextMessageData?.text?.trim() ||
        placeholderForType(m.typeMessage);
      if (!text) continue;

      const greenApiId = m.idMessage;
      if (!greenApiId) continue;

      const senderName = m.senderName || m.senderContactName || chatIdToDisplay(rawChatId);
      if (
        await ingestInboundMessage(rawChatId, senderName, text, greenApiId, "history", {
          senderPn: m.senderPn,
          remoteJidAlt: m.remoteJidAlt,
          participant: m.senderId,
        })
      ) {
        added++;
      }
    }
    if (added > 0) {
      pollHealth.lastError = null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pollHealth.lastError = `Sync historique: ${msg}`;
    console.error("❌ Sync lastIncomingMessages:", msg);
  }

  return added;
}

export async function pollOneNotification(): Promise<number> {
  pollHealth.lastPollAt = new Date().toISOString();
  return syncIncomingFromHistory();
}

let polling = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let syncTick = 0;

export function startNotificationPoller(intervalMs = 3000): void {
  if (intervalHandle) return;

  console.log(`🔔 Sync messages entrants Evolution API (toutes les ${intervalMs / 1000}s)`);
  console.log(`📥 Webhook : POST /api/evolution/webhook (recommandé en production)`);
  void (async () => {
    const enabled = await isAutoReplyEnabled();
    console.log(`🤖 Réponses automatiques : ${enabled ? "activées" : "DÉSACTIVÉES — activez le toggle dans l'interface"}`);
    console.log(`📦 Conversations prospects → PostgreSQL, pas le chat agent`);

    if (!enabled) {
      console.warn(`⚠️  Réponses auto OFF : les messages entrants seront reçus mais pas de réponse automatique.`);
    }
  })();

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
      pollHealth.lastError = err instanceof Error ? err.message : String(err);
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
