import {
  addAutomationLog,
  addAutomationTargets,
  canSendOutbound,
  enqueueSend,
  getAutomation,
  claimNextPendingTarget,
  listRecentCampaignOpeners,
  listActiveAutomations,
  listAutomationTargets,
  getAutomationTargetIds,
  saveContact,
  setContactAutoReply,
  beginFreshCampaignConversation,
  getBlockedContactIds,
  getContact,
  isContactBlocked,
  saveAgentMessage,
  saveAgentMessageForAutomation,
  ensureDefaultAgentThread,
  unblockContact,
  updateAutomationStats,
  updateAutomationStatus,
  updateAutomationTarget,
  updateAutomationTargetAb,
  updateAutomationTargetLabel,
  formatLocalDateTime,
  countAutomationMessagesInRange,
  countUserMessagesInRange,
  type Automation,
} from "./db.js";
import { pickAbVariant, recordAbSent } from "./ab-testing.js";
import { getActiveCampaignTargetIds } from "./campaign-gating.js";
import {
  chatIdToDisplay,
  chatIdsMatch,
  getConnectedOwnerId,
  getGroupMembers,
  normalizeGroupParticipantId,
  requireEvolutionConnected,
} from "./evolutionapi.js";
import { generatePersonalizedOpener } from "./prospect-personalizer.js";
import { listActiveUserIds, getUserById, markWeeklyReportSent } from "./users.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";
import { isResendConfigured, sendWeeklyReportEmail } from "./mail/resend.js";
import {
  buildWeeklyReportHtml,
  buildWeeklyReportText,
  fridayWeeklyWindow,
  funnelFromTargetStats,
  type WeeklyReportPayload,
} from "./mail/weekly-report.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function failAutomationNoTargets(
  userId: number,
  automationId: number,
  reason: string
): Promise<never> {
  await updateAutomationStatus(userId, automationId, "failed");
  await addAutomationLog(userId, automationId, "error", reason);
  await updateAutomationStats(userId, automationId, {
    report: reason,
    lastActionAt: new Date().toISOString(),
  });
  throw new Error(reason);
}

/** Nombre de premiers messages déjà envoyés aujourd'hui pour cette campagne. */
async function countSentTodayForAutomation(userId: number, automationId: number): Promise<number> {
  const today = formatLocalDateTime(new Date()).slice(0, 10);
  const targets = await listAutomationTargets(userId, automationId, { limit: 1000 });
  return targets.filter(
    (t) =>
      t.status !== "pending" &&
      t.status !== "queued" &&
      !!t.last_action_at &&
      t.last_action_at.slice(0, 10) === today
  ).length;
}

