/** Schéma du plan d'automatisation (partagé UI / backend). */

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
  kind: PlanNodeKind | string;
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
  type?: string;
  nodes: AutomationPlanNode[];
  edges: AutomationPlanEdge[];
}

const FENCE_RE = /```klanvio-plan\s*\n([\s\S]*?)```/i;

export function extractPlanFromText(text: string): {
  plan: AutomationVisualPlan | null;
  textWithoutPlan: string;
} {
  const match = FENCE_RE.exec(text);
  if (!match) return { plan: null, textWithoutPlan: text };
  try {
    const plan = JSON.parse(match[1].trim()) as AutomationVisualPlan;
    if (!plan?.nodes || !Array.isArray(plan.nodes)) {
      return { plan: null, textWithoutPlan: text };
    }
    const textWithoutPlan = text.replace(match[0], "").trim();
    return { plan, textWithoutPlan };
  } catch {
    return { plan: null, textWithoutPlan: text };
  }
}

export function planToDownloadJson(plan: AutomationVisualPlan): string {
  return JSON.stringify(plan, null, 2);
}
