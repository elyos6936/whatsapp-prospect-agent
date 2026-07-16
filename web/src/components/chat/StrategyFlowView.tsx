import { ArrowDown } from 'lucide-react';
import type { AutomationPlanNode, AutomationVisualPlan } from '@/lib/automation-plan';
import { cn } from '@/lib/utils';

const KIND_META: Record<
  string,
  { label: string; hint: string; ring: string; badge: string }
> = {
  source: {
    label: 'Point de départ',
    hint: 'D’où viennent les prospects',
    ring: 'border-brand/40 bg-white',
    badge: 'bg-brand text-white',
  },
  message: {
    label: 'Message',
    hint: 'Ce que l’agent envoie',
    ring: 'border-slate-200 bg-white',
    badge: 'bg-slate-800 text-white',
  },
  delay: {
    label: 'Attente',
    hint: 'Pause avant l’étape suivante',
    ring: 'border-amber-200 bg-amber-50/80',
    badge: 'bg-amber-600 text-white',
  },
  reply: {
    label: 'Réponse prospect',
    hint: 'Quand le contact répond',
    ring: 'border-sky-200 bg-sky-50/80',
    badge: 'bg-sky-600 text-white',
  },
  goal: {
    label: 'Objectif',
    hint: 'Résultat visé (RDV, vente…)',
    ring: 'border-emerald-200 bg-emerald-50/80',
    badge: 'bg-emerald-700 text-white',
  },
  branch: {
    label: 'Branche',
    hint: 'Chemin alternatif',
    ring: 'border-violet-200 bg-violet-50/80',
    badge: 'bg-violet-700 text-white',
  },
  stop: {
    label: 'Arrêt',
    hint: 'Fin de la conversation',
    ring: 'border-red-200 bg-red-50/80',
    badge: 'bg-red-700 text-white',
  },
};

function metaFor(kind: string) {
  return (
    KIND_META[kind] ?? {
      label: 'Étape',
      hint: 'Étape de la campagne',
      ring: 'border-slate-200 bg-white',
      badge: 'bg-slate-700 text-white',
    }
  );
}

function edgeLabelBetween(
  fromId: string,
  toId: string,
  edges: AutomationVisualPlan['edges'],
): string | undefined {
  return edges?.find((e) => e.from === fromId && e.to === toId)?.label?.trim() || undefined;
}

function NodeBlock({
  node,
  step,
}: {
  node: AutomationPlanNode;
  step: number;
}) {
  const meta = metaFor(String(node.kind));
  return (
    <div
      className={cn(
        'relative w-full rounded-2xl border-2 px-4 py-3.5 shadow-sm',
        meta.ring,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold',
            meta.badge,
          )}
        >
          {step}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-200">{meta.label}</p>
          <p className="text-[11px] text-text-500">{meta.hint}</p>
        </div>
      </div>
      <p className="text-sm font-semibold leading-snug text-text-100">{node.label}</p>
      {node.subtitle ? (
        <p className="mt-1.5 text-xs leading-relaxed text-text-400">{node.subtitle}</p>
      ) : null}
    </div>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center py-1" aria-hidden>
      <div className="h-3 w-0.5 bg-brand/35" />
      {label ? (
        <span className="my-1 max-w-[90%] rounded-full border border-brand/20 bg-brand-muted px-2.5 py-0.5 text-center text-[10px] font-medium text-brand">
          {label}
        </span>
      ) : null}
      <div className="flex flex-col items-center">
        <div className="h-3 w-0.5 bg-brand/35" />
        <ArrowDown className="h-5 w-5 text-brand" strokeWidth={2.5} />
      </div>
    </div>
  );
}

type StrategyFlowViewProps = {
  plan: AutomationVisualPlan;
  className?: string;
};

/**
 * Résumé stratégie en blocs numérotés + flèches — lisible pour non-experts.
 */
export function StrategyFlowView({ plan, className }: StrategyFlowViewProps) {
  const nodes = plan.nodes ?? [];
  const edges = plan.edges ?? [];
  const edgeByFrom = new Map<string, string[]>();
  for (const e of edges) {
    const list = edgeByFrom.get(e.from) ?? [];
    list.push(e.to);
    edgeByFrom.set(e.from, list);
  }

  const ordered: AutomationPlanNode[] = [];
  const seen = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const start =
    nodes.find((n) => n.kind === 'source') ??
    nodes.find((n) => !edges.some((e) => e.to === n.id)) ??
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
        'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-gradient-to-b from-bg-100 to-bg-0',
        className,
      )}
    >
      <div className="shrink-0 border-b border-black/[0.06] px-4 py-3">
        <p className="text-xs font-semibold text-text-200">Parcours de la campagne</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-500">
          Chaque bloc = une étape. Suis les flèches de haut en bas.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 custom-scrollbar">
        {ordered.length === 0 ? (
          <p className="px-2 text-sm text-text-500">Aucune étape dans cette stratégie.</p>
        ) : (
          <ol className="mx-auto flex w-full max-w-[340px] list-none flex-col items-stretch p-0">
            {ordered.map((node, i) => {
              const next = ordered[i + 1];
              const label = next
                ? edgeLabelBetween(node.id, next.id, edges)
                : undefined;
              return (
                <li key={node.id} className="flex flex-col items-center">
                  <NodeBlock node={node} step={i + 1} />
                  {next ? <FlowArrow label={label} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
