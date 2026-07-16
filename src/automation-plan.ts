/**
 * Plan visuel d'une automatisation (graphe nodes/edges → rendu Excalidraw côté client).
 * Pas de dépendance Excalidraw côté serveur : on stocke un schéma portable.
 */

import type { Automation, AutomationConfig, AutomationType } from "./db.js";

export type PlanNodeKind =
  | "source"
  | "message"
  | "delay"
  | "reply"
  | "goal"
  | "branch"
  | "stop";

export interface AutomationPlanNode {
  id: string;
  label: string;
  subtitle?: string;
  kind: PlanNodeKind;
}

export interface AutomationPlanEdge {
  from: string;
  to: string;
  label?: string;
}

export interface AutomationVisualPlan {
  version: 1;
  title: string;
  updatedAt: string;
  automationId?: number;
  type?: AutomationType;
  /** Texte complet du 1er message (simulation — non tronqué). */
  openerText?: string;
  nodes: AutomationPlanNode[];
  edges: AutomationPlanEdge[];
}

const PLAN_FENCE_OPEN = "```klanvio-plan";
const PLAN_FENCE_CLOSE = "```";

export function formatPlanFence(plan: AutomationVisualPlan): string {
  return `${PLAN_FENCE_OPEN}\n${JSON.stringify(plan)}\n${PLAN_FENCE_CLOSE}`;
}

export function formatPlanDisplay(plan: AutomationVisualPlan, intro?: string): string {
  const head =
    intro?.trim() ||
    `Voici le déroulé de « ${plan.title} ». Ouvre la **simulation** à droite pour tester les réponses.`;
  return `${head}\n\n${formatPlanFence(plan)}`;
}

