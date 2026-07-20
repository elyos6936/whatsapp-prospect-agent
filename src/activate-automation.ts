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

/**
 * Active une automatisation (draft/paused → active) + bootstrap cibles.
 * Si d'autres campagnes sont actives, elles passent automatiquement en pause.
 * Utilisé par l'outil agent et le bouton « Lancer » / activation UI.
 * Activer une campagne implique que la simulation est considérée validée.
 */
export async function activateAutomationCore(
  userId: number,
  automationId: number,
  options: { source?: "agent" | "simulation_ui" } = {}
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
  if (!["draft", "paused"].includes(detail.automation.status)) {
    return {
      ok: false,
      error: `Impossible d'activer depuis le statut « ${detail.automation.status} ».`,
      automationId: id,
    };
  }

  const auto = detail.automation;
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

  let safeConfig: AutomationConfig = { ...auto.config, enableAutoReply: true };
  if (isOutbound) {
    if (!safeConfig.maxPerDay || safeConfig.maxPerDay <= 0) {
      safeConfig.maxPerDay = ANTI_BAN.defaultCampaignMaxPerDay;
    }
    if (safeConfig.quietHoursStart == null) safeConfig.quietHoursStart = 9;
    if (safeConfig.quietHoursEnd == null) safeConfig.quietHoursEnd = 20;
    if (!safeConfig.relance?.enabled && !safeConfig.sequenceSteps?.length) {
      safeConfig.relance = defaultRelanceConfig();
    }
  }
  // Activer = simulation considérée validée (pas de double validation).
  if (!safeConfig.simulationValidatedAt) {
    safeConfig = { ...safeConfig, simulationValidatedAt: new Date().toISOString() };
  }

  // Une seule campagne active à la fois
  const pausedOthers = await pauseOtherActiveAutomations(userId, id);

  let targetsAdded = 0;
  await updateAutomationConfig(userId, id, safeConfig);
  await setAutoReplyEnabled(userId, true);

  try {
    if (auto.type === "group_prospect") {
      if (!auto.config.groupId || !auto.config.initialMessage) {
        return {
          ok: false,
          error: "Groupe ou message initial manquant dans la configuration.",
          automationId: id,
        };
      }
      await updateAutomationStatus(userId, id, "active");
      targetsAdded = await bootstrapGroupProspectTargets(userId, id);
      await resumeAutomationMessaging(userId, id);
    } else if (auto.type === "contact_prospect") {
      if (!auto.config.initialMessage || !auto.config.contactTargets?.length) {
        return {
          ok: false,
          error: "Message initial ou contacts manquants dans la configuration.",
          automationId: id,
        };
      }
      await updateAutomationStatus(userId, id, "active");
      targetsAdded = await bootstrapContactProspectTargets(userId, id);
      await resumeAutomationMessaging(userId, id);
    } else {
      await updateAutomationStatus(userId, id, "active");
      await resumeAutomationMessaging(userId, id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Activation échouée : ${msg}`, automationId: id };
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
  return auto.status === "draft" || auto.status === "paused";
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