async function processGroupProspect(userId: number, auto: Automation): Promise<void> {
  const startAt = auto.config.scheduledStartAt?.trim();
  if (startAt) {
    const when = new Date(startAt.includes("T") ? startAt : startAt.replace(" ", "T"));
    if (!Number.isNaN(when.getTime()) && when.getTime() > Date.now()) {
      return; // Lancement différé — pas encore l'heure
    }
  }

  const quota = await canSendOutbound(userId);
  if (!quota.ok) {
    await addAutomationLog(
      userId,
      auto.id,
      "info",
      quota.reason ?? "Plafond nouveaux fils atteint — reprise demain (fils ouverts non bloqués)."
    );
    return;
  }

  // Plafond quotidien propre à la campagne (anti-blocage).
  if (auto.config.maxPerDay && auto.config.maxPerDay > 0) {
    const sentToday = await countSentTodayForAutomation(userId, auto.id);
    if (sentToday >= auto.config.maxPerDay) {
      return;
    }
  }

  const target = await claimNextPendingTarget(userId, auto.id);
  if (!target) {
    const targets = await listAutomationTargets(userId, auto.id, { limit: 1 });
    if (targets.length === 0) {
      // Campagne active sans cibles : tenter bootstrap (activation partielle ou groupe non résolu au draft)
      try {
        const added =
          auto.type === "contact_prospect"
            ? await bootstrapContactProspectTargets(userId, auto.id)
            : auto.type === "group_broadcast"
              ? await bootstrapGroupBroadcastTargets(userId, auto.id)
              : await bootstrapGroupProspectTargets(userId, auto.id);
        if (added === 0) {
          await failAutomationNoTargets(
            userId,
            auto.id,
            auto.type === "contact_prospect"
              ? "Aucun contact chargé — vérifiez la connexion WhatsApp et la liste de contacts."
              : auto.type === "group_broadcast"
                ? "Aucun groupe chargé — vérifiez que vous êtes admin des groupes choisis."
                : "Aucun membre chargé — vérifiez la connexion WhatsApp et le groupe."
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await addAutomationLog(userId, auto.id, "error", `Bootstrap cibles échoué : ${msg}`);
      }
      return;
    }

    // Tous les premiers messages sont partis — la campagne reste active pour les réponses.
    if (!auto.stats.openersDone) {
      const fresh = await getAutomation(userId, auto.id);
      await addAutomationLog(
        userId,
        auto.id,
        "success",
        "Tous les premiers messages sont en file / envoyés. Campagne toujours active — réponses auto en cours."
      );
      await updateAutomationStats(userId, auto.id, {
        openersDone: true,
        report: `Premiers messages en file (${fresh?.stats.contacted ?? 0}). Conversations en cours.`,
        lastActionAt: new Date().toISOString(),
      });
    }
    return;
  }

  const freshAuto = (await getAutomation(userId, auto.id)) ?? auto;
  const ab = pickAbVariant(freshAuto);
  let message = ab.message.trim();
  if (!message) {
    await updateAutomationStatus(userId, auto.id, "failed");
    await addAutomationLog(userId, auto.id, "error", "Message initial manquant dans la configuration.");
    return;
  }

  // Un même numéro WhatsApp = un seul fil : jamais deux campagnes actives sur le même contact.
  const otherCampaignIds = await getActiveCampaignTargetIds(userId, auto.id);
  const inOtherCampaign = [...otherCampaignIds].some(
    (id) => chatIdsMatch(id, target.target_id),
  );
  if (inOtherCampaign) {
    await updateAutomationTarget(userId, auto.id, target.target_id, {
      status: "stopped",
      notes: "Déjà engagé dans une autre campagne active — exclus pour éviter les messages mélangés.",
    });
    await addAutomationLog(
      userId,
      auto.id,
      "info",
      `Cible ignorée (${target.target_label || chatIdToDisplay(target.target_id)}) : déjà dans une autre campagne active.`,
    );
    return;
  }

  const shouldPersonalize =
    freshAuto.type !== "group_broadcast" &&
    // 5 variantes validées = texte exact à envoyer (on choisit laquelle, on ne réécrit pas).
    !(Array.isArray(freshAuto.config.abVariants) && freshAuto.config.abVariants.length >= 2) &&
    freshAuto.config.personalizeMessages === true;

  const isGroupBroadcast =
    freshAuto.type === "group_broadcast" || freshAuto.config.mode === "group_broadcast";

  if (shouldPersonalize) {
    try {
      const recentOpeners = await listRecentCampaignOpeners(userId, auto.id, 40);
      message = await generatePersonalizedOpener(userId, {
        template: message,
        memberName: target.target_label || chatIdToDisplay(target.target_id),
        groupName: freshAuto.config.groupName || "groupe",
        conversationGuide: freshAuto.config.conversationGuide,
        recentOpeners,
      });
    } catch (err) {
      // generatePersonalizedOpener ne devrait plus throw (fallback interne),
      // mais on garde un filet au cas où.
      const msg = err instanceof Error ? err.message : String(err);
      const short = /429|rate limit|TPM|tokens per min/i.test(msg)
        ? "limite de vitesse IA momentanée"
        : msg.slice(0, 160);
      await addAutomationLog(
        userId,
        auto.id,
        "warning",
        `Personnalisation IA indisponible (${short}) — message modèle utilisé.`
      );
    }
  }

  try {
    if (!isGroupBroadcast) {
      // Nouvelle campagne (id différent) → oubli mémoire + historique pré-campagne
      await beginFreshCampaignConversation(userId, target.target_id, auto.id);
    }

    // Google Contacts : nom WA si besoin ; cache hit = quasi instantané
    const { resolveWhatsAppDisplayName, isPhoneLikeLabel } = await import("./evolutionapi.js");
    let googleName: string | null =
      target.target_label && !isPhoneLikeLabel(target.target_label)
        ? target.target_label
        : null;
    if (!isGroupBroadcast && !googleName) {
      const waName = await resolveWhatsAppDisplayName(
        userId,
        target.target_id,
        target.target_label,
      ).catch(() => null);
      if (waName && !isPhoneLikeLabel(waName)) googleName = waName;
    }

    if (!isGroupBroadcast && googleName && googleName !== target.target_label) {
      void updateAutomationTargetLabel(userId, auto.id, target.target_id, googleName).catch(
        () => null,
      );
    }

    if (!isGroupBroadcast) {
      const { ensureGoogleContactBeforeSend } = await import("./integrations/google-contacts.js");
      // Ne bloque jamais l'envoi si Google est lent : timeout 4s max
      await Promise.race([
        ensureGoogleContactBeforeSend(userId, {
          phone: target.target_id,
          name: googleName ?? target.target_label,
        }),
        new Promise<{ synced: false; reason: string }>((resolve) =>
          setTimeout(() => resolve({ synced: false, reason: "timeout" }), 4000),
        ),
      ]).catch(() => null);
    }

    if (isGroupBroadcast) {
      const { assertUserIsGroupAdmin } = await import("./evolutionapi.js");
      await assertUserIsGroupAdmin(userId, target.target_id);
    }

    const priority = shouldPersonalize ? 7 : 6;
    await enqueueSend(userId, {
      recipient: target.target_id,
      recipientLabel: googleName ?? target.target_label ?? undefined,
      message: sanitizeOutboundWhatsAppText(message),
      mediaUrl: freshAuto.config.mediaUrl,
      mediaType: freshAuto.config.mediaType,
      priority,
      automationId: auto.id,
      abVariant: ab.variantId,
    });

    if (!isGroupBroadcast) {
      // Campagne active = auto-reply OBLIGATOIRE (réponses UNIQUEMENT si le prospect écrit)
      await setContactAutoReply(userId, target.target_id, true);
      await saveContact(userId, {
        phone: target.target_id,
        name: googleName ?? target.target_label ?? undefined,
        status: "en_conversation",
        autoReply: true,
      });
    }

    // PAS de séquence / relance auto au moment de l'opener.
    // Règle produit : 1 seul premier message → attendre la réponse → auto-reply.
    // Les relances froid (sans réponse) causaient des rafales de messages.

    await updateAutomationTarget(userId, auto.id, target.target_id, { status: "contacted" });
    await updateAutomationTargetAb(userId, auto.id, target.target_id, ab.variantId);
    await recordAbSent(userId, auto.id, ab.variantId);

    const label = target.target_label || chatIdToDisplay(target.target_id);
    await addAutomationLog(
      userId,
      auto.id,
      "success",
      isGroupBroadcast
        ? `Message programmé dans le groupe « ${label} »`
        : `Message programmé pour ${label}${ab.variantId !== "default" ? ` [A/B ${ab.variantId}]` : ""}`
    );

    const stats = (await getAutomation(userId, auto.id))?.stats ?? {};
    await updateAutomationStats(userId, auto.id, {
      outboundUsed: (stats.outboundUsed ?? 0) + 1,
      lastActionAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAutomationTarget(userId, auto.id, target.target_id, { status: "error", notes: msg });
    await addAutomationLog(userId, auto.id, "error", `Échec pour ${target.target_label || target.target_id}: ${msg}`);
  }
}

async function processAutomation(userId: number, auto: Automation): Promise<void> {
  if (auto.type === "group_prospect" || auto.type === "contact_prospect") {
    await processGroupProspect(userId, auto);
  }
}

/** Vendredi (0=dim … 5=ven) à partir de laquelle le rapport hebdo peut partir. */
const WEEKLY_REPORT_DOW = 5;
/** Heure locale (0-23) — vendredi 20h Porto-Novo. */
const WEEKLY_REPORT_HOUR = 20;

const APP_PUBLIC_URL = "https://www.klanvio.com";

/** Construit le payload du rapport hebdomadaire (activité 7j + niveau + funnel optionnel). */
export async function buildWeeklyReportPayload(
  userId: number,
  auto: Automation | null,
  now = new Date()
): Promise<WeeklyReportPayload> {
  const win = fridayWeeklyWindow(now);
  const user = await getUserById(userId);
  const outreachLevel = user?.outreach_level ?? 1;
  const totalMessagesSent = user?.total_messages_sent ?? 0;
  const previous = user?.last_reported_outreach_level ?? null;
  const leveledUp =
    previous != null && outreachLevel > previous;

  let messagesSent = 0;
  let messagesReceived = 0;
  let funnel = {
    reached: 0,
    answered: 0,
    waitingReply: 0,
    interested: 0,
    stopped: 0,
    responseRate: null as number | null,
  };
  let conversions = 0;
  let campaignName = "Votre compte Klanvio";
  let campaignId: number | null = null;
  let campaignStatus = "active";

  if (auto) {
    const activity = await countAutomationMessagesInRange(
      userId,
      auto.id,
      win.periodStart,
      win.periodEndExclusive
    );
    messagesSent = activity.outbound;
    messagesReceived = activity.inbound;
    funnel = funnelFromTargetStats(auto.stats ?? {});
    conversions = Number(auto.stats?.conversions ?? 0);
    campaignName = auto.name;
    campaignId = auto.id;
    campaignStatus = auto.status;
  } else {
    const activity = await countUserMessagesInRange(
      userId,
      win.periodStart,
      win.periodEndExclusive
    );
    messagesSent = activity.outbound;
    messagesReceived = activity.inbound;
  }

  return {
    campaignName,
    campaignId,
    campaignStatus,
    periodLabel: win.periodLabel,
    fridayKey: win.fridayKey,
    messagesSent,
    messagesReceived,
    reached: funnel.reached,
    answered: funnel.answered,
    waitingReply: funnel.waitingReply,
    interested: funnel.interested,
    stopped: funnel.stopped,
    conversions,
    responseRate: funnel.responseRate,
    appUrl: APP_PUBLIC_URL,
    outreachLevel,
    totalMessagesSent,
    leveledUp,
    previousOutreachLevel: previous,
  };
}

/**
 * Rapport hebdo au niveau utilisateur (pas conditionné à une campagne active).
 * Vendredi ≥ 20h locale, une fois par vendredi / user.
 * Funnel campagne si une campagne active existe, sinon activité globale + niveau.
 */
async function maybeSendUserWeeklyReport(userId: number): Promise<void> {
  const now = new Date();
  if (now.getDay() !== WEEKLY_REPORT_DOW) return;
  if (now.getHours() < WEEKLY_REPORT_HOUR) return;

  const win = fridayWeeklyWindow(now);
  const user = await getUserById(userId);
  if (!user) return;
  if (user.last_weekly_report_week === win.fridayKey) return;

  try {
    const active = await listActiveAutomations(userId);
    const auto = active[0] ?? null;
    const payload = await buildWeeklyReportPayload(userId, auto, now);
    const text = buildWeeklyReportText(payload);
    const html = buildWeeklyReportHtml(payload);

    if (auto) {
      await saveAgentMessageForAutomation(userId, auto.id, "assistant", text);
    } else {
      const thread = await ensureDefaultAgentThread(userId);
      await saveAgentMessage(userId, thread.id, "assistant", text);
    }

    await markWeeklyReportSent(userId, win.fridayKey, payload.outreachLevel);
    if (auto) {
      await updateAutomationStats(userId, auto.id, {
        lastWeeklyReportWeek: win.fridayKey,
        lastActionAt: new Date().toISOString(),
      });
    }
    console.log(
      `Rapport hebdomadaire posté — user ${userId} (niveau ${payload.outreachLevel}, ${win.fridayKey})`
    );

    if (isResendConfigured()) {
      try {
        const to = user.email?.trim();
        if (!to) {
          console.warn(`Rapport hebdo user ${userId} : pas d'email`);
        } else {
          const mail = await sendWeeklyReportEmail({
            to,
            campaignName: payload.campaignName,
            text,
            html,
          });
          if (mail.ok) {
            console.log(`Rapport hebdo email — user ${userId} → ${to} (${mail.id})`);
            if (auto) {
              await updateAutomationStats(userId, auto.id, {
                emailReportSentAt: new Date().toISOString(),
              });
            }
          } else {
            console.error(`Rapport hebdo email échoué — user ${userId}:`, mail.error);
          }
        }
      } catch (mailErr) {
        console.error(`Rapport hebdo email user ${userId} exception:`, mailErr);
      }
    }
  } catch (err) {
    console.error(`Rapport hebdomadaire user ${userId} échoué:`, err);
  }
}

async function processTickForUser(userId: number): Promise<void> {
  const active = await listActiveAutomations(userId);
  for (const auto of active) {
    try {
      await processAutomation(userId, auto);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await addAutomationLog(userId, auto.id, "error", `Erreur moteur : ${msg}`);
    }
  }
  await maybeSendUserWeeklyReport(userId);
}

async function processTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const userIds = await listActiveUserIds();
    for (const userId of userIds) {
      try {
        await processTickForUser(userId);
      } catch (err) {
        console.error(`🤖 Moteur automatisations user ${userId} échoué:`, err);
      }
    }
  } finally {
    running = false;
  }
}

export async function bootstrapGroupProspectTargets(userId: number, automationId: number): Promise<number> {
  const auto = await getAutomation(userId, automationId);
  if (!auto || auto.type !== "group_prospect") return 0;

  if (!auto.config.groupId) {
    await failAutomationNoTargets(
      userId,
      automationId,
      "groupId manquant — impossible de charger les membres du groupe."
    );
  }

  const groupId = auto.config.groupId!;

  await requireEvolutionConnected(userId, "le chargement des membres du groupe");

  const group = await getGroupMembers(userId, groupId);
  const maxMembers = Math.min(Math.max(auto.config.maxMembers ?? 30, 1), 50);
  const groupLabel = group.subject || auto.config.groupName || groupId;

  const ownerId = await getConnectedOwnerId(userId);
  const hardBlockedIds = await getBlockedContactIds(userId);
  /** Déjà cible de CETTE campagne (réactivation) — ne pas traiter comme bloquant. */
  const thisCampaignIds = await getAutomationTargetIds(userId, automationId);
  /** Autres campagnes actives uniquement (1 fil WhatsApp = 1 campagne). */
  const otherCampaignIds = await getActiveCampaignTargetIds(userId, automationId);

  const matchesAny = (candidate: string, ids: Iterable<string>): boolean => {
    for (const id of ids) {
      if (chatIdsMatch(candidate, id)) return true;
    }
    return false;
  };

  const classified = await Promise.all(
    group.participants.map(async (p) => {
      const rawId = p.id;
      const id = normalizeGroupParticipantId(rawId);
      const isSelf = !!ownerId && (chatIdsMatch(ownerId, id) || chatIdsMatch(ownerId, rawId));
      const hardBlocked =
        matchesAny(id, hardBlockedIds) || matchesAny(rawId, hardBlockedIds);
      const onThisCampaign =
        matchesAny(id, thisCampaignIds) || matchesAny(rawId, thisCampaignIds);
      const enrolledElsewhere =
        matchesAny(id, otherCampaignIds) || matchesAny(rawId, otherCampaignIds);
      const contact =
        (await getContact(userId, id)) ||
        (rawId !== id ? await getContact(userId, rawId) : null);
      const softStopped =
        !hardBlocked && !onThisCampaign && !enrolledElsewhere && contact?.status === "stop";
      return {
        id,
        name: p.name || contact?.name || chatIdToDisplay(id),
        rawId,
        isSelf,
        hardBlocked,
        softStopped,
        onThisCampaign,
        enrolledElsewhere,
      };
    })
  );

  const selfCount = classified.filter((p) => p.isSelf).length;
  const hardBlockedCount = classified.filter((p) => !p.isSelf && p.hardBlocked).length;
  const onThisCount = classified.filter(
    (p) => !p.isSelf && !p.hardBlocked && p.onThisCampaign
  ).length;
  const enrolledElsewhereCount = classified.filter(
    (p) => !p.isSelf && !p.hardBlocked && !p.onThisCampaign && p.enrolledElsewhere
  ).length;
  const softStoppedCount = classified.filter(
    (p) => !p.isSelf && !p.hardBlocked && p.softStopped
  ).length;

  // Nouveaux membres seulement (ceux déjà sur CETTE campagne restent en file).
  const participants = classified
    .filter((p) => !p.isSelf && !p.hardBlocked && !p.onThisCampaign && !p.enrolledElsewhere)
    .slice(0, maxMembers);

  if (!group.participants.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      `Aucun membre récupéré depuis « ${groupLabel} ». ` +
        "Vérifiez que WhatsApp est autorisé (état open) et que vous êtes membre du groupe."
    );
  }

  if (!participants.length) {
    // Réactivation : cibles déjà chargées pour cette campagne → OK, on reprend la file.
    if (thisCampaignIds.size > 0 || onThisCount > 0) {
      const n = Math.max(thisCampaignIds.size, onThisCount);
      await addAutomationLog(
        userId,
        automationId,
        "info",
        `Réactivation : ${n} cible(s) déjà en file pour « ${groupLabel} » — aucun nouveau membre à ajouter.`
      );
      await updateAutomationStats(userId, automationId, {
        report: `Campagne reprise sur ${n} cible(s) existante(s).`,
        lastActionAt: new Date().toISOString(),
      });
      return 0;
    }

    const parts = [
      `${group.participants.length} membre(s) dans le groupe`,
      selfCount ? `${selfCount} = vous (exclu)` : null,
      hardBlockedCount ? `${hardBlockedCount} bloqué(s) explicitement` : null,
      enrolledElsewhereCount
        ? `${enrolledElsewhereCount} déjà dans une autre campagne active`
        : null,
      softStoppedCount ? `${softStoppedCount} stoppé(s)` : null,
    ].filter(Boolean);
    const tip =
      enrolledElsewhereCount > 0
        ? "Mettez l'autre campagne en pause, ou attendez qu'elle se termine."
        : hardBlockedCount > 0
          ? "Retirez le numéro de la liste de blocage."
          : "Ajoutez d'autres membres au groupe.";
    await failAutomationNoTargets(
      userId,
      automationId,
      `Aucun membre éligible dans « ${groupLabel} » (${parts.join(" · ")}). ${tip}`
    );
  }

  const reactivated: string[] = [];
  for (const p of participants) {
    if (!p.softStopped) continue;
    try {
      await unblockContact(userId, p.id);
      reactivated.push(p.name || chatIdToDisplay(p.id));
    } catch {
      /* best effort — assertCanSendTo échouera sinon au moment de l'envoi */
    }
  }
  if (reactivated.length) {
    await addAutomationLog(
      userId,
      automationId,
      "info",
      `Contact(s) réactivé(s) pour cette campagne : ${reactivated.join(", ")}`
    );
  }

  const added = await addAutomationTargets(
    userId,
    automationId,
    participants.map((p) => ({
      targetId: p.id,
      targetLabel: p.name,
    }))
  );

  await addAutomationLog(
    userId,
    automationId,
    "info",
    `${added} membre(s) ajouté(s) depuis le groupe « ${groupLabel} »`
  );

  if (added === 0) {
    const existing = await listAutomationTargets(userId, automationId, { limit: 1 });
    if (existing.length > 0 || thisCampaignIds.size > 0) {
      await addAutomationLog(
        userId,
        automationId,
        "info",
        "Membres déjà présents dans cette campagne — reprise de la file existante."
      );
      await updateAutomationStats(userId, automationId, {
        report: "Campagne reprise (cibles déjà en file).",
        lastActionAt: new Date().toISOString(),
      });
      return 0;
    }
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucune nouvelle cible ajoutée (membres déjà présents dans cette campagne)."
    );
  }

  await updateAutomationStats(userId, automationId, {
    report: `Prospection lancée sur ${added} membre(s).`,
    lastActionAt: new Date().toISOString(),
  });
  return added;
}

