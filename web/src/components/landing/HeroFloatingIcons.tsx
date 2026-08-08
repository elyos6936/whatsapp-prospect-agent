import {
  GoogleContactsLogo,
  GoogleSheetsLogo,
  TypeformLogo,
  WhatsAppLogo,
} from '@/components/brand/IntegrationLogos';
import { cn } from '@/lib/utils';
import './hero-floating-icons.css';

type Floater = {
  id: string;
  Logo: typeof WhatsAppLogo;
  className: string;
  delay: string;
  size: string;
};

/** Sparse brand logos only — 4 chips, like product-integration heroes. */
const FLOATERS: Floater[] = [
  {
    id: 'whatsapp',
    Logo: WhatsAppLogo,
    className: 'left-[7%] top-[28%]',
    delay: '0s',
    size: 'h-14 w-14',
  },
  {
    id: 'contacts',
    Logo: GoogleContactsLogo,
    className: 'left-[11%] top-[62%]',
    delay: '1.1s',
    size: 'h-11 w-11',
  },
  {
    id: 'typeform',
    Logo: TypeformLogo,
    className: 'right-[8%] top-[24%]',
    delay: '0.55s',
    size: 'h-11 w-11',
  },
  {
    id: 'sheets',
    Logo: GoogleSheetsLogo,
    className: 'right-[10%] top-[58%]',
    delay: '1.6s',
    size: 'h-12 w-12',
  },
];

/** Side floaters — lg+ only, brand logos (no generic Lucide). */
export function HeroFloatingIcons({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-[1] hidden overflow-hidden lg:block',
        className,
      )}
      aria-hidden
    >
      {FLOATERS.map(({ id, Logo, className: pos, delay, size }) => (
        <div
          key={id}
          className={cn(
            'hero-floater absolute flex items-center justify-center rounded-2xl border border-black/[0.07] bg-white shadow-[0_10px_28px_-14px_rgba(15,23,42,0.35),0_1px_2px_rgba(15,23,42,0.06)]',
            size,
            pos,
          )}
          style={{ animationDelay: delay }}
        >
          <Logo className="h-[58%] w-[58%]" />
        </div>
      ))}
    </div>
  );
}
