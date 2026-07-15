import { cn } from '@/lib/utils';

type HeroGridBackdropProps = {
  className?: string;
};

/** Soft animated grid + radial brand wash for the hero. */
export function HeroGridBackdrop({ className }: HeroGridBackdropProps) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.55]"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(32,87,206,0.14), transparent 60%)',
        }}
      />
      <div className="hero-grid absolute inset-0" />
      <div
        className="absolute inset-0"
        style={{
          maskImage: 'radial-gradient(ellipse 65% 55% at 50% 35%, #000 35%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 65% 55% at 50% 35%, #000 35%, transparent 85%)',
        }}
      >
        <div className="hero-grid-pulse absolute inset-0 opacity-40" />
      </div>
    </div>
  );
}