function clip(s: string | undefined, max = 72): string | undefined {
  if (!s?.trim()) return undefined;
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function formatScheduleHint(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function pushEdge(
  edges: AutomationPlanEdge[],
  from: string,
  to: string,
  label?: string
): void {
  edges.push({ from, to, ...(label ? { label } : {}) });
}

/** Construit le plan à partir de la campagne (source de vérité). */
export function buildAutomationVisualPlan(
  auto: Pick<Automation, "id" | "name" | "type" | "config" | "summary">
): AutomationVisualPlan {
  const cfg = auto.config ?? ({} as AutomationConfig);
  const nodes: AutomationPlanNode[] = [];
  const edges: AutomationPlanEdge[] = [];
  const now = new Date().toISOString();

  const add = (node: AutomationPlanNode) => {
    nodes.push(node);
  };

  // Source
  if (auto.type === "group_prospect") {
    add({
      id: "source",
      label: "Groupe source",
      subtitle: clip(cfg.groupName || cfg.groupId || "Groupe WhatsApp"),
      kind: "source",
    });
  } else if (auto.type === "contact_prospect") {
    const n = cfg.contactTargets?.length ?? 0;
    add({
      id: "source",
      label: "Contacts ciblés",
      subtitle: n ? `${n} contact(s)` : "Liste de contacts",
      kind: "source",
    });
  } else if (auto.type === "keyword_sales") {
    const phrases = cfg.triggerPhrases ?? cfg.keywords ?? [];
    add({
      id: "source",
      label: "Déclencheur entrant",
      subtitle: phrases.length ? clip(phrases.join(" · "), 56) : "Mots-clés",
      kind: "source",
    });
  } else {
    add({
      id: "source",
      label: "Démarrage",
      subtitle: clip(auto.summary ?? undefined) || "Suivi",
      kind: "source",
    });
  }

  let last = "source";

  // Contraintes avant l'envoi
  if (cfg.scheduledStartAt) {
    add({
      id: "schedule",
      label: "Lancement programmé",
      subtitle: clip(formatScheduleHint(cfg.scheduledStartAt), 48),
      kind: "delay",
    });
    pushEdge(edges, last, "schedule", "à l'heure");
    last = "schedule";
  }

  if (typeof cfg.quietHoursStart === "number" && typeof cfg.quietHoursEnd === "number") {
    add({
      id: "hours",
      label: "Fenêtre d'envoi",
      subtitle: `${cfg.quietHoursEnd}h–${cfg.quietHoursStart}h · anti-blocage`,
      kind: "delay",
    });
    pushEdge(edges, last, "hours");
    last = "hours";
  }

  // Espacement proportionnel au volume (cohérent avec recommendOutboundGaps)
  if (
    (auto.type === "group_prospect" || auto.type === "contact_prospect") &&
    (cfg.minDelaySeconds != null || cfg.maxDelaySeconds != null)
  ) {
    const minS = cfg.minDelaySeconds ?? 45;
    const maxS = cfg.maxDelaySeconds ?? 90;
    const n =
      auto.type === "contact_prospect"
        ? cfg.contactTargets?.length ?? 0
        : cfg.maxMembers ?? 0;
    add({
      id: "spacing",
      label: "Rythme d'envoi",
      subtitle:
        n > 0
          ? `${minS}–${maxS} s entre messages · ${n} prospect(s)`
          : `${minS}–${maxS} s entre messages`,
      kind: "delay",
    });
    pushEdge(edges, last, "spacing");
    last = "spacing";
  }

  // Premier message / première réponse
  if (auto.type === "keyword_sales") {
    add({
      id: "open",
      label: "Première réponse IA",
      subtitle: clip(cfg.salesScript || cfg.conversationGuide || cfg.initialMessage),
      kind: "message",
    });
    pushEdge(edges, last, "open", "mot-clé");
  } else if (auto.type === "group_prospect") {
    add({
      id: "open",
      label: "Message d'ouverture",
      subtitle: cfg.initialMessage?.trim() || undefined,
      kind: "message",
    });
    pushEdge(edges, last, "open", "membres");
  } else if (auto.type === "contact_prospect") {
    add({
      id: "open",
      label: "Message d'ouverture",
      subtitle: cfg.initialMessage?.trim() || undefined,
      kind: "message",
    });
    pushEdge(edges, last, "open", "envoi");
  } else {
    add({
      id: "open",
      label: "Séquence",
      subtitle: clip(cfg.conversationGuide || cfg.initialMessage),
      kind: "message",
    });
    pushEdge(edges, last, "open");
  }
  last = "open";

  if (cfg.enableAutoReply !== false) {
    add({
      id: "reply",
      label: "Réponses auto IA",
      subtitle: clip(
        [
          cfg.conversationGuide || cfg.salesScript,
          cfg.stickersEnabled ? "stickers OK" : "texte seul (sans sticker/emoji)",
        ]
          .filter(Boolean)
          .join(" · "),
        72
      ),
      kind: "reply",
    });
    pushEdge(edges, last, "reply", "si répond");
    last = "reply";
  }

  // Branches latérales (ne déplacent pas le fil principal)
  if (cfg.relance?.enabled && (cfg.relance.delaysDays?.length ?? 0) > 0) {
    const delays = cfg.relance.delaysDays.join(" / ");
    add({
      id: "relance",
      label: "Relances",
      subtitle: `J+${delays}${cfg.relance.hour != null ? ` · ${cfg.relance.hour}h` : ""}`,
      kind: "delay",
    });
    const fromReply = nodes.some((n) => n.id === "reply") ? "reply" : last;
    pushEdge(edges, fromReply, "relance", "silence");
    if (fromReply === "reply") {
      pushEdge(edges, "relance", "reply", "reprend");
    }
  }

  const goalLabel =
    cfg.closingGoal === "appointment"
      ? "Objectif : rendez-vous"
      : cfg.closingGoal === "payment"
        ? "Objectif : paiement"
        : cfg.closingGoal === "link"
          ? "Objectif : lien"
          : cfg.closingGoal === "delivery"
            ? "Objectif : livraison"
            : "Objectif";

  add({
    id: "goal",
    label: goalLabel,
    subtitle: clip(cfg.closingLink || cfg.productName || cfg.price),
    kind: "goal",
  });
  pushEdge(edges, last, "goal", "conversion");

  if (cfg.stopOnDissatisfaction || cfg.stopOnUnknownQuestion) {
    add({
      id: "stop",
      label: "Arrêt auto",
      subtitle: [
        cfg.stopOnDissatisfaction ? "mécontentement" : null,
        cfg.stopOnUnknownQuestion ? "question hors cadre" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      kind: "stop",
    });
    const from = nodes.some((n) => n.id === "reply") ? "reply" : last;
    pushEdge(edges, from, "stop", "signal");
  }

  return {
    version: 1,
    title: auto.name || "Automatisation",
    updatedAt: now,
    automationId: auto.id,
    type: auto.type,
    /** Texte complet du 1er message (jamais tronqué — pour la simulation). */
    openerText: cfg.initialMessage?.trim() || undefined,
    nodes,
    edges,
  };
}

export { planToExcalidrawSkeleton } from "./excalidraw-plan.js";

