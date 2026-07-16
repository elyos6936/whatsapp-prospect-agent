/**
 * Squelette Excalidraw (côté web) — noir + Nunito, lisible, sans pastels.
 */

import type { AutomationVisualPlan } from '@/lib/automation-plan';

/** FONT_FAMILY Excalidraw (sans importer le package). */
export const EXCALI_FONT = {
  Virgil: 1,
  Helvetica: 2,
  Cascadia: 3,
  Excalifont: 5,
  Nunito: 6,
} as const;

const INK = '#1e1e1e';
const FILL = 'transparent';
const FONT = EXCALI_FONT.Nunito;

const NODE_W = 200;
const NODE_H = 88;
const GAP_Y = 64;
const BRANCH_GAP = 48;
const PAD = 48;

type Pos = { x: number; y: number };

function isBranch(id: string, kind: string): boolean {
  return kind === 'stop' || id === 'relance';
}

function layout(plan: AutomationVisualPlan): Map<string, Pos> {
  const spine = plan.nodes.filter((n) => !isBranch(n.id, n.kind));
  const branches = plan.nodes.filter((n) => isBranch(n.id, n.kind));
  const spineX = PAD + (branches.length ? NODE_W + BRANCH_GAP : 0);
  const map = new Map<string, Pos>();

  spine.forEach((node, i) => {
    map.set(node.id, { x: spineX, y: PAD + 48 + i * (NODE_H + GAP_Y) });
  });

  const anchorId =
    (map.has('reply') && 'reply') ||
    (map.has('open') && 'open') ||
    spine[spine.length - 1]?.id;

  branches.forEach((node) => {
    const anchor = anchorId ? map.get(anchorId) : undefined;
    const y = anchor?.y ?? PAD + 48;
    const side = node.kind === 'stop' || node.id === 'stop' ? 1 : -1;
    map.set(node.id, {
      x: spineX + side * (NODE_W + BRANCH_GAP),
      y: y + (node.id === 'relance' ? NODE_H + GAP_Y * 0.35 : 0),
    });
  });

  return map;
}

/** ExcalidrawElementSkeleton[] pour convertToExcalidrawElements. */
export function planToExcalidrawSkeleton(plan: AutomationVisualPlan): Record<string, unknown>[] {
  const positions = layout(plan);
  const elements: Record<string, unknown>[] = [];
  const childIds: string[] = [];

  elements.push({
    type: 'text',
    id: 'title',
    x: PAD,
    y: 28,
    text: plan.title || 'Plan d’automatisation',
    fontSize: 28,
    fontFamily: FONT,
    strokeColor: INK,
  });
  childIds.push('title');

  for (const node of plan.nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const id = `node-${node.id}`;
    childIds.push(id);
    const text = node.subtitle ? `${node.label}\n${node.subtitle}` : node.label;
    const isGoal = node.kind === 'goal';

    elements.push({
      type: 'rectangle',
      id,
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: NODE_H,
      backgroundColor: FILL,
      strokeColor: INK,
      strokeWidth: isGoal ? 3 : 2,
      fillStyle: 'solid',
      roughness: 0,
      roundness: { type: 3 },
      label: {
        text,
        fontSize: isGoal ? 17 : 16,
        fontFamily: FONT,
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: INK,
      },
    });
  }

  plan.edges.forEach((edge, i) => {
    if (!positions.has(edge.from) || !positions.has(edge.to)) return;
    const arrowId = `arrow-${i}-${edge.from}-${edge.to}`;
    childIds.push(arrowId);
    const a = positions.get(edge.from)!;
    elements.push({
      type: 'arrow',
      id: arrowId,
      x: a.x + NODE_W / 2,
      y: a.y + NODE_H / 2,
      strokeColor: INK,
      strokeWidth: 2,
      roughness: 0,
      start: { id: `node-${edge.from}` },
      end: { id: `node-${edge.to}` },
      ...(edge.label
        ? {
            label: {
              text: edge.label,
              fontSize: 14,
              fontFamily: FONT,
              strokeColor: INK,
            },
          }
        : {}),
    });
  });

  elements.push({
    type: 'frame',
    id: 'frame-plan',
    name: plan.type ? `Klanvio · ${plan.type}` : 'Klanvio · plan',
    children: childIds,
  });

  return elements;
}

/** Fichier .excalidraw ouvrable dans excalidraw.com */
export function planToExcalidrawFile(
  plan: AutomationVisualPlan,
  elements: readonly unknown[],
): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'https://www.klanvio.com',
      elements,
      appState: {
        viewBackgroundColor: '#ffffff',
        gridSize: null,
        currentItemFontFamily: FONT,
      },
      files: {},
    },
    null,
    2,
  );
}
