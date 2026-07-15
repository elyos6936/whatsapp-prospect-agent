import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const Dithering = lazy(() =>
  import('@paper-design/shaders-react').then((mod) => ({ default: mod.Dithering })),
);

type ShaderBackdropProps = {
  className?: string;
  colorFront?: string;
  opacity?: number;
  speed?: number;
};

/** Soft dither — mounts only when near viewport to avoid early WebGL cost. */
export function ShaderBackdrop({
  className,
  colorFront = '#2057ce',
  opacity = 0.22,
  speed = 0.12,
}: ShaderBackdropProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden
    >
      {active && (
        <Suspense fallback={null}>
          <div className="absolute inset-0 mix-blend-multiply" style={{ opacity }}>
            <Dithering
              colorBack="#00000000"
              colorFront={colorFront}
              shape="warp"
              type="4x4"
              speed={speed}
              className="size-full"
              minPixelRatio={1}
            />
          </div>
        </Suspense>
      )}
    </div>
  );
}
