import type { CSSProperties } from 'react';
import { LazyMotion, domAnimation, m } from 'motion/react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

type Tone = 'brand' | 'sky' | 'navy';

export type HowStep = {
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
  tone?: Tone;
};

type HowItWorksProps = {
  features: HowStep[];
  className?: string;
};

const TONE: Record<Tone, { bg: string; text: string; border: string; ring: string }> = {
  brand: {
    bg: 'bg-brand/[0.07]',
    text: 'text-brand',
    border: 'border-brand/20',
    ring: 'ring-brand/15',
  },
  sky: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200/80',
    ring: 'ring-sky-200/60',
  },
  navy: {
    bg: 'bg-[rgba(10,17,32,0.04)]',
    text: 'text-[#1845A8]',
    border: 'border-[#1845A8]/20',
    ring: 'ring-[#1845A8]/15',
  },
};

function Pin({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M16 3a1 1 0 0 1 .117 1.993l-.117 .007v4.764l1.894 3.789a1 1 0 0 1 .1 .331l.006 .116v2a1 1 0 0 1 -.883 .993l-.117 .007h-4v4a1 1 0 0 1 -1.993 .117l-.007 -.117v-4h-4a1 1 0 0 1 -.993-.883l-.007 -.117v-2a1 1 0 0 1 .06 -.34l.046-.107l1.894 -3.791v-4.762a1 1 0 0 1 -.117 -1.993l.117 -.007h8z" />
    </svg>
  );
}

function StepCard({
  number,
  title,
  description,
  tone = 'brand',
  rotate,
}: {
  number: string;
  title: string;
  description: string;
  tone?: Tone;
  rotate?: string;
}) {
  const c = TONE[tone];
  return (
    <div
      className={cn(
        'relative w-full max-w-[300px] transition-transform duration-300 hover:z-20 hover:scale-[1.03]',
        rotate,
      )}
    >
      <div className="rounded-[22px] border border-black/[0.06] bg-white p-2 shadow-[0_12px_28px_-16px_rgba(15,23,42,0.35)]">
        <Pin className={cn('mx-auto mb-4 h-7 w-7', c.text)} />
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden rounded-[16px] border p-4',
            c.bg,
            c.border,
          )}
        >
          <span className={cn('mb-3 font-sans text-3xl font-semibold tracking-tight', c.text)}>
            {number}
          </span>
          <h3 className="mb-2 text-lg font-semibold leading-snug tracking-tight text-text-100">
            {title}
          </h3>
          <p className="text-sm leading-relaxed text-text-400">{description}</p>
        </div>
      </div>
    </div>
  );
}

function StepImage({
  src,
  alt,
  tone = 'brand',
  compact = false,
}: {
  src: string;
  alt: string;
  tone?: Tone;
  /** Smaller frame — used for step 1 QR so it doesn’t dominate. */
  compact?: boolean;
}) {
  const c = TONE[tone];
  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-2xl border bg-white p-2 shadow-[0_14px_36px_-18px_rgba(32,87,206,0.35)] ring-1',
        compact ? 'max-w-[260px] sm:max-w-[280px]' : 'max-w-md',
        c.border,
        c.ring,
      )}
    >
      <div className="overflow-hidden rounded-[14px] bg-[#f7f8fb] ring-1 ring-black/[0.04]">
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full object-cover object-top"
        />
      </div>
    </div>
  );
}

/**
 * Klanvio how-it-works — adapted from 21st.dev pin cards:
 * brand tones, product screenshots, stable flex layout (no absolute jump on mobile).
 */
export function HowItWorks({ features, className }: HowItWorksProps) {
  const height = 720;
  const showPathAnim = useMediaQuery(
    '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
  );

  const body = (
    <div className={cn('relative overflow-hidden bg-[#f7f8fb] px-4 py-4 sm:px-6 sm:py-6', className)}>
      <div className="relative z-10 mx-auto max-w-5xl">
        {showPathAnim && (
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{ '--md-height': `${height}px` } as CSSProperties}
          >
            <svg
              className="absolute left-1/2 top-8 h-[calc(100%-4rem)] w-[min(100%,720px)] -translate-x-1/2 text-brand/35"
              viewBox={`0 0 720 ${height}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              {/* Step 1: arc reaches the compact QR frame (right). Later curves keep step 2–3. */}
              <m.path
                d="M 195 130 C 310 118, 470 145, 618 200 C 680 230, 380 340, 185 400 C 80 435, 400 545, 655 575"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="8 6"
                fill="none"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: -140 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
            </svg>
          </div>
        )}

        <ol className="relative z-[1] flex list-none flex-col gap-10 md:gap-14">
          {features.map((step, index) => {
            const tone: Tone = step.tone ?? (['brand', 'sky', 'navy'] as const)[index % 3];
            const reverse = index % 2 === 1;
            const number = `0${index + 1}`;
            const rotate = reverse ? 'md:-rotate-3' : 'md:rotate-3';

            const compactImage = index === 0;

            return (
              <li
                key={step.title}
                className={cn(
                  'grid items-center gap-6 md:grid-cols-2 md:gap-10',
                  reverse && 'md:[&>*:first-child]:order-2',
                )}
              >
                <div className={cn('flex justify-center', reverse ? 'md:justify-end' : 'md:justify-start')}>
                  <StepCard
                    number={number}
                    title={step.title}
                    description={step.description}
                    tone={tone}
                    rotate={rotate}
                  />
                </div>
                <div
                  className={cn(
                    'relative z-[1] flex justify-center',
                    reverse ? 'md:justify-start' : 'md:justify-end',
                  )}
                >
                  <StepImage
                    src={step.imageSrc}
                    alt={step.imageAlt}
                    tone={tone}
                    compact={compactImage}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );

  if (!showPathAnim) return body;

  return <LazyMotion features={domAnimation}>{body}</LazyMotion>;
}

export default HowItWorks;
