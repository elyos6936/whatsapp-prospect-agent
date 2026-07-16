import { ArrowDown } from 'lucide-react';
import type { AutomationPlanNode, AutomationVisualPlan } from '@/lib/automation-plan';
import { cn } from '@/lib/utils';

const KIND_STYLE: Record<string, string> = {
  source: 'border-brand/30 bg-brand-muted/50 text-brand',
  message: 'border-black/10 bg-bg-0 text-text-100',
  delay: 'border-amber-500/25 bg-amber-50 text-amber-900',
  reply: 'border-sky-500/25 bg-sky-50 text-sky-900',
  goal: 'border-emerald-500/30 bg-emerald-50 text-emerald-900',
  branch: 'border-violet-500/25 bg-violet-50 text-violet-900',
  stop: 'border-red-500/25 bg-red-50 text-red-800',
};

function kindLabel(kind: string): string {
  switch (kind) {
    case 'source':
      return 'Source';
    case 'message':
      return 'Message';
    case 'delay':
      return 'Délai';
    case 'reply':
      return 'Réponse';
    case 'goal':
      return 'Objectif';
    case 'branch':
      return 'Branche';
    case 'stop':
      return 'Arrêt';
    default:
      return kind;
  }
}

function NodeCard({ node }: { node: AutomationPlanNode }) {
  const style = KIND_STYLE[node.kind] ?? KIND_STYLE.message;
  return (
    <div className={cn('w-full rounded-xl border px-3.5 py-3 shadow-sm', style)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {kindLabel(String(node.kind))}
      </p>
      <p className="mt-1 text-sm font-medium leading-snug">{node.label}</p>
      {node.subtitle ? (
        <p className="mt-1 text-xs leading-relaxed opacity-80">{node.subtitle}</p>
      ) : null}
    </div>
  );
}

type StrategyFlowViewProps = {
  plan: AutomationVisualPlan;
  className?: string;
};

/**
 * Résumé stratégie fixe et lisible (sans Excalidraw) —
 * toujours cadré dans le panneau droit, sans menus ni zoom.
 */
export function StrategyFlowView({ plan, className }: StrategyFlowViewProps) {
  const nodes = plan.nodes ?? [];
  const edgeByFrom = new Map<string, string[]>();
  for (const e of plan.edges ?? []) {
    const list = edgeByFrom.get(e.from) ?? [];
    list.push(e.to);
    edgeByFrom.set(e.from, list);
  }

  // Ordre d’affichage : suite principale selon les edges, sinon ordre du tableau
  const ordered: AutomationPlanNode[] = [];
  const seen = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const start =
    nodes.find((n) => n.kind === 'source') ??
    nodes.find((n) => !(plan.edges ?? []).some((e) => e.to === n.id)) ??
    nodes[0];

  const walk = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id);
    ordered.push(node);
    for (const next of edgeByFrom.get(id) ?? []) walk(next);
  };
  walk(start?.id);
  for (const n of nodes) {
    if (!seen.has(n.id)) ordered.push(n);
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-bg-100',
        className,
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 custom-scrollbar">
        {ordered.length === 0 ? (
          <p className="px-2 text-sm text-text-500">Aucune étape dans cette stratégie.</p>
        ) : (
          <ol className="mx-auto flex w-full max-w-[340px] flex-col items-stretch">
            {ordered.map((node, i) => (
              <li key={node.id} className="flex flex-col items-center">
                <NodeCard node={node} />
                {i < ordered.length - 1 && (
                  <div className="flex flex-col items-center py-1.5 text-text-400" aria-hidden>
                    <ArrowDown className="h-4 w-4" strokeWidth={2} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
