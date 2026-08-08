import type { CSSProperties } from 'react';
import { LazyMotion, domAnimation, m } from 'motion/react';
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

function StepImage({ src, alt, tone = 'brand' }: { src: string; alt: string; tone?: Tone }) {
  const c = TONE[tone];
  return (
    <div
      className={cn(
        'w-full max-w-md overflow-hidden rounded-2xl border bg-white p-1.5 shadow-[0_14px_32px_-18px_rgba(15,23,42,0.4)] ring-1',
        c.border,
        c.ring,
      )}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full rounded-[14px] object-cover object-top"
      />
    </div>
  );
}

/**
 * Klanvio how-it-works — adapted from 21st.dev pin cards:
 * brand tones, product screenshots, stable flex layout (no absolute jump on mobile).
 */
export function HowItWorks({ features, className }: HowItWorksProps) {
  const height = 720;

  return (
    <LazyMotion features={domAnimation}>
      <div className={cn('relative overflow-hidden bg-white px-4 py-4 sm:px-6 sm:py-6', className)}>
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'linear-gradient(#2057ce 1px, transparent 1px)',
            backgroundSize: '100% 28px',
          }}
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-white to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-white to-transparent" />

        <div className="relative z-10 mx-auto max-w-5xl">
          {/* Desktop dashed path (decorative, non-layout) */}
          <div
            className="pointer-events-none absolute inset-0 hidden md:block"
            style={{ '--md-height': `${height}px` } as CSSProperties}
          >
            <svg
              className="absolute left-1/2 top-8 h-[calc(100%-4rem)] w-[min(100%,720px)] -translate-x-1/2 text-brand/25"
              viewBox={`0 0 720 ${height}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <m.path
                d="M 180 80 C 360 80, 400 220, 540 240 C 640 255, 360 360, 180 400 C 80 430, 360 520, 540 560"
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

          <ol className="relative flex list-none flex-col gap-10 md:gap-14">
            {features.map((step, index) => {
              const tone: Tone = step.tone ?? (['brand', 'sky', 'navy'] as const)[index % 3];
              const reverse = index % 2 === 1;
              const number = `0${index + 1}`;
              const rotate = reverse ? 'md:-rotate-3' : 'md:rotate-3';

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
                  <div className={cn('flex justify-center', reverse ? 'md:justify-start' : 'md:justify-end')}>
                    <StepImage src={step.imageSrc} alt={step.imageAlt} tone={tone} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </LazyMotion>
  );
}

export default HowItWorks;
