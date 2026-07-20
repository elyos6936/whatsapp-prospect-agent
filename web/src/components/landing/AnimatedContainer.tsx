import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ViewAnimationProps = {
  delay?: number;
  className?: string;
  children: ReactNode;
  /** Visible dès le 1er paint (hero) — évite opacity:0 pour les crawlers. */
  eager?: boolean;
};

/** CSS-only reveal — keeps landing free of framer-motion (~118KB). */
export function AnimatedContainer({
  className,
  delay = 0.1,
  children,
  eager = false,
}: ViewAnimationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) return;
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  return (
    <div
      ref={ref}
      className={cn(
        'landing-reveal',
        visible && 'landing-reveal--in',
        className,
      )}
      style={{ transitionDelay: visible ? `${delay}s` : undefined }}
    >
      {children}
    </div>
  );
}
