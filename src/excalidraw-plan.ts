/**
 * Construit un squelette Excalidraw à partir d'un plan Klanvio.
 * Style : noir + Nunito. Flèches en géométrie explicite (alignement fiable).
 *
 * Réf. API : https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton
 */

import type { AutomationVisualPlan, PlanNodeKind } from "./automation-plan.js";

/** Numéros FONT_FAMILY Excalidraw (éviter d'importer le package côté serveur). */
export const EXCALI_FONT = {
  Virgil: 1,
  Helvetica: 2,
  Cascadia: 3,
  Excalifont: 5,
  Nunito: 6,
} as const;

const INK = "#1e1e1e";
const FILL = "transparent";
const FONT = EXCALI_FONT.Nunito;

const NODE_W = 220;
const NODE_H = 92;
const GAP_Y = 72;
const BRANCH_GAP = 56;
const PAD = 48;
const ARROW_INSET = 2;

type Pos = { x: number; y: number };

function isBranch(id: string, kind: string): boolean {
  return kind === "stop" || id === "relance";
}

function layout(plan: AutomationVisualPlan): Map<string, Pos> {
  const spine = plan.nodes.filter((n) => !isBranch(n.id, n.kind));
  const branches = plan.nodes.filter((n) => isBranch(n.id, n.kind));
  const spineX = PAD + (branches.length ? NODE_W + BRANCH_GAP : 0);
  const positions = new Map<string, Pos>();

  spine.forEach((node, i) => {
    positions.set(node.id, { x: spineX, y: PAD + 52 + i * (NODE_H + GAP_Y) });
  });

  const anchorId =
    (positions.has("reply") && "reply") ||
    (positions.has("open") && "open") ||
    spine[spine.length - 1]?.id;

  branches.forEach((node) => {
    const anchor = anchorId ? positions.get(anchorId) : undefined;
    const y = anchor?.y ?? PAD + 52;
    const side = node.kind === "stop" || node.id === "stop" ? 1 : -1;
    positions.set(node.id, {
      x: spineX + side * (NODE_W + BRANCH_GAP),
      y: y + (node.id === "relance" ? NODE_H + GAP_Y * 0.4 : 0),
    });
  });

  return positions;
}

function edgeAnchors(from: Pos, to: Pos): { sx: number; sy: number; ex: number; ey: number } {
  const fromCx = from.x + NODE_W / 2;
  const fromCy = from.y + NODE_H / 2;
  const toCx = to.x + NODE_W / 2;
  const toCy = to.y + NODE_H / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  if (Math.abs(dx) > Math.abs(dy) * 0.55) {
    if (dx > 0) {
      return {
        sx: from.x + NODE_W + ARROW_INSET,
        sy: fromCy,
        ex: to.x - ARROW_INSET,
        ey: toCy,
      };
    }
    return {
      sx: from.x - ARROW_INSET,
      sy: fromCy,
      ex: to.x + NODE_W + ARROW_INSET,
      ey: toCy,
    };
  }

  if (dy > 0) {
    return {
      sx: fromCx,
      sy: from.y + NODE_H + ARROW_INSET,
      ex: toCx,
      ey: to.y - ARROW_INSET,
    };
  }
  return {
    sx: fromCx,
    sy: from.y - ARROW_INSET,
    ex: toCx,
    ey: to.y + NODE_H + ARROW_INSET,
  };
}

/** Squelette ExcalidrawElementSkeleton[] (JSON portable). */
export function planToExcalidrawSkeleton(plan: AutomationVisualPlan): Record<string, unknown>[] {
  const positions = layout(plan);
  const elements: Record<string, unknown>[] = [];
  const childIds: string[] = [];

  elements.push({
    type: "text",
    id: "title",
    x: PAD,
    y: 24,
    text: plan.title || "Plan d’automatisation",
    fontSize: 28,
    fontFamily: FONT,
    strokeColor: INK,
  });
  childIds.push("title");

  for (const node of plan.nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const text = node.subtitle ? `${node.label}\n${node.subtitle}` : node.label;
    const id = `node-${node.id}`;
    childIds.push(id);
    const isGoal = node.kind === "goal";

    elements.push({
      type: "rectangle",
      id,
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: NODE_H,
      backgroundColor: FILL,
      strokeColor: INK,
      strokeWidth: isGoal ? 3 : 2,
      fillStyle: "solid",
      roughness: 0,
      roundness: { type: 3 },
      label: {
        text,
        fontSize: isGoal ? 17 : 15,
        fontFamily: FONT,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: INK,
      },
    });
  }

  // Frame = titre + nœuds seulement (les flèches hors frame restent alignées).
  elements.push({
    type: "frame",
    id: "frame-plan",
    name: plan.type ? `Klanvio · ${plan.type}` : "Klanvio · plan",
    children: [...childIds],
  });

  plan.edges.forEach((edge, i) => {
    const fromPos = positions.get(edge.from);
    const toPos = positions.get(edge.to);
    if (!fromPos || !toPos) return;

    const arrowId = `arrow-${i}-${edge.from}-${edge.to}`;
    const { sx, sy, ex, ey } = edgeAnchors(fromPos, toPos);
    const w = ex - sx;
    const h = ey - sy;

    elements.push({
      type: "arrow",
      id: arrowId,
      x: sx,
      y: sy,
      width: Math.abs(w) || 1,
      height: Math.abs(h) || 1,
      points: [
        [0, 0],
        [w, h],
      ],
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: "arrow",
      startArrowhead: null,
    });

    if (edge.label?.trim()) {
      const midX = (sx + ex) / 2;
      const midY = (sy + ey) / 2;
      const vertical = Math.abs(h) >= Math.abs(w);
      elements.push({
        type: "text",
        id: `${arrowId}-label`,
        x: vertical ? midX + 12 : midX - edge.label.length * 3.2,
        y: vertical ? midY - 10 : midY - 22,
        text: edge.label,
        fontSize: 13,
        fontFamily: FONT,
        strokeColor: INK,
      });
    }
  });

  return elements;
}

export { planToExcalidrawSkeleton as buildExcalidrawSkeleton };

export type { PlanNodeKind };
