import {
  addAutomationLog,
  cancelPendingSendQueue,
  canStartNewConversation,
  classifyNewConversationKind,
  claimDueQueueItems,
  ensureDefaultAgentThread,
  formatLocalDateTime,
  getAutomation,
  isStartingNewConversation,
  hasInboundInCampaignEpoch,
  markQueueCancelled,
  markQueueFailed,
  markQueueSent,
  rescheduleSendQueueItem,
  saveAgentMessage,
  incrementMessagesHandled,
  listPendingSendQueueForAutomation,
  type QueueItem,
} from "./db.js";
import { chatIdToDisplay, sendWhatsAppMedia, sendWhatsAppMessage } from "./evolutionapi.js";
import { shouldBlockOutboundWhileAwaitingReply } from "./outbound-safety.js";
import { INBOUND_REPLY_AB_VARIANT } from "./inbound-reply-batch.js";
import { listActiveUserIds } from "./users.js";
import { recordWorkerTick } from "./observability.js";
import {
  isWithinQuietHours,
  resolveOutboundQuietHours,
  type QuietHours,
} from "./quiet-hours.js";

/** Priorité « urgence manuelle » uniquement — les openers campagne NE bypassent PLUS les quiet hours. */
const QUIET_BYPASS_MIN_PRIORITY = 10;

let queueRunning = false;

function bypassQuietHours(item: QueueItem): boolean {
  return (item.priority ?? 0) >= QUIET_BYPASS_MIN_PRIORITY;
}

async function quietHoursForItem(userId: number, item: QueueItem): Promise<QuietHours> {
  if (!item.automation_id) {
    return resolveOutboundQuietHours(22, 7);
  }
  try {
    const auto = await getAutomation(userId, item.automation_id);
    return resolveOutboundQuietHours(
      auto?.config.quietHoursStart,
      auto?.config.quietHoursEnd
    );
  } catch {
    return resolveOutboundQuietHours(22, 7);
  }
}

function tomorrowMorningLocal(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(8, 30, 0, 0);
  return formatLocalDateTime(next);
}

async function rescheduleQuiet(
  userId: number,
  item: QueueItem,
  quietEndHour: number
): Promise<void> {
  const next = new Date();
  const hour = new Date().getHours();
  if (hour >= quietEndHour) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(quietEndHour, 30, 0, 0);
  const when = formatLocalDateTime(next);
  await rescheduleSendQueueItem(userId, item.id, when);
  const label = item.recipient_label || chatIdToDisplay(item.recipient);
  console.log(`🌙 Queue #${item.id} → ${label} reporté à ${when} (heures calmes)`);
  if (item.automation_id) {
    await addAutomationLog(
      userId,
      item.automation_id,
      "info",
      `Envoi à ${label} reporté à ${when} (hors fenêtre d'envoi).`
    );
  }
}

async function rescheduleDailyQuota(
  userId: number,
  item: QueueItem,
  reason: string
): Promise<void> {
  const when = tomorrowMorningLocal();
  await rescheduleSendQueueItem(userId, item.id, when);
  const label = item.recipient_label || chatIdToDisplay(item.recipient);
  console.log(`📅 Queue #${item.id} → ${label} reporté à ${when} (plafond nouveaux fils)`);
  if (item.automation_id) {
    await addAutomationLog(userId, item.automation_id, "info", reason);
  }
  try {
    const thread = await ensureDefaultAgentThread(userId);
    await saveAgentMessage(
      userId,
      thread.id,
      "assistant",
      `Nouveau fil reporté à demain pour ${label} — plafond du jour atteint. Les conversations déjà ouvertes continuent normalement.`
    );
  } catch {
    /* best effort */
  }
}

