import { BRAND_LOGO_ICON_URL } from '@/lib/brand';
import { cn } from '@/lib/utils';

export type LogoVariant = 'icon' | 'full';

type KlanvioLogoProps = {
  className?: string;
  variant?: LogoVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  centered?: boolean;
};

const ICON = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-7 w-7',
  xl: 'h-8 w-8',
} as const;

const WORDMARK = {
  sm: 'text-sm font-bold tracking-tight',
  md: 'text-base font-bold tracking-tight',
  lg: 'text-lg font-bold tracking-tight',
  xl: 'text-xl font-bold tracking-tight',
} as const;

const GAP = {
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-2',
  xl: 'gap-2.5',
} as const;

export function KlanvioLogo({
  className,
  variant = 'icon',
  size = 'md',
  centered = false,
}: KlanvioLogoProps) {
  if (variant === 'icon') {
    return (
      <img
        src={BRAND_LOGO_ICON_URL}
        alt="Klanvio"
        className={cn('block shrink-0 object-contain', ICON[size], className)}
        draggable={false}
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center',
        centered && 'mx-auto justify-center',
        GAP[size],
        className,
      )}
      role="img"
      aria-label="Klanvio"
    >
      <span className={cn('flex shrink-0 items-center justify-center', ICON[size])}>
        <img
          src={BRAND_LOGO_ICON_URL}
          alt=""
          className={cn(
            'block h-full w-full object-contain',
            centered ? 'object-center' : 'object-left',
          )}
          draggable={false}
        />
      </span>
      <span className={cn('shrink-0 leading-none text-brand', WORDMARK[size], 'translate-y-px')}>
        Klanvio
      </span>
    </span>
  );
}
