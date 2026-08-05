import {
  getAutomationDetail,
  updateAutomationConfig,
  updateAutomationStatus,
  setAutoReplyEnabled,
  resumeAutomationMessaging,
  saveAgentMessageForAutomation,
  pauseOtherActiveAutomations,
  listActiveAutomations,
  type Automation,
  type AutomationConfig,
} from "./db.js";
import {
  bootstrapGroupProspectTargets,
  bootstrapContactProspectTargets,
  kickAutomationForUser,
} from "./automation-engine.js";
import { requireEvolutionConnected } from "./evolutionapi.js";
import { ANTI_BAN, defaultRelanceConfig } from "./anti-ban.js";
import { hasTemplatePlaceholders } from "./outbound-sanitize.js";
import { needsAppointmentLink } from "./campaign-briefing.js";

export type ActivateAutomationResult =
  | {
      ok: true;
      automationId: number;
      name: string;
      status: "active";
      targetsAdded: number;
      message: string;
      pausedOthers?: Array<{ id: number; name: string }>;
    }
  | { ok: false; error: string; automationId?: number };

async function restorePausedAutomations(
  userId: number,
  paused: Array<{ id: number; name: string }>
): Promise<void> {
  for (const p of paused) {
    try {
      await updateAutomationStatus(userId, p.id, "active");
      const auto = await getAutomationDetail(userId, p.id);
      if (auto) {
        const isGb =
          auto.automation.type === "group_broadcast" ||
          auto.automation.config.mode === "group_broadcast";
        await updateAutomationConfig(userId, p.id, {
          ...auto.automation.config,
          enableAutoReply: isGb ? false : true,
        });
        if (!isGb) await resumeAutomationMessaging(userId, p.id);
      }
    } catch (err) {
      console.warn("[activate] rollback restore pause failed:", p.id, err);
    }
  }
}

/**
 * Active une automatisation (draft/paused/failed → active) + bootstrap cibles.
 * Si d'autres campagnes sont actives, elles passent automatiquement en pause.
 * Utilisé par l'outil agent et le bouton « Lancer » / activation UI.
 * Activer une campagne implique que la simulation est considérée validée.
 */
