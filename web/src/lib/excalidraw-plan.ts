/**
 * Squelette Excalidraw (côté web) — noir + Nunito, lisible, sans pastels.
 * Flèches en géométrie explicite (pas de binding fragile) pour un alignement propre.
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

const NODE_W = 220;
const NODE_H = 92;
const GAP_Y = 72;
const BRANCH_GAP = 56;
const PAD = 48;
/** Marge entre le bord du nœud et le début/fin de flèche. */
const ARROW_INSET = 2;

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
    map.set(node.id, { x: spineX, y: PAD + 52 + i * (NODE_H + GAP_Y) });
  });

  const anchorId =
    (map.has('reply') && 'reply') ||
    (map.has('open') && 'open') ||
    spine[spine.length - 1]?.id;

  branches.forEach((node) => {
    const anchor = anchorId ? map.get(anchorId) : undefined;
    const y = anchor?.y ?? PAD + 52;
    const side = node.kind === 'stop' || node.id === 'stop' ? 1 : -1;
    map.set(node.id, {
      x: spineX + side * (NODE_W + BRANCH_GAP),
      y: y + (node.id === 'relance' ? NODE_H + GAP_Y * 0.35 : 0),
    });
  });

  return map;
}

/** Points d'ancrage bord → bord (évite les flèches qui démarrent au centre). */
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
        fontSize: isGoal ? 17 : 15,
        fontFamily: FONT,
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: INK,
      },
    });
  }

  // Frame = titre + nœuds seulement. Les flèches restent hors frame :
  // les inclure cassait souvent les points (stubs / labels collés aux bords).
  elements.push({
    type: 'frame',
    id: 'frame-plan',
    name: plan.type ? `Klanvio · ${plan.type}` : 'Klanvio · plan',
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
      type: 'arrow',
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
      endArrowhead: 'arrow',
      startArrowhead: null,
    });

    if (edge.label?.trim()) {
      const midX = (sx + ex) / 2;
      const midY = (sy + ey) / 2;
      const vertical = Math.abs(h) >= Math.abs(w);
      elements.push({
        type: 'text',
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

/** HTML autonome : ouvrir dans le navigateur pour voir le plan (SVG embarqué). */
export function planToStandaloneHtml(plan: AutomationVisualPlan, svgMarkup: string): string {
  const title = escapeHtml(plan.title || 'Plan d’automatisation');
  const updated = plan.updatedAt
    ? escapeHtml(new Date(plan.updatedAt).toLocaleString('fr-FR'))
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Klanvio</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Nunito", "Segoe UI", system-ui, sans-serif;
      background: #fafafa;
      color: #1e1e1e;
    }
    header {
      padding: 1.25rem 1.5rem 0.75rem;
      border-bottom: 1px solid rgba(0,0,0,.08);
      background: #fff;
    }
    header p.brand {
      margin: 0;
      font-size: 0.75rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: #64748b;
    }
    header h1 {
      margin: .35rem 0 0;
      font-size: 1.35rem;
      font-weight: 600;
    }
    header .meta {
      margin: .35rem 0 0;
      font-size: .8rem;
      color: #94a3b8;
    }
    main {
      padding: 1.5rem;
      display: flex;
      justify-content: center;
    }
    .board {
      width: 100%;
      max-width: 960px;
      background: #fff;
      border: 1px solid rgba(0,0,0,.08);
      border-radius: 1rem;
      padding: 1rem;
      overflow: auto;
    }
    .board svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 85vh;
    }
    footer {
      text-align: center;
      padding: 0 1.5rem 2rem;
      font-size: .75rem;
      color: #94a3b8;
    }
    footer a { color: #475569; }
  </style>
</head>
<body>
  <header>
    <p class="brand">Klanvio · plan d’automatisation</p>
    <h1>${title}</h1>
    ${updated ? `<p class="meta">Mis à jour le ${updated}</p>` : ''}
  </header>
  <main>
    <div class="board">
      ${svgMarkup}
    </div>
  </main>
  <footer>
    Généré avec <a href="https://www.klanvio.com">Klanvio</a> — ouvre ce fichier dans n’importe quel navigateur.
  </footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function planDownloadBasename(plan: AutomationVisualPlan): string {
  return (plan.title || 'plan-automatisation').replace(/[^\w\-]+/g, '_').slice(0, 80) || 'plan';
}
