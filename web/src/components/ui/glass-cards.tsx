import { cn } from '@/lib/utils';

export type GlassStep = {
  id: string | number;
  step: string;
  title: string;
  description: string;
  color?: string;
};

type HowGlassStepsProps = {
  steps: GlassStep[];
  className?: string;
};

/**
 * Lightweight glass step cards — CSS only, no overflow clipping.
 */
export function HowGlassSteps({ steps, className }: HowGlassStepsProps) {
  return (
    <div className={cn('grid gap-3 md:grid-cols-3 md:gap-4', className)}>
      {steps.map((step, index) => (
        <GlassStepCard key={step.id} step={step} index={index} />
      ))}
    </div>
  );
}

function GlassStepCard({ step, index }: { step: GlassStep; index: number }) {
  const color = step.color ?? 'rgba(32, 87, 206, 0.75)';

  return (
    <article
      className="relative flex h-full flex-col rounded-2xl p-px shadow-sm"
      style={{
        zIndex: index + 1,
        background: `linear-gradient(135deg, ${color}, rgba(255,255,255,0.35) 42%, rgba(32,87,206,0.22))`,
      }}
    >
      <div className="flex h-full flex-col rounded-[15px] border border-black/[0.04] bg-white/95 p-5 sm:p-6">
        <span className="text-xs font-semibold tracking-[0.14em] text-brand">{step.step}</span>
        <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-text-100">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-text-400">{step.description}</p>
      </div>
    </article>
  );
}
