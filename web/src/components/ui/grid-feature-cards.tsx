import React from 'react';
import { cn } from '@/lib/utils';

export type FeatureType = {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  description: string;
  items?: readonly string[];
};

type FeatureCardProps = React.ComponentProps<'div'> & {
  feature: FeatureType;
};

function patternFromSeed(seed: string, length = 5): number[][] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length }, (_, i) => {
    const n = (h + i * 97) >>> 0;
    return [(n % 4) + 7, ((n >> 3) % 6) + 1];
  });
}

export function FeatureCard({ feature, className, ...props }: FeatureCardProps) {
  const p = React.useMemo(() => patternFromSeed(feature.title), [feature.title]);

  return (
    <div className={cn('relative min-w-0 overflow-hidden p-5 sm:p-6', className)} {...props}>
      <div className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(white,transparent)]">
        <div className="absolute inset-0 bg-gradient-to-r from-text-100/5 to-text-100/[0.02] opacity-100 [mask-image:radial-gradient(farthest-side_at_top,white,transparent)]">
          <GridPattern
            width={20}
            height={20}
            x="-12"
            y="4"
            squares={p}
            className="absolute inset-0 h-full w-full fill-text-100/5 stroke-text-100/20 mix-blend-overlay"
          />
        </div>
      </div>
      <feature.icon className="size-5 text-brand" strokeWidth={1.5} aria-hidden />
      <h3 className="mt-6 text-base font-semibold tracking-tight text-text-100 md:text-lg">
        {feature.title}
      </h3>
      <p className="relative z-20 mt-1.5 text-sm leading-relaxed text-text-400">{feature.description}</p>
      {feature.items && feature.items.length > 0 && (
        <ul className="relative z-20 mt-3.5 space-y-1.5">
          {feature.items.map((item) => (
            <li key={item} className="flex gap-2 text-[13px] text-text-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GridPattern({
  width,
  height,
  x,
  y,
  squares,
  ...props
}: React.ComponentProps<'svg'> & {
  width: number;
  height: number;
  x: string;
  y: string;
  squares?: number[][];
}) {
  const patternId = React.useId();

  return (
    <svg aria-hidden="true" {...props}>
      <defs>
        <pattern
          id={patternId}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path d={`M.5 ${height}V.5H${width}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${patternId})`} />
      {squares && (
        <svg x={x} y={y} className="overflow-visible">
          {squares.map(([sx, sy], index) => (
            <rect
              strokeWidth="0"
              key={`${sx}-${sy}-${index}`}
              width={width + 1}
              height={height + 1}
              x={sx * width}
              y={sy * height}
            />
          ))}
        </svg>
      )}
    </svg>
  );
}
