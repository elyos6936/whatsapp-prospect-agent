import { Link } from 'react-router-dom';
import {
  CalendlyLogo,
  GoogleContactsLogo,
  GoogleSheetsLogo,
  N8nLogo,
  TallyLogo,
  TypeformLogo,
  WhatsAppLogo,
  ZapierLogo,
} from '@/components/brand/IntegrationLogos';
import { OrbitingSkills } from '@/components/ui/orbiting-skills';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

type IntegrationsSectionProps = {
  className?: string;
};

const LIVE = [
  {
    label: 'WhatsApp',
    href: '/integrations/whatsapp',
    Logo: WhatsAppLogo,
  },
  {
    label: 'Google Contacts',
    href: '/integrations/google-contacts',
    Logo: GoogleContactsLogo,
  },
  {
    label: 'Typeform',
    href: '/integrations/typeform',
    Logo: TypeformLogo,
  },
  {
    label: 'Calendly',
    href: '/integrations/calendly',
    Logo: CalendlyLogo,
  },
  {
    label: 'Tally',
    href: '/integrations/tally',
    Logo: TallyLogo,
  },
  {
    label: 'Google Sheets',
    href: '/integrations/google-sheets',
    Logo: GoogleSheetsLogo,
  },
] as const;

const COMING = [
  { label: 'n8n', Logo: N8nLogo },
  { label: 'Zapier', Logo: ZapierLogo },
] as const;

/** Static logo grid — no RAF, fits under copy on small screens. */
function IntegrationsGrid() {
  return (
    <div className="mx-auto w-full max-w-md space-y-5">
      <ul className="grid grid-cols-2 gap-2.5">
        {LIVE.map(({ label, href, Logo }) => (
          <li key={label}>
            <Link
              to={href}
              className="flex items-center gap-2.5 rounded-2xl border border-black/[0.08] bg-white px-3 py-3 shadow-sm transition hover:border-brand-border"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-[#f7f8fb]">
                <Logo className="h-[58%] w-[58%]" />
              </span>
              <span className="min-w-0 text-left text-xs font-semibold leading-snug text-text-200">
                {label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-text-500">
          Bientôt
        </p>
        <ul className="grid grid-cols-4 gap-2">
          {COMING.map(({ label, Logo }) => (
            <li
              key={label}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/80 px-1.5 py-2.5"
              title={label}
            >
              <span className="flex h-9 w-9 items-center justify-center">
                <Logo className="h-[70%] w-[70%] opacity-80" />
              </span>
              <span className="truncate text-[10px] font-medium text-text-500">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Section Intégrations — grille mobile légère, orbite desktop uniquement.
 */
export function IntegrationsSection({ className }: IntegrationsSectionProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

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

        <div className="mt-8 sm:mt-10">
          {isDesktop ? <OrbitingSkills /> : <IntegrationsGrid />}
        </div>

        <div className="relative z-20 mt-8 flex justify-center sm:mt-10">
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
