import {
  addAutomationLog,
  addAutomationTargets,
  canSendOutbound,
  enqueueSend,
  getAutomation,
  getNextPendingTarget,
  listActiveAutomations,
  listAutomationTargets,
  saveContact,
  setContactAutoReply,
  isContactBlocked,
  saveAgentMessage,
  updateAutomationStats,
  updateAutomationStatus,
  updateAutomationTarget,
  updateAutomationTargetAb,
  formatLocalDateTime,
  type Automation,
} from "./db.js";
import { pickAbVariant, recordAbSent } from "./ab-testing.js";
import {
  chatIdToDisplay,
  getGroupMembers,
  normalizeGroupParticipantId,
  requireEvolutionConnected,
} from "./evolutionapi.js";
import { generatePersonalizedOpener } from "./prospect-personalizer.js";
import { startSequenceForContact } from "./sequences.js";
import { listActiveUserIds } from "./users.js";

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

async function processGroupProspect(userId: number, auto: Automation): Promise<void> {
  const quota = await canSendOutbound(userId);
  if (!quota.ok) {
    await addAutomationLog(userId, auto.id, "warning", quota.reason ?? "Quota journalier atteint — envois en pause.");
    return;
  }

  const target = await getNextPendingTarget(userId, auto.id);
  if (!target) {
    const targets = await listAutomationTargets(userId, auto.id, { limit: 1 });
    if (targets.length === 0) {
      // Campagne active sans cibles : tenter bootstrap (activation partielle ou groupe non résolu au draft)
      try {
        const added = await bootstrapGroupProspectTargets(userId, auto.id);
        if (added === 0) {
          await failAutomationNoTargets(
            userId,
            auto.id,
            "Aucun membre chargé — vérifiez la connexion WhatsApp et le groupe."
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await addAutomationLog(userId, auto.id, "error", `Bootstrap membres échoué : ${msg}`);
      }
      return;
    }
    await updateAutomationStatus(userId, auto.id, "completed");
    await addAutomationLog(userId, auto.id, "success", "Tous les membres ont été contactés. Automatisation terminée.");
    const fresh = await getAutomation(userId, auto.id);
    await updateAutomationStats(userId, auto.id, {
      report: `Campagne terminée. ${fresh?.stats.contacted ?? 0} contact(s) envoyé(s).`,
      lastActionAt: new Date().toISOString(),
    });
    return;
  }

  const ab = pickAbVariant(auto);
  let message = ab.message.trim();
  if (!message) {
    await updateAutomationStatus(userId, auto.id, "failed");
    await addAutomationLog(userId, auto.id, "error", "Message initial manquant dans la configuration.");
    return;
  }

  if (auto.config.personalizeMessages) {
    try {
      message = await generatePersonalizedOpener(userId, {
        template: message,
        memberName: target.target_label || chatIdToDisplay(target.target_id),
        groupName: auto.config.groupName || "groupe",
        conversationGuide: auto.config.conversationGuide,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await addAutomationLog(userId, auto.id, "warning", `Personnalisation IA échouée, message modèle utilisé: ${msg}`);
    }
  }

  try {
    const priority = auto.config.personalizeMessages ? 7 : 6;
    await enqueueSend(userId, {
      recipient: target.target_id,
      recipientLabel: target.target_label ?? undefined,
      message,
      mediaUrl: auto.config.mediaUrl,
      mediaType: auto.config.mediaType,
      priority,
      automationId: auto.id,
      abVariant: ab.variantId,
    });

    if (auto.config.enableAutoReply !== false) {
      await setContactAutoReply(userId, target.target_id, true);
    }
    await saveContact(userId, {
      phone: target.target_id,
      name: target.target_label ?? undefined,
      status: "en_conversation",
      autoReply: auto.config.enableAutoReply !== false,
    });

    if (auto.config.sequenceSteps?.length) {
      await startSequenceForContact(userId, {
        contactPhone: target.target_id,
        name: `Séquence — ${auto.name}`,
        steps: auto.config.sequenceSteps as import("./db.js").SequenceStep[],
        automationId: auto.id,
      });
    }

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
  if (auto.type === "group_prospect") {
    await processGroupProspect(userId, auto);
  }
}

/** Heure locale (0-23) à partir de laquelle le rapport quotidien est posté. */
const DAILY_REPORT_HOUR = 20;

function todayLocal(): string {
  return formatLocalDateTime(new Date()).slice(0, 10);
}

/** Construit le texte du rapport quotidien d'une campagne (prospection ou closing e-commerce). */
async function buildDailyReportText(userId: number, auto: Automation): Promise<string> {
  const stats = auto.stats ?? {};
  const today = todayLocal();
  const targets = await listAutomationTargets(userId, auto.id, { limit: 1000 });

  const isToday = (ts: string | null) => !!ts && ts.slice(0, 10) === today;
  const nonPending = targets.filter((t) => t.status !== "pending");
  const sentToday = nonPending.filter((t) => isToday(t.last_action_at)).length;
  const replied = targets.filter((t) => t.status === "replied" || t.status === "interested").length;
  const interested = targets.filter((t) => t.status === "interested").length;
  const pending = targets.filter((t) => t.status === "pending").length;

  const lines: string[] = [
    `📊 Rapport du jour — Campagne « ${auto.name} » (#${auto.id}) · statut : ${auto.status}`,
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
      `• Total contactés : ${nonPending.length}${pending ? ` (restants à contacter : ${pending})` : ""}`,
      `• Réponses reçues : ${replied} · intéressés : ${interested}`
    );
  }

  if (stats.autoStopped) {
    lines.push(`• Conversations arrêtées automatiquement : ${stats.autoStopped}`);
  }
  lines.push("Ouvre Automatisation pour le détail.");
  return lines.join("\n");
}

/** Poste un rapport quotidien dans le chat de l'agent, au plus une fois par jour et par campagne. */
async function maybeSendDailyReport(userId: number, auto: Automation): Promise<void> {
  if (new Date().getHours() < DAILY_REPORT_HOUR) return;
  const today = todayLocal();
  if (auto.stats?.lastReportDate === today) return;

  try {
    const text = await buildDailyReportText(userId, auto);
    await saveAgentMessage(userId, "assistant", text);
    await updateAutomationStats(userId, auto.id, {
      lastReportDate: today,
      lastActionAt: new Date().toISOString(),
    });
    console.log(`📊 Rapport quotidien posté — campagne #${auto.id} (user ${userId})`);
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

  const eligible = await Promise.all(
    group.participants.map(async (p) => {
      const rawId = p.id;
      const id = normalizeGroupParticipantId(rawId);
      return {
        id,
        name: p.name || chatIdToDisplay(id),
        rawId,
        blocked: (await isContactBlocked(userId, id)) || (await isContactBlocked(userId, rawId)),
      };
    })
  );

  const participants = eligible.filter((p) => !p.blocked).slice(0, maxMembers);

  if (!group.participants.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      `Aucun membre récupéré depuis « ${group.subject || auto.config.groupName || groupId} ». ` +
        "Vérifiez que WhatsApp est autorisé (état authorized) et que vous êtes membre du groupe."
    );
  }

  if (!participants.length) {
    await failAutomationNoTargets(
      userId,
      automationId,
      "Aucun membre éligible (tous bloqués ou liste vide après filtrage)."
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
    `${added} membre(s) ajouté(s) depuis le groupe « ${group.subject || auto.config.groupName || groupId} »`
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