export async function bootstrapContactProspectTargets(
  userId: number,
  automationId: number
): Promise<number> {
  const auto = await getAutomation(userId, automationId);
  if (!auto || auto.type !== "contact_prospect") return 0;

  const contacts = auto.config.contactTargets ?? [];
  if (!contacts.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucun contact dans la configuration — impossible de démarrer la prospection."
    );
  }

  const thisCampaignIds = await getAutomationTargetIds(userId, automationId);
  const otherCampaignIds = await getActiveCampaignTargetIds(userId, automationId);

  const eligible: Array<{ id: string; label?: string }> = [];
  let alreadyOnThis = 0;
  let enrolledElsewhere = 0;
  for (const c of contacts) {
    if (await isContactBlocked(userId, c.id)) continue;
    let onThis = false;
    for (const tid of thisCampaignIds) {
      if (chatIdsMatch(tid, c.id)) {
        onThis = true;
        break;
      }
    }
    if (onThis) {
      alreadyOnThis++;
      continue;
    }
    let elsewhere = false;
    for (const tid of otherCampaignIds) {
      if (chatIdsMatch(tid, c.id)) {
        elsewhere = true;
        break;
      }
    }
    if (elsewhere) {
      enrolledElsewhere++;
      continue;
    }
    if (!eligible.some((e) => chatIdsMatch(e.id, c.id))) {
      eligible.push(c);
    }
  }

  if (!eligible.length) {
    if (alreadyOnThis > 0 || thisCampaignIds.size > 0) {
      const n = Math.max(alreadyOnThis, thisCampaignIds.size);
      await addAutomationLog(
        userId,
        automationId,
        "info",
        `Réactivation : ${n} contact(s) déjà en file — aucun nouveau à ajouter.`
      );
      await updateAutomationStats(userId, automationId, {
        report: `Campagne reprise sur ${n} contact(s) existant(s).`,
        lastActionAt: new Date().toISOString(),
      });
      return 0;
    }
    await failAutomationNoTargets(
      userId,
      automationId,
      enrolledElsewhere > 0
        ? "Aucun contact éligible (déjà dans une autre campagne active). Mettez l'autre campagne en pause."
        : "Aucun contact éligible (bloqués ou introuvables)."
    );
  }

  const { resolveWhatsAppDisplayName, isPhoneLikeLabel } = await import("./evolutionapi.js");
  const enriched = await Promise.all(
    eligible.map(async (c) => {
      // Si un vrai label est déjà là, zéro appel Evolution
      if (c.label && !isPhoneLikeLabel(c.label)) {
        return { id: c.id, label: c.label };
      }
      const waName = await resolveWhatsAppDisplayName(userId, c.id, c.label).catch(() => null);
      const label =
        (waName && !isPhoneLikeLabel(waName) ? waName : null) ||
        (c.label && !isPhoneLikeLabel(c.label) ? c.label : undefined) ||
        undefined;
      return { id: c.id, label };
    }),
  );

  const added = await addAutomationTargets(
    userId,
    automationId,
    enriched.map((c) => ({
      targetId: c.id,
      targetLabel: c.label ?? chatIdToDisplay(c.id),
    }))
  );

  await addAutomationLog(
    userId,
    automationId,
    "info",
    `${added} contact(s) ajouté(s) à la prospection.`
  );

  if (added === 0) {
    const existing = await listAutomationTargets(userId, automationId, { limit: 1 });
    if (existing.length > 0 || thisCampaignIds.size > 0) {
      await addAutomationLog(
        userId,
        automationId,
        "info",
        "Contacts déjà présents dans cette campagne — reprise de la file existante."
      );
      await updateAutomationStats(userId, automationId, {
        report: "Campagne reprise (contacts déjà en file).",
        lastActionAt: new Date().toISOString(),
      });
      return 0;
    }
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucun nouveau contact ajouté (déjà présents dans cette campagne)."
    );
  }

  await updateAutomationStats(userId, automationId, {
    report: `Prospection lancée sur ${added} contact(s).`,
    lastActionAt: new Date().toISOString(),
  });
  return added;
}

