import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import {
  GoogleContactsLogo,
  GoogleSheetsLogo,
  TypeformLogo,
  WhatsAppLogo,
} from '@/components/brand/IntegrationLogos';

type IntegrationsSectionProps = {
  className?: string;
};

/**
 * Section Intégrations landing — motif orbital (UI component) + CTA hub uniquement.
 */
export function IntegrationsSection({ className }: IntegrationsSectionProps) {
  return (
    <section id="integrations" className={cn('landing-section bg-[#f7f8fb]', className)}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-lg space-y-3 text-center">
          <h2 className="landing-h2 text-balance text-text-100">Intégrations</h2>
          <p className="landing-lead text-text-400">
            Confiez à votre agent 1, 2 ou 3 comptes WhatsApp. Il extrait vos contacts, relance vos
            leads et se connecte à vos outils — sans configuration technique.
          </p>
        </div>

        <div className="group relative mx-auto mt-10 flex aspect-[16/10] max-w-[22rem] items-center justify-between sm:max-w-sm">
          <div
            role="presentation"
            className="pointer-events-none absolute inset-0 z-10 aspect-square rounded-full border-t border-black/5 bg-gradient-to-b from-brand/15 to-transparent to-25% opacity-0 duration-[3.5s] animate-spin group-hover:opacity-100"
          />
          <div
            role="presentation"
            className="pointer-events-none absolute inset-16 z-10 aspect-square scale-90 rounded-full border-t border-black/5 bg-gradient-to-b from-emerald-500/15 to-transparent to-25% opacity-0 duration-[3.5s] animate-spin group-hover:opacity-100"
          />

          <div className="absolute inset-0 flex aspect-square items-center justify-center rounded-full border-t border-black/[0.08] bg-gradient-to-b from-black/[0.04] to-transparent to-25%">
            <OrbitCard
              className="absolute top-1/4 left-0 -translate-x-1/6 -translate-y-1/4"
              href="/integrations/whatsapp"
              label="WhatsApp"
            >
              <WhatsAppLogo />
            </OrbitCard>
            <OrbitCard
              className="absolute top-0 -translate-y-1/2"
              href="/integrations/google-contacts"
              label="Google Contacts"
            >
              <GoogleContactsLogo />
            </OrbitCard>
            <OrbitCard
              className="absolute top-1/4 right-0 translate-x-1/6 -translate-y-1/4"
              href="/integrations/typeform"
              label="Typeform"
            >
              <TypeformLogo />
            </OrbitCard>
          </div>

          <div className="absolute inset-16 flex aspect-square scale-90 items-center justify-center rounded-full border-t border-black/[0.08] bg-gradient-to-b from-black/[0.04] to-transparent to-25%">
            <OrbitCard
              className="absolute top-0 -translate-y-1/2"
              href="/integrations/google-sheets"
              label="Google Sheets"
            >
              <GoogleSheetsLogo />
            </OrbitCard>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 mx-auto my-2 flex w-fit justify-center">
            <div className="rounded-full border border-black/10 bg-white p-1">
              <OrbitCard className="size-16 border-black/15 shadow-xl shadow-black/10" isCenter>
                <KlanvioLogo size="lg" className="!h-8 !w-8" />
              </OrbitCard>
            </div>
          </div>
        </div>

        <div className="relative z-20 mt-10 flex justify-center">
          <Link
            to="/integrations"
            className="inline-flex items-center justify-center rounded-xl border border-black/10 bg-white px-5 py-2.5 text-sm font-semibold text-text-200 transition hover:border-brand-border hover:text-brand"
          >
            Voir toutes les intégrations
          </Link>
        </div>
      </div>
    </section>
  );
}

function OrbitCard({
  children,
  className,
  isCenter = false,
  href,
  label,
}: {
  children: ReactNode;
  className?: string;
  isCenter?: boolean;
  href?: string;
  label?: string;
}) {
  const bubble = (
    <div
      className={cn(
        'relative z-30 flex size-12 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-sm shadow-black/5',
        href && 'transition hover:border-brand-border hover:shadow-md',
        isCenter && 'size-16',
        !href && className,
      )}
    >
      <div className={cn('size-5 *:size-full', isCenter && 'size-8')}>{children}</div>
    </div>
  );

  if (!href) return bubble;

  return (
    <Link
      to={href}
      aria-label={label}
      className={cn('z-30 block', className)}
    >
      <div className="flex size-12 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-sm shadow-black/5 transition hover:border-brand-border hover:shadow-md">
        <div className="size-5 *:size-full">{children}</div>
      </div>
    </Link>
  );
}
