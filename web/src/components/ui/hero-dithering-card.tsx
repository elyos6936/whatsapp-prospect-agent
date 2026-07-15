import { ArrowRight } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';

const Dithering = lazy(() =>
  import('@paper-design/shaders-react').then((mod) => ({ default: mod.Dithering })),
);

type CTASectionProps = {
  badge?: string;
  title: ReactNode;
  description: string;
  buttonLabel: string;
  onButtonClick?: () => void;
  accentColor?: string;
};

/** Compact dither CTA — WebGL only when scrolled into view. */
export function CTASection({
  badge = 'Essai gratuit 7 jours',
  title,
  description,
  buttonLabel,
  onButtonClick,
  accentColor = '#2057ce',
}: CTASectionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [shaderOn, setShaderOn] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShaderOn(true);
          io.disconnect();
        }
      },
      { rootMargin: '100px 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="flex w-full items-center justify-center px-4 py-6 sm:py-8 md:px-6">
      <div
        ref={rootRef}
        className="relative w-full max-w-4xl min-w-0"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-card px-5 py-9 shadow-sm duration-500 sm:rounded-3xl sm:px-10 sm:py-12">
          {shaderOn && (
            <Suspense fallback={<div className="absolute inset-0 bg-muted/20" />}>
              <div className="pointer-events-none absolute inset-0 z-0 opacity-35 mix-blend-multiply">
                <Dithering
                  colorBack="#00000000"
                  colorFront={accentColor}
                  shape="warp"
                  type="4x4"
                  speed={isHovered ? 0.55 : 0.18}
                  className="size-full"
                  minPixelRatio={1}
                />
              </div>
            </Suspense>
          )}

          <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center text-center">
            {badge && (
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/15 bg-white/75 px-3 py-1 text-xs font-medium text-brand backdrop-blur-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
                </span>
                {badge}
              </div>
            )}

            <h2 className="mb-3 text-balance font-sans text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              {title}
            </h2>

            <p className="mb-6 max-w-md text-balance text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>

            <button
              type="button"
              onClick={onButtonClick}
              className="group relative inline-flex h-10 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full bg-brand px-6 text-sm font-semibold text-white transition-all duration-300 hover:bg-brand-dark hover:ring-4 hover:ring-brand/15 active:scale-[0.98]"
            >
              <span className="relative z-10">{buttonLabel}</span>
              <ArrowRight className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