export async function bootstrapGroupBroadcastTargets(
  userId: number,
  automationId: number
): Promise<number> {
  const auto = await getAutomation(userId, automationId);
  if (!auto || auto.type !== "group_broadcast") return 0;

  const targets = auto.config.groupTargets ?? [];
  if (!targets.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucun groupe configuré — choisissez des groupes où vous êtes administrateur."
    );
  }

  const { assertUserIsGroupAdmin, requireEvolutionConnected } = await import("./evolutionapi.js");
  await requireEvolutionConnected(userId, "le chargement des groupes de diffusion");

  const eligible: Array<{ targetId: string; targetLabel?: string }> = [];
  for (const g of targets) {
    try {
      await assertUserIsGroupAdmin(userId, g.id);
      eligible.push({ targetId: g.id, targetLabel: g.label || g.id });
    } catch (err) {
      await addAutomationLog(
        userId,
        automationId,
        "warning",
        `Groupe exclu (pas admin) : ${g.label || g.id} — ${err instanceof Error ? err.message : err}`
      );
    }
  }

  if (!eligible.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucun groupe éligible : vous devez être administrateur des groupes choisis."
    );
  }

  const added = await addAutomationTargets(userId, automationId, eligible);
  await addAutomationLog(
    userId,
    automationId,
    "info",
    `${added} groupe(s) en file de diffusion (messages restants = groupes en attente).`
  );
  await updateAutomationStats(userId, automationId, {
    lastActionAt: new Date().toISOString(),
  });
  return added;
}

export async function reloadGroupProspectTargets(userId: number, automationId: number): Promise<number> {
  const auto = await getAutomation(userId, automationId);
  if (!auto || auto.type !== "group_prospect") {
    throw new Error("Automatisation group_prospect introuvable.");
  }
  if (!auto.config.groupId) {
    throw new Error("groupId manquant dans la configuration.");
  }

  await updateAutomationStatus(userId, automationId, "active");
  await addAutomationLog(userId, automationId, "info", "Rechargement des membres du groupe…");
  return bootstrapGroupProspectTargets(userId, automationId);
}

/** Déclenche un cycle moteur immédiat pour un utilisateur (ex. après activation campagne). */
export function kickAutomationForUser(userId: number): void {
  void processTickForUser(userId);
}

export function startAutomationEngine(intervalMs = 15000): void {
  if (intervalHandle) return;
  console.log(`🤖 Moteur d'automatisations actif (toutes les ${intervalMs / 1000}s)`);
  intervalHandle = setInterval(() => {
    void processTick();
  }, intervalMs);
  void processTick();
}

export function stopAutomationEngine(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