export async function activateAutomationCore(
  userId: number,
  automationId: number,
  options: {
    source?: "agent" | "simulation_ui";
    /** Chat : « lance sans simulation » explicite. */
    allowWithoutSimulation?: boolean;
  } = {}
): Promise<ActivateAutomationResult> {
  const id = Number(automationId);
  if (!Number.isFinite(id)) {
    return { ok: false, error: "Identifiant d'automatisation invalide." };
  }

  const detail = await getAutomationDetail(userId, id);
  if (!detail) {
    return { ok: false, error: "Automatisation introuvable.", automationId: id };
  }
  if (detail.automation.status === "active") {
    return {
      ok: true,
      automationId: id,
      name: detail.automation.name,
      status: "active",
      targetsAdded: 0,
      message: `« ${detail.automation.name} » est déjà active.`,
    };
  }
  // failed = souvent un plantage après pause/activation (ex. message manquant, 0 cible) — on doit pouvoir relancer
  if (!["draft", "paused", "failed"].includes(detail.automation.status)) {
    return {
      ok: false,
      error: `Impossible d'activer depuis le statut « ${detail.automation.status} ».`,
      automationId: id,
    };
  }

  const auto = detail.automation;
  const priorStatus = auto.status;
  const priorConfig = { ...auto.config };
  void options.allowWithoutSimulation;

  if (
    (auto.type === "keyword_sales" || auto.config.mode === "inbound_closing") &&
    !auto.config.price?.trim()
  ) {
    return {
      ok: false,
      error: "Prix manquant — complétez la configuration avant d'activer.",
      automationId: id,
    };
  }
  if (
    (auto.config.closingGoal === "appointment" ||
      auto.config.closingGoal === "payment" ||
      auto.config.closingGoal === "link") &&
    !auto.config.closingLink?.trim()
  ) {
    return {
      ok: false,
      error: "Lien manquant (closing_link) — complétez la configuration avant d'activer.",
      automationId: id,
    };
  }
  if (
    needsAppointmentLink({
      closingGoal: auto.config.closingGoal,
      conversationGuide: auto.config.conversationGuide,
      initialMessage: auto.config.initialMessage,
      closingLink: auto.config.closingLink,
      productName: auto.config.productName,
    })
  ) {
    return {
      ok: false,
      error: "Objectif RDV sans lien de réservation — ajoutez le lien avant d'activer.",
      automationId: id,
    };
  }
  if (auto.config.initialMessage && hasTemplatePlaceholders(auto.config.initialMessage)) {
    return {
      ok: false,
      error: "Le premier message contient encore des crochets […] — corrigez-le d'abord.",
      automationId: id,
    };
  }

  const isOutbound =
    auto.type === "group_prospect" ||
    auto.type === "contact_prospect" ||
    auto.type === "group_broadcast" ||
    auto.config.mode === "outbound_prospect" ||
    auto.config.mode === "group_broadcast";
  const isDmProspecting =
    auto.type === "group_prospect" ||
    auto.type === "contact_prospect" ||
    auto.config.mode === "outbound_prospect";
  if (isOutbound) {
    try {
      await requireEvolutionConnected(userId, "l'activation de la campagne");
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "WhatsApp non connecté — impossible d'activer.",
        automationId: id,
      };
    }
  }
  // Anti-blocage : Google Contacts obligatoire avant prospection DM (pas broadcast groupes).
  if (isDmProspecting) {
    try {
      const { requireGoogleContactsConnected } = await import(
        "./integrations/google-contacts.js"
      );
      await requireGoogleContactsConnected(userId);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Google Contacts requis avant prospection.",
        automationId: id,
      };
    }
  }

  // Valider la config métier AVANT toute mutation (pause / status / auto-reply).
  if (auto.type === "group_prospect") {
    if (!auto.config.groupId || !auto.config.initialMessage) {
      return {
        ok: false,
        error: "Groupe ou message initial manquant dans la configuration.",
        automationId: id,
      };
    }
  } else if (auto.type === "contact_prospect") {
    if (!auto.config.initialMessage || !auto.config.contactTargets?.length) {
      return {
        ok: false,
        error: "Message initial ou contacts manquants dans la configuration.",
        automationId: id,
      };
    }
  } else if (auto.type === "group_broadcast") {
    if (!auto.config.initialMessage || !auto.config.groupTargets?.length) {
      return {
        ok: false,
        error: "Message ou groupes manquants (groupes où vous êtes admin).",
        automationId: id,
      };
    }
  }

  let safeConfig: AutomationConfig = {
    ...auto.config,
    enableAutoReply: auto.type === "group_broadcast" ? false : true,
  };
  if (isOutbound) {
    if (!safeConfig.maxPerDay || safeConfig.maxPerDay <= 0) {
      safeConfig.maxPerDay = ANTI_BAN.defaultCampaignMaxPerDay;
    }
    // Heures CALMES (pas d'envoi) : nuit 20h→9h = activité 9h–20h.
    // Ancien défaut 9→20 inversait la logique (« hors fenêtre » toute la journée).
    const { resolveOutboundQuietHours } = await import("./quiet-hours.js");
    const quiet = resolveOutboundQuietHours(
      safeConfig.quietHoursStart,
      safeConfig.quietHoursEnd
    );
    safeConfig.quietHoursStart = quiet.start;
    safeConfig.quietHoursEnd = quiet.end;
    if (
      auto.type !== "group_broadcast" &&
      !safeConfig.relance?.enabled &&
      !safeConfig.sequenceSteps?.length
    ) {
      safeConfig.relance = defaultRelanceConfig();
    }
  } else if (auto.type === "keyword_sales" || auto.config.mode === "inbound_closing") {
    // Closing entrant : défaut plage 8h–19h, vagues de 50 / gap 2h
    const { resolveInboundQuietHours } = await import("./quiet-hours.js");
    const quiet = resolveInboundQuietHours(
      safeConfig.quietHoursStart,
      safeConfig.quietHoursEnd
    );
    safeConfig.quietHoursStart = quiet.start;
    safeConfig.quietHoursEnd = quiet.end;
    if (safeConfig.inboundBatchSize == null) safeConfig.inboundBatchSize = 50;
    if (safeConfig.inboundWaveGapMinutes == null) safeConfig.inboundWaveGapMinutes = 120;
  }
  // Activer = simulation considérée validée (pas de double validation).
  if (!safeConfig.simulationValidatedAt) {
    safeConfig = { ...safeConfig, simulationValidatedAt: new Date().toISOString() };
  }

  // Une seule campagne active à la fois
  const pausedOthers = await pauseOtherActiveAutomations(userId, id);

  let targetsAdded = 0;
  await updateAutomationConfig(userId, id, safeConfig);

  // Figé playbook + re-sync mémoire (après écriture config) → réponses prospects alignées
  try {
    const { freezeLivePlaybookForAutomation } = await import("./campaign-sync.js");
    await freezeLivePlaybookForAutomation(userId, id);
  } catch (err) {
    console.warn("[activate] freeze playbook:", err);
  }

  await setAutoReplyEnabled(userId, true);

  const rollback = async (error: string): Promise<ActivateAutomationResult> => {
    try {
      await updateAutomationStatus(userId, id, priorStatus === "active" ? "draft" : priorStatus);
      await updateAutomationConfig(userId, id, {
        ...priorConfig,
        simulationValidatedAt: priorConfig.simulationValidatedAt,
      });
      await restorePausedAutomations(userId, pausedOthers);
    } catch (err) {
      console.warn("[activate] rollback failed:", err);
    }
    return { ok: false, error, automationId: id };
  };

  try {
    if (auto.type === "group_prospect") {
      await updateAutomationStatus(userId, id, "active");
      targetsAdded = await bootstrapGroupProspectTargets(userId, id);
      await resumeAutomationMessaging(userId, id);
    } else if (auto.type === "contact_prospect") {
      await updateAutomationStatus(userId, id, "active");
      targetsAdded = await bootstrapContactProspectTargets(userId, id);
      await resumeAutomationMessaging(userId, id);
    } else if (auto.type === "group_broadcast") {
      await updateAutomationStatus(userId, id, "active");
      const { bootstrapGroupBroadcastTargets } = await import("./automation-engine.js");
      targetsAdded = await bootstrapGroupBroadcastTargets(userId, id);
      await resumeAutomationMessaging(userId, id);
    } else {
      await updateAutomationStatus(userId, id, "active");
      await resumeAutomationMessaging(userId, id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return rollback(`Activation échouée : ${msg}`);
  }

  kickAutomationForUser(userId);

  const pausedNote = pausedOthers.length
    ? ` Campagne(s) mise(s) en pause : ${pausedOthers.map((p) => `« ${p.name} »`).join(", ")}.`
    : "";

  const message =
    options.source === "simulation_ui"
      ? `Simulation validée — « ${auto.name} » est lancée.${targetsAdded ? ` ${targetsAdded} contact(s) en file.` : ""}${pausedNote}`
      : `« ${auto.name} » activée.${targetsAdded ? ` ${targetsAdded} contact(s) chargé(s).` : ""}${pausedNote}`;

  if (options.source === "simulation_ui") {
    await saveAgentMessageForAutomation(userId, id, "assistant", `✅ ${message}`).catch(() => {});
  }

  return {
    ok: true,
    automationId: id,
    name: auto.name,
    status: "active",
    targetsAdded,
    message,
    pausedOthers,
  };
}

export function automationIsDraftOrPaused(auto: Automation): boolean {
  return auto.status === "draft" || auto.status === "paused" || auto.status === "failed";
}

/** Indique s'il existe déjà une campagne active (hors id optionnel). */
export async function hasOtherActiveCampaign(
  userId: number,
  exceptId?: number
): Promise<{ hasActive: boolean; active: Automation[] }> {
  const active = (await listActiveAutomations(userId)).filter(
    (a) => exceptId == null || a.id !== exceptId
  );
  return { hasActive: active.length > 0, active };
}
