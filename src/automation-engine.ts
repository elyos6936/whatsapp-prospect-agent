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
  updateAutomationStats,
  updateAutomationStatus,
  updateAutomationTarget,
  updateAutomationTargetAb,
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

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function failAutomationNoTargets(automationId: number, reason: string): Promise<never> {
  await updateAutomationStatus(automationId, "failed");
  await addAutomationLog(automationId, "error", reason);
  await updateAutomationStats(automationId, {
    report: reason,
    lastActionAt: new Date().toISOString(),
  });
  throw new Error(reason);
}

async function processGroupProspect(auto: Automation): Promise<void> {
  const quota = await canSendOutbound();
  if (!quota.ok) {
    await addAutomationLog(auto.id, "warning", quota.reason ?? "Quota journalier atteint — envois en pause.");
    return;
  }

  const target = await getNextPendingTarget(auto.id);
  if (!target) {
    const targets = await listAutomationTargets(auto.id, { limit: 1 });
    if (targets.length === 0) {
      return;
    }
    await updateAutomationStatus(auto.id, "completed");
    await addAutomationLog(auto.id, "success", "Tous les membres ont été contactés. Automatisation terminée.");
    const fresh = await getAutomation(auto.id);
    await updateAutomationStats(auto.id, {
      report: `Campagne terminée. ${fresh?.stats.contacted ?? 0} contact(s) envoyé(s).`,
      lastActionAt: new Date().toISOString(),
    });
    return;
  }

  const ab = pickAbVariant(auto);
  let message = ab.message.trim();
  if (!message) {
    await updateAutomationStatus(auto.id, "failed");
    await addAutomationLog(auto.id, "error", "Message initial manquant dans la configuration.");
    return;
  }

  if (auto.config.personalizeMessages) {
    try {
      message = await generatePersonalizedOpener({
        template: message,
        memberName: target.target_label || chatIdToDisplay(target.target_id),
        groupName: auto.config.groupName || "groupe",
        conversationGuide: auto.config.conversationGuide,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await addAutomationLog(auto.id, "warning", `Personnalisation IA échouée, message modèle utilisé: ${msg}`);
    }
  }

  try {
    const priority = auto.config.personalizeMessages ? 7 : 6;
    await enqueueSend({
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
      await setContactAutoReply(target.target_id, true);
    }
    await saveContact({
      phone: target.target_id,
      name: target.target_label ?? undefined,
      status: "en_conversation",
      autoReply: auto.config.enableAutoReply !== false,
    });

    if (auto.config.sequenceSteps?.length) {
      await startSequenceForContact({
        contactPhone: target.target_id,
        name: `Séquence — ${auto.name}`,
        steps: auto.config.sequenceSteps as import("./db.js").SequenceStep[],
        automationId: auto.id,
      });
    }

    await updateAutomationTarget(auto.id, target.target_id, { status: "contacted" });
    await updateAutomationTargetAb(auto.id, target.target_id, ab.variantId);
    await recordAbSent(auto.id, ab.variantId);

    const label = target.target_label || chatIdToDisplay(target.target_id);
    await addAutomationLog(
      auto.id,
      "success",
      `Message programmé pour ${label}${ab.variantId !== "default" ? ` [A/B ${ab.variantId}]` : ""}`
    );

    const stats = (await getAutomation(auto.id))?.stats ?? {};
    await updateAutomationStats(auto.id, {
      outboundUsed: (stats.outboundUsed ?? 0) + 1,
      lastActionAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAutomationTarget(auto.id, target.target_id, { status: "error", notes: msg });
    await addAutomationLog(auto.id, "error", `Échec pour ${target.target_label || target.target_id}: ${msg}`);
  }
}

async function processAutomation(auto: Automation): Promise<void> {
  if (auto.type === "group_prospect") {
    await processGroupProspect(auto);
  }
}

async function processTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const active = await listActiveAutomations();
    for (const auto of active) {
      try {
        await processAutomation(auto);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await addAutomationLog(auto.id, "error", `Erreur moteur : ${msg}`);
      }
    }
  } finally {
    running = false;
  }
}

export async function bootstrapGroupProspectTargets(automationId: number): Promise<number> {
  const auto = await getAutomation(automationId);
  if (!auto || auto.type !== "group_prospect") return 0;

  if (!auto.config.groupId) {
    await failAutomationNoTargets(
      automationId,
      "groupId manquant — impossible de charger les membres du groupe."
    );
  }

  const groupId = auto.config.groupId!;

  await requireEvolutionConnected("le chargement des membres du groupe");

  const group = await getGroupMembers(groupId);
  const maxMembers = Math.min(Math.max(auto.config.maxMembers ?? 30, 1), 50);

  const eligible = await Promise.all(
    group.participants.map(async (p) => {
      const rawId = p.id;
      const id = normalizeGroupParticipantId(rawId);
      return {
        id,
        name: p.name || chatIdToDisplay(id),
        rawId,
        blocked: (await isContactBlocked(id)) || (await isContactBlocked(rawId)),
      };
    })
  );

  const participants = eligible.filter((p) => !p.blocked).slice(0, maxMembers);

  if (!group.participants.length) {
    await failAutomationNoTargets(
      automationId,
      `Aucun membre récupéré depuis « ${group.subject || auto.config.groupName || groupId} ». ` +
        "Vérifiez que WhatsApp est autorisé (état authorized) et que vous êtes membre du groupe."
    );
  }

  if (!participants.length) {
    await failAutomationNoTargets(
      automationId,
      "Aucun membre éligible (tous bloqués ou liste vide après filtrage)."
    );
  }

  const added = await addAutomationTargets(
    automationId,
    participants.map((p) => ({
      targetId: p.id,
      targetLabel: p.name,
    }))
  );

  await addAutomationLog(
    automationId,
    "info",
    `${added} membre(s) ajouté(s) depuis le groupe « ${group.subject || auto.config.groupName || groupId} »`
  );

  if (added === 0) {
    await failAutomationNoTargets(
      automationId,
      "Aucune nouvelle cible ajoutée (membres déjà présents dans cette campagne)."
    );
  }

  await updateAutomationStats(automationId, {
    report: `Prospection lancée sur ${added} membre(s).`,
    lastActionAt: new Date().toISOString(),
  });
  return added;
}

export async function reloadGroupProspectTargets(automationId: number): Promise<number> {
  const auto = await getAutomation(automationId);
  if (!auto || auto.type !== "group_prospect") {
    throw new Error("Automatisation group_prospect introuvable.");
  }
  if (!auto.config.groupId) {
    throw new Error("groupId manquant dans la configuration.");
  }

  await updateAutomationStatus(automationId, "active");
  await addAutomationLog(automationId, "info", "Rechargement des membres du groupe…");
  return bootstrapGroupProspectTargets(automationId);
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
