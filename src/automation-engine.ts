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
  saveAgentMessageForAutomation,
  unblockContact,
  updateAutomationStats,
  updateAutomationStatus,
  updateAutomationTarget,
  updateAutomationTargetAb,
  formatLocalDateTime,
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
import { listActiveUserIds, getUserById } from "./users.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";
import { isResendConfigured, sendDailyReportEmail } from "./mail/resend.js";

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
    await addAutomationLog(userId, auto.id, "warning", quota.reason ?? "Quota journalier atteint — envois en pause.");
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
            : await bootstrapGroupProspectTargets(userId, auto.id);
        if (added === 0) {
          await failAutomationNoTargets(
            userId,
            auto.id,
            auto.type === "contact_prospect"
              ? "Aucun contact chargé — vérifiez la connexion WhatsApp et la liste de contacts."
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

  const ab = pickAbVariant(auto);
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
    auto.config.mode === "outbound_prospect" ||
    auto.type === "group_prospect" ||
    auto.type === "contact_prospect" ||
    auto.config.personalizeMessages === true;

  if (shouldPersonalize) {
    try {
      const recentOpeners = await listRecentCampaignOpeners(userId, auto.id, 40);
      message = await generatePersonalizedOpener(userId, {
        template: message,
        memberName: target.target_label || chatIdToDisplay(target.target_id),
        groupName: auto.config.groupName || "groupe",
        conversationGuide: auto.config.conversationGuide,
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
    // Nouvelle campagne (id différent) → oubli mémoire + historique pré-campagne
    await beginFreshCampaignConversation(userId, target.target_id, auto.id);

    // Google Contacts (People) : no-op si non connecté ; ne bloque jamais l'envoi
    const { ensureGoogleContactBeforeSend } = await import("./integrations/google-contacts.js");
    await ensureGoogleContactBeforeSend(userId, {
      phone: target.target_id,
      name: target.target_label,
    });

    const priority = shouldPersonalize ? 7 : 6;
    await enqueueSend(userId, {
      recipient: target.target_id,
      recipientLabel: target.target_label ?? undefined,
      message: sanitizeOutboundWhatsAppText(message),
      mediaUrl: auto.config.mediaUrl,
      mediaType: auto.config.mediaType,
      priority,
      automationId: auto.id,
      abVariant: ab.variantId,
    });

    // Campagne active = auto-reply OBLIGATOIRE (réponses UNIQUEMENT si le prospect écrit)
    await setContactAutoReply(userId, target.target_id, true);
    await saveContact(userId, {
      phone: target.target_id,
      name: target.target_label ?? undefined,
      status: "en_conversation",
      autoReply: true,
    });

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
      `Message programmé pour ${label}${ab.variantId !== "default" ? ` [A/B ${ab.variantId}]` : ""}`
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

/** Heure locale (0-23) à partir de laquelle le rapport quotidien est posté. */
const DAILY_REPORT_HOUR = 20;

function todayLocal(): string {
  return formatLocalDateTime(new Date()).slice(0, 10);
}

/** Construit le texte du rapport quotidien d'une campagne (prospection ou closing e-commerce). */
export async function buildDailyReportText(userId: number, auto: Automation): Promise<string> {
  const stats = auto.stats ?? {};
  const today = todayLocal();
  const targets = await listAutomationTargets(userId, auto.id, { limit: 1000 });

  const isToday = (ts: string | null) => !!ts && ts.slice(0, 10) === today;
  const nonPending = targets.filter((t) => t.status !== "pending" && t.status !== "queued");
  const sentToday = nonPending.filter((t) => isToday(t.last_action_at)).length;
  const replied = targets.filter(
    (t) => t.status === "replied" || t.status === "interested" || t.status === "stopped"
  ).length;
  const interested = targets.filter((t) => t.status === "interested").length;
  const pendingCount = targets.filter((t) => t.status === "pending" || t.status === "queued").length;

  const lines: string[] = [
    `📊 Rapport du jour — « ${auto.name} » · statut : ${auto.status}`,
  ];

  if (auto.config.mode === "inbound_closing" || auto.type === "keyword_sales") {
    lines.push(
      `• Clients ayant écrit / échangé : ${stats.messagesHandled ?? 0}`,
      `• Intéressés : ${interested || stats.interested || 0}`,
      `• Conversions : ${stats.conversions ?? 0}`
    );
  } else {
    lines.push(
      `• Messages envoyés aujourd'hui : ${sentToday}`,
      `• Total contactés : ${nonPending.length}${pendingCount ? ` (restants à contacter : ${pendingCount})` : ""}`,
      `• Réponses reçues : ${replied} · intéressés : ${interested}`
    );
  }

  if (stats.autoStopped) {
    lines.push(`• Conversations arrêtées automatiquement : ${stats.autoStopped}`);
  }
  lines.push("Ouvre Automatisation pour le détail.");
  return lines.join("\n");
}

/** Poste un rapport quotidien dans le chat (+ email Resend si configuré). Une fois / jour / campagne. */
async function maybeSendDailyReport(userId: number, auto: Automation): Promise<void> {
  if (new Date().getHours() < DAILY_REPORT_HOUR) return;
  const today = todayLocal();
  if (auto.stats?.lastReportDate === today) return;

  try {
    const text = await buildDailyReportText(userId, auto);
    await saveAgentMessageForAutomation(userId, auto.id, "assistant", text);
    await updateAutomationStats(userId, auto.id, {
      lastReportDate: today,
      lastActionAt: new Date().toISOString(),
    });
    console.log(`📊 Rapport quotidien posté — campagne #${auto.id} (user ${userId})`);

    if (isResendConfigured()) {
      try {
        const user = await getUserById(userId);
        const to = user?.email?.trim();
        if (!to) {
          console.warn(`📧 Rapport #${auto.id} : pas d'email user ${userId}`);
        } else {
          const mail = await sendDailyReportEmail({
            to,
            campaignName: auto.name,
            campaignId: auto.id,
            text,
          });
          if (mail.ok) {
            console.log(`📧 Rapport email envoyé — campagne #${auto.id} → ${to} (${mail.id})`);
            await updateAutomationStats(userId, auto.id, { emailReportSentAt: new Date().toISOString() });
          } else {
            console.error(`📧 Rapport email échoué — campagne #${auto.id}:`, mail.error);
          }
        }
      } catch (mailErr) {
        console.error(`📧 Rapport email campagne #${auto.id} exception:`, mailErr);
      }
    }
  } catch (err) {
    console.error(`📊 Rapport quotidien campagne #${auto.id} échoué:`, err);
  }
}

async function processTickForUser(userId: number): Promise<void> {
  const active = await listActiveAutomations(userId);
  for (const auto of active) {
    try {
      await processAutomation(userId, auto);
      await maybeSendDailyReport(userId, auto);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await addAutomationLog(userId, auto.id, "error", `Erreur moteur : ${msg}`);
    }
  }
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

  // Le compte connecté (nous) est presque toujours membre du groupe : on ne se
  // prospecte jamais soi-même. C'est ce qui explique qu'un groupe à 2 membres
  // ne charge qu'1 seule cible.
  const ownerId = await getConnectedOwnerId(userId);
  const hardBlockedIds = await getBlockedContactIds(userId);
  // Exclure : déjà dans CETTE auto OU dans toute autre campagne active (1 fil WhatsApp = 1 campagne)
  const alreadyEnrolled = new Set<string>([
    ...(await getAutomationTargetIds(userId, automationId)),
    ...(await getActiveCampaignTargetIds(userId, automationId)),
  ]);

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
      const enrolled =
        matchesAny(id, alreadyEnrolled) || matchesAny(rawId, alreadyEnrolled);
      const contact =
        (await getContact(userId, id)) ||
        (rawId !== id ? await getContact(userId, rawId) : null);
      const softStopped = !hardBlocked && contact?.status === "stop";
      return {
        id,
        name: p.name || contact?.name || chatIdToDisplay(id),
        rawId,
        isSelf,
        hardBlocked,
        softStopped,
        enrolled,
      };
    })
  );

  const selfCount = classified.filter((p) => p.isSelf).length;
  const hardBlockedCount = classified.filter((p) => !p.isSelf && p.hardBlocked).length;
  const enrolledCount = classified.filter((p) => !p.isSelf && !p.hardBlocked && p.enrolled).length;
  const softStoppedCount = classified.filter(
    (p) => !p.isSelf && !p.hardBlocked && !p.enrolled && p.softStopped
  ).length;

  // Nouvelle campagne groupe : on réinclut les contacts en statut « stop »
  // (souvent issus d'une ancienne prospection) et on les réactive pour pouvoir envoyer.
  // Les exclusions explicites (blocked_contacts) restent respectées.
  const participants = classified
    .filter((p) => !p.isSelf && !p.hardBlocked && !p.enrolled)
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
    const parts = [
      `${group.participants.length} membre(s) dans le groupe`,
      selfCount ? `${selfCount} = vous (exclu)` : null,
      hardBlockedCount ? `${hardBlockedCount} bloqué(s) explicitement` : null,
      enrolledCount ? `${enrolledCount} déjà dans une campagne active` : null,
      softStoppedCount ? `${softStoppedCount} stoppé(s)` : null,
    ].filter(Boolean);
    await failAutomationNoTargets(
      userId,
      automationId,
      `Aucun membre éligible dans « ${groupLabel} » (${parts.join(" · ")}). ` +
        "Ajoutez d'autres membres au groupe, ou retirez le numéro de la liste de blocage."
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

  const alreadyEnrolled = new Set<string>([
    ...(await getAutomationTargetIds(userId, automationId)),
    ...(await getActiveCampaignTargetIds(userId, automationId)),
  ]);

  const eligible: Array<{ id: string; label?: string }> = [];
  for (const c of contacts) {
    if (await isContactBlocked(userId, c.id)) continue;
    let dup = false;
    for (const tid of alreadyEnrolled) {
      if (chatIdsMatch(tid, c.id)) {
        dup = true;
        break;
      }
    }
    if (!dup && !eligible.some((e) => chatIdsMatch(e.id, c.id))) {
      eligible.push(c);
    }
  }

  if (!eligible.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucun contact éligible (bloqués ou déjà dans une campagne active)."
    );
  }

  const added = await addAutomationTargets(
    userId,
    automationId,
    eligible.map((c) => ({
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
