import { ShaderBackground } from '@/components/ui/light-blue-plasma-shader-w-grain-interactive';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

type HeroBackdropProps = {
  className?: string;
};

/**
 * Desktop: WebGL plasma. Mobile / reduced-motion: static CSS blobs (no GPU loop).
 */
export function HeroBackdrop({ className }: HeroBackdropProps) {
  const canUseShader = useMediaQuery(
    '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
  );

  return (
    <div className={cn('pointer-events-none absolute inset-0', className)} aria-hidden>
      {canUseShader ? (
        <ShaderBackground className="absolute inset-0 h-full w-full" />
      ) : (
        <div className="absolute inset-0 overflow-hidden bg-white">
          <div className="absolute -left-[20%] -top-[10%] h-[55%] w-[75%] rounded-full bg-[#2057CE]/[0.14] blur-3xl" />
          <div className="absolute -right-[18%] bottom-[-8%] h-[50%] w-[70%] rounded-full bg-[#25D366]/[0.11] blur-3xl" />
          <div className="absolute left-[28%] top-[38%] h-36 w-36 rounded-full bg-sky-300/25 blur-2xl sm:h-48 sm:w-48" />
        </div>
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.9)_0%,rgba(255,255,255,0.55)_36%,rgba(255,255,255,0.12)_62%,transparent_78%)]" />
    </div>
  );
}