async function processSendQueueForUser(userId: number, limit: number): Promise<number> {
  let sent = 0;
  const items = await claimDueQueueItems(userId, limit);

  for (const item of items) {
    const quiet = await quietHoursForItem(userId, item);
    if (isWithinQuietHours(quiet) && !bypassQuietHours(item)) {
      await rescheduleQuiet(userId, item, quiet.end);
      continue;
    }

    const isInboundReply = item.ab_variant === INBOUND_REPLY_AB_VARIANT;
    const isGroupOrChannel =
      item.recipient.endsWith("@g.us") || item.recipient.includes("@newsletter");
    const isGroupFollowUp =
      isGroupOrChannel &&
      typeof item.ab_variant === "string" &&
      item.ab_variant.startsWith("group-d");
    // Opener campagne = toujours un nouveau fil (époque fraîche juste avant envoi)
    // Diffusion groupe / posts planifiés : pas un « opener contact »
    const isCampaignOpener =
      item.automation_id != null &&
      item.sequence_id == null &&
      !isInboundReply &&
      !isGroupOrChannel;

    // Skip si le prospect a déjà reçu une réponse entre-temps (closing entrant)
    if (isInboundReply) {
      const { isAwaitingProspectReply } = await import("./outbound-safety.js");
      const alreadyReplied = await isAwaitingProspectReply(
        userId,
        item.recipient,
        item.automation_id
      );
      if (alreadyReplied) {
        const label = item.recipient_label || chatIdToDisplay(item.recipient);
        await markQueueCancelled(userId, item.id, "Déjà répondu — doublon évité");
        console.warn(`⏭️ Queue #${item.id} ignorée (${label}) — réponse déjà partie`);
        if (item.automation_id) {
          await addAutomationLog(
            userId,
            item.automation_id,
            "info",
            `Doublon évité pour ${label} — une réponse était déjà partie.`
          );
        }
        continue;
      }
    }

    // Garde-fou : opener déjà en base (autre worker a envoyé entre-temps)
    // OU prospect a déjà écrit dans ce fil campagne → ne pas coller un cold opener par-dessus
    if (isCampaignOpener) {
      const stillNew = await isStartingNewConversation(
        userId,
        item.recipient,
        item.automation_id
      );
      if (!stillNew) {
        const label = item.recipient_label || chatIdToDisplay(item.recipient);
        await markQueueCancelled(userId, item.id, "Opener déjà envoyé — doublon évité");
        console.warn(`⏭️ Queue #${item.id} ignorée (${label}) — opener déjà présent`);
        if (item.automation_id) {
          await addAutomationLog(
            userId,
            item.automation_id,
            "info",
            `Doublon évité pour ${label} — le premier message était déjà parti.`
          );
        }
        continue;
      }
      // Prospect a déjà écrit (souvent hors-sujet / commande) avant l'opener → laisser l'auto-reply
      if (await hasInboundInCampaignEpoch(userId, item.recipient, item.automation_id)) {
        const label = item.recipient_label || chatIdToDisplay(item.recipient);
        await markQueueCancelled(
          userId,
          item.id,
          "Prospect déjà écrit — opener annulé"
        );
        console.warn(
          `⏭️ Queue #${item.id} ignorée (${label}) — inbound déjà présent avant opener`
        );
        if (item.automation_id) {
          await addAutomationLog(
            userId,
            item.automation_id,
            "info",
            `Opener annulé pour ${label} — le contact avait déjà écrit sur ce fil.`
          );
        }
        continue;
      }
    }

    // Check plafond AVANT beginFresh (éviter de reset l'époque si on reporte)
    // Groupes / chaînes : hors quotas « nouveau fil » prospects
    let newKind: "none" | "outbound" | "inbound" = "none";
    if (!isGroupOrChannel) {
      if (isCampaignOpener) {
        newKind = "outbound";
      } else {
        newKind = await classifyNewConversationKind(
          userId,
          item.recipient,
          item.automation_id ?? null
        );
      }
    }

    if (newKind !== "none") {
      const gate = await canStartNewConversation(userId, newKind);
      if (!gate.ok) {
        if (gate.code === "trial_exhausted") {
          await markQueueFailed(userId, item.id, gate.reason);
          if (item.automation_id) {
            await addAutomationLog(userId, item.automation_id, "warning", gate.reason);
          }
        } else {
          await rescheduleDailyQuota(userId, item, gate.reason);
        }
        continue;
      }
    }

    if (isCampaignOpener) {
      const { beginFreshCampaignConversation } = await import("./db.js");
      await beginFreshCampaignConversation(userId, item.recipient, item.automation_id!);
    }

    // Sécurité : jamais 2 sortants d'affilée sans réponse — scopé à la campagne
    // (inapplicable aux posts dans un groupe / chaîne)
    if (!isInboundReply && !isGroupOrChannel) {
      const gate = await shouldBlockOutboundWhileAwaitingReply(userId, item);
      if (gate.block) {
        await markQueueFailed(userId, item.id, gate.reason || "En attente de réponse");
        console.warn(
          `🛑 Queue #${item.id} bloquée (${chatIdToDisplay(item.recipient)}): ${gate.reason}`
        );
        if (item.automation_id) {
          await addAutomationLog(
            userId,
            item.automation_id,
            "warning",
            `Envoi bloqué pour ${item.recipient_label || chatIdToDisplay(item.recipient)} — un message est déjà parti, on attend la réponse.`
          );
        }
        continue;
      }
    }

    const allowAutoReply = item.automation_id != null && !isGroupOrChannel;

    try {
      if (item.media_url && item.media_type) {
        await sendWhatsAppMedia(userId, item.recipient, {
          url: item.media_url,
          type: item.media_type as "image" | "document" | "audio",
          caption: item.message ?? undefined,
        }, {
          enableAutoReply: allowAutoReply,
          automationId: item.automation_id,
        });
        if (allowAutoReply) {
          try {
            const { setContactAutoReply, saveContact } = await import("./db.js");
            await setContactAutoReply(userId, item.recipient, true);
            await saveContact(userId, {
              phone: item.recipient,
              status: "en_conversation",
              autoReply: true,
            });
          } catch {
            /* best effort */
          }
        }
      } else if (item.message) {
        // Conserver / renforcer auto_reply pour les envois de campagne
        let outboundGap: import("./anti-ban.js").OutboundGapOpts | undefined;
        if (isInboundReply) {
          outboundGap = { profile: "auto_reply" };
        } else if (item.automation_id != null) {
          try {
            const auto = await getAutomation(userId, item.automation_id);
            const total =
              (auto?.stats.pending ?? 0) + (auto?.stats.contacted ?? 0);
            outboundGap = {
              profile: isGroupOrChannel ? "campaign" : "campaign",
              minDelaySeconds: auto?.config.minDelaySeconds,
              maxDelaySeconds: auto?.config.maxDelaySeconds,
              prospectCount: total > 0 ? total : undefined,
            };
          } catch {
            outboundGap = { profile: "campaign" };
          }
        }
        await sendWhatsAppMessage(userId, item.recipient, item.message, {
          enableAutoReply: allowAutoReply,
          outboundProfile: isInboundReply
            ? "auto_reply"
            : item.automation_id != null
              ? "campaign"
              : undefined,
          outboundGap,
          automationId: item.automation_id,
          countsTowardQuota: !isGroupOrChannel && !isGroupFollowUp,
        });
        if (isInboundReply && item.automation_id != null) {
          try {
            await incrementMessagesHandled(userId, item.automation_id);
          } catch {
            /* best effort */
          }
        }
      } else {
        await markQueueFailed(userId, item.id, "Message ou média manquant");
        continue;
      }
      await markQueueSent(userId, item.id);
      sent++;
      console.log(`📤 Queue #${item.id} → ${chatIdToDisplay(item.recipient)}`);
      if (item.automation_id) {
        const label = item.recipient_label || chatIdToDisplay(item.recipient);
        await addAutomationLog(userId, item.automation_id, "success", `Message envoyé à ${label}`);
        // Atteint / stats seulement APRÈS envoi WhatsApp réel (pas à la mise en file).
        const isFirstCampaignDelivery =
          !isInboundReply && !isGroupFollowUp;
        if (isFirstCampaignDelivery) {
          try {
            const {
              updateAutomationTarget,
              updateAutomationStats,
              getAutomation,
            } = await import("./db.js");
            await updateAutomationTarget(userId, item.automation_id, item.recipient, {
              status: "contacted",
            });
            const stats = (await getAutomation(userId, item.automation_id))?.stats ?? {};
            await updateAutomationStats(userId, item.automation_id, {
              outboundUsed: (stats.outboundUsed ?? 0) + 1,
              lastActionAt: new Date().toISOString(),
            });
          } catch (err) {
            console.warn("[send-queue] post-send target/stats:", err);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Plafond atteint au moment de l'envoi → reporter, ne pas échouer définitivement
      if (/Limite du jour|Essai gratuit terminé|reporté|repris demain/i.test(msg)) {
        if (/Essai gratuit terminé/i.test(msg)) {
          await markQueueFailed(userId, item.id, msg);
        } else {
          await rescheduleDailyQuota(userId, item, msg);
        }
        continue;
      }
      await markQueueFailed(userId, item.id, msg);
      if (item.automation_id) {
        await addAutomationLog(
          userId,
          item.automation_id,
          "error",
          `Échec envoi à ${chatIdToDisplay(item.recipient)} : ${msg.slice(0, 160)}`
        );
      }
    }
  }

  return sent;
}

/** Avance les envois pending si la fenêtre vient d'être élargie (hors pipeline config). */
export async function recheckPendingSendQueueAfterWindowChange(
  userId: number,
  automationId: number
): Promise<number> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return 0;
  const quiet = resolveOutboundQuietHours(
    auto.config.quietHoursStart,
    auto.config.quietHoursEnd
  );
  if (isWithinQuietHours(quiet)) return 0;

  const items = await listPendingSendQueueForAutomation(userId, automationId);
  const now = formatLocalDateTime(new Date());
  let bumped = 0;
  for (const item of items) {
    if (bypassQuietHours(item)) continue;
    const sendAt = new Date(item.send_at);
    if (sendAt.getTime() <= Date.now()) continue;
    await rescheduleSendQueueItem(userId, item.id, now);
    bumped++;
    const label = item.recipient_label || chatIdToDisplay(item.recipient);
    await addAutomationLog(
      userId,
      automationId,
      "info",
      `Envoi à ${label} avancé à ${now} (fenêtre d'envoi élargie).`
    );
  }
  return bumped;
}

export async function processSendQueue(limit = 2): Promise<number> {
  if (queueRunning) return 0;

  queueRunning = true;
  let sent = 0;

  try {
    const userIds = await listActiveUserIds();
    for (const userId of userIds) {
      try {
        sent += await processSendQueueForUser(userId, limit);
      } catch (err) {
        console.error(`📤 Send-queue user ${userId} échoué:`, err);
      }
    }
  } finally {
    queueRunning = false;
  }

  recordWorkerTick("send_queue", { processed: sent });
  return sent;
}

export { cancelPendingSendQueue };
