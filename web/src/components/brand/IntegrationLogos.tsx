import type { ReactNode, SVGProps } from 'react';
import { cn } from '@/lib/utils';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** Logos marques — SVG inline reconnaissables (pricing strip). */

export function WhatsAppLogo({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-full', className)} {...props}>
      <path
        fill="#25D366"
        d="M12.04 2C6.58 2 2.15 6.4 2.15 11.84c0 1.99.58 3.84 1.59 5.43L2 22l4.89-1.61a9.9 9.9 0 0 0 5.15 1.42h.01c5.46 0 9.89-4.4 9.89-9.84S17.5 2 12.04 2z"
      />
      <path
        fill="#fff"
        d="M17.1 14.45c-.22-.11-1.3-.64-1.5-.71-.2-.08-.35-.11-.5.11-.15.22-.57.71-.7.86-.13.15-.26.16-.48.05-.22-.11-.92-.34-1.75-1.08-.65-.58-1.09-1.29-1.22-1.51-.13-.22-.01-.34.1-.45.1-.1.22-.26.33-.39.11-.13.15-.22.22-.37.07-.15.04-.28-.02-.39-.06-.11-.5-1.2-.68-1.64-.18-.43-.36-.37-.5-.38h-.42c-.15 0-.39.06-.59.28-.2.22-.77.75-.77 1.83s.79 2.12.9 2.27c.11.15 1.55 2.37 3.76 3.32 2.21.96 2.21.64 2.61.6.4-.04 1.3-.53 1.48-1.04.18-.51.18-.95.13-1.04-.05-.09-.2-.15-.42-.26z"
      />
    </svg>
  );
}

export function GoogleContactsLogo({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-full', className)} {...props}>
      <path
        fill="#4285F4"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 20c-2.7 0-5.1-1.12-6.8-2.9.03-2.25 4.53-3.48 6.8-3.48s6.77 1.23 6.8 3.48C17.1 18.88 14.7 20 12 20z"
      />
      <circle cx="12" cy="9" r="2.6" fill="#fff" />
      <path
        fill="#fff"
        d="M12 14.2c-1.85 0-4.55.78-4.9 1.95.95.95 2.3 1.55 4.9 1.55s3.95-.6 4.9-1.55c-.35-1.17-3.05-1.95-4.9-1.95z"
      />
    </svg>
  );
}

export function TypeformLogo({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-full', className)} {...props}>
      <rect width="24" height="24" rx="5" fill="#262627" />
      <path
        fill="#fff"
        d="M6.5 7.2h11v2.1H13.4v7.5h-2.6V9.3H6.5V7.2z"
      />
    </svg>
  );
}

export function GoogleSheetsLogo({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-full', className)} {...props}>
      <path
        fill="#0F9D58"
        d="M14.5 2H6.8C5.8 2 5 2.8 5 3.8v16.4c0 1 .8 1.8 1.8 1.8h10.4c1 0 1.8-.8 1.8-1.8V7.5L14.5 2z"
      />
      <path fill="#87CEAC" d="M14.5 2v5.5H21L14.5 2z" />
      <path fill="#fff" d="M8 11h8v1.2H8V11zm0 2.4h8v1.2H8v-1.2zm0 2.4h5.5V17H8v-1.2z" />
    </svg>
  );
}

export const PRICING_INTEGRATIONS = [
  { id: 'whatsapp', name: 'WhatsApp', Logo: WhatsAppLogo },
  { id: 'google_contacts', name: 'Google Contacts', Logo: GoogleContactsLogo },
  { id: 'typeform', name: 'Typeform', Logo: TypeformLogo },
  { id: 'google_sheets', name: 'Google Sheets', Logo: GoogleSheetsLogo },
] as const;

/** Chip circulaire (motif IntegrationCard du bloc shadcn, adapté Vite). */
export function IntegrationLogoChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-sm shadow-black/5',
        className,
      )}
    >
      <div className="flex size-[55%] items-center justify-center *:size-full">{children}</div>
    </div>
  );
}
