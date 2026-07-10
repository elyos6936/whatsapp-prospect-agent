import {
  addAutomationLog,
  addAutomationTargets,
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
  requireGreenApiAuthorized,
} from "./greenapi.js";
import { generatePersonalizedOpener } from "./prospect-personalizer.js";
import { startSequenceForContact } from "./sequences.js";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

function failAutomationNoTargets(automationId: number, reason: string): never {
  updateAutomationStatus(automationId, "failed");
  addAutomationLog(automationId, "error", reason);
  updateAutomationStats(automationId, {
    report: reason,
    lastActionAt: new Date().toISOString(),
  });
  throw new Error(reason);
}

async function processGroupProspect(auto: Automation): Promise<void> {
  const target = getNextPendingTarget(auto.id);
  if (!target) {
    const targets = listAutomationTargets(auto.id, { limit: 1 });
    if (targets.length === 0) {
      return;
    }
    updateAutomationStatus(auto.id, "completed");
    addAutomationLog(auto.id, "success", "Tous les membres ont été contactés. Automatisation terminée.");
    const fresh = getAutomation(auto.id);
    updateAutomationStats(auto.id, {
      report: `Campagne terminée. ${fresh?.stats.contacted ?? 0} contact(s) envoyé(s).`,
      lastActionAt: new Date().toISOString(),
    });
    return;
  }

  const ab = pickAbVariant(auto);
  let message = ab.message.trim();
  if (!message) {
    updateAutomationStatus(auto.id, "failed");
    addAutomationLog(auto.id, "error", "Message initial manquant dans la configuration.");
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
      addAutomationLog(auto.id, "warning", `Personnalisation IA échouée, message modèle utilisé: ${msg}`);
    }
  }

  try {
    const priority = auto.config.personalizeMessages ? 7 : 6;
    enqueueSend({
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
      setContactAutoReply(target.target_id, true);
    }
    saveContact({
      phone: target.target_id,
      name: target.target_label ?? undefined,
      status: "en_conversation",
      autoReply: auto.config.enableAutoReply !== false,
    });

    if (auto.config.sequenceSteps?.length) {
      startSequenceForContact({
        contactPhone: target.target_id,
        name: `Séquence — ${auto.name}`,
        steps: auto.config.sequenceSteps as import("./db.js").SequenceStep[],
        automationId: auto.id,
      });
    }

    updateAutomationTarget(auto.id, target.target_id, { status: "contacted" });
    updateAutomationTargetAb(auto.id, target.target_id, ab.variantId);
    recordAbSent(auto.id, ab.variantId);

    const label = target.target_label || chatIdToDisplay(target.target_id);
    addAutomationLog(auto.id, "success", `Message programmé pour ${label}${ab.variantId !== "default" ? ` [A/B ${ab.variantId}]` : ""}`);

    const stats = getAutomation(auto.id)?.stats ?? {};
    updateAutomationStats(auto.id, {
      outboundUsed: (stats.outboundUsed ?? 0) + 1,
      lastActionAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateAutomationTarget(auto.id, target.target_id, { status: "error", notes: msg });
    addAutomationLog(auto.id, "error", `Échec pour ${target.target_label || target.target_id}: ${msg}`);
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
    const active = listActiveAutomations();
    for (const auto of active) {
      try {
        await processAutomation(auto);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addAutomationLog(auto.id, "error", `Erreur moteur : ${msg}`);
      }
    }
  } finally {
    running = false;
  }
}

export async function bootstrapGroupProspectTargets(automationId: number): Promise<number> {
  const auto = getAutomation(automationId);
  if (!auto || auto.type !== "group_prospect") return 0;

  const groupId = auto.config.groupId;
  if (!groupId) {
    failAutomationNoTargets(
      automationId,
      "groupId manquant — impossible de charger les membres du groupe."
    );
  }

  await requireGreenApiAuthorized("le chargement des membres du groupe");

  const group = await getGroupMembers(groupId);
  const maxMembers = Math.min(Math.max(auto.config.maxMembers ?? 30, 1), 50);

  const eligible = group.participants
    .map((p) => ({
      id: normalizeGroupParticipantId(p.id),
      name: p.name || chatIdToDisplay(p.id),
      rawId: p.id,
    }))
    .filter((p) => !isContactBlocked(p.id) && !isContactBlocked(p.rawId));

  const participants = eligible.slice(0, maxMembers);

  if (!group.participants.length) {
    failAutomationNoTargets(
      automationId,
      `Aucun membre récupéré depuis « ${group.subject || auto.config.groupName || groupId} ». ` +
        "Vérifiez que WhatsApp est autorisé (état authorized) et que vous êtes membre du groupe."
    );
  }

  if (!participants.length) {
    failAutomationNoTargets(
      automationId,
      "Aucun membre éligible (tous bloqués ou liste vide après filtrage)."
    );
  }

  const added = addAutomationTargets(
    automationId,
    participants.map((p) => ({
      targetId: p.id,
      targetLabel: p.name,
    }))
  );

  addAutomationLog(
    automationId,
    "info",
    `${added} membre(s) ajouté(s) depuis le groupe « ${group.subject || auto.config.groupName || groupId} »`
  );

  if (added === 0) {
    failAutomationNoTargets(
      automationId,
      "Aucune nouvelle cible ajoutée (membres déjà présents dans cette campagne)."
    );
  }

  updateAutomationStats(automationId, {
    report: `Prospection lancée sur ${added} membre(s).`,
    lastActionAt: new Date().toISOString(),
  });
  return added;
}

/** Réactive une campagne groupe et recharge les membres depuis Green-API. */
export async function reloadGroupProspectTargets(automationId: number): Promise<number> {
  const auto = getAutomation(automationId);
  if (!auto || auto.type !== "group_prospect") {
    throw new Error("Automatisation group_prospect introuvable.");
  }
  if (!auto.config.groupId) {
    throw new Error("groupId manquant dans la configuration.");
  }

  updateAutomationStatus(automationId, "active");
  addAutomationLog(automationId, "info", "Rechargement des membres du groupe…");
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
