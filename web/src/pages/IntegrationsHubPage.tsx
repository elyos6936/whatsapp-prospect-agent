import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import {
  INTEGRATIONS_MARKETING,
  integrationPath,
} from '@/lib/integrations-marketing';
import { TRIAL_BADGE } from '@/lib/pricing';

export function IntegrationsHubPage() {
  return (
    <MarketingPageShell
      wide
      seo={{
        title: 'Intégrations | Klanvio',
        description:
          'Connectez WhatsApp, Google Contacts, Typeform et Google Sheets à Klanvio pour prospecter et closer sans configuration technique.',
        path: '/integrations',
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Intégrations</p>
      <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-text-100 sm:text-3xl">
        Vos outils, reliés à l’agent WhatsApp
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-400 sm:text-base">
        Confiez à votre agent 1, 2 ou 3 comptes WhatsApp. Il extrait vos contacts, relance vos leads
        et se connecte à vos outils — sans configuration technique.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS_MARKETING.map((item) => {
          const Logo = item.Logo;
          return (
            <Link
              key={item.slug}
              to={integrationPath(item.slug)}
              className="group flex flex-col rounded-2xl border border-black/[0.07] bg-white p-6 shadow-sm shadow-black/[0.02] transition hover:border-brand-border hover:shadow-md"
            >
              <div className="flex size-12 items-center justify-center rounded-xl border border-black/[0.06] bg-[#f7f8fb]">
                <div className="size-7">
                  <Logo className="size-full" />
                </div>
              </div>
              <h2 className="mt-5 text-base font-semibold text-text-100">{item.name}</h2>
              <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-text-400">
                {item.lead}
              </p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-brand">
                En savoir plus
                <ChevronRight className="size-4 opacity-60 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-12 rounded-2xl border border-black/[0.07] bg-white px-5 py-8 text-center sm:px-8">
        <h2 className="text-lg font-semibold text-text-100">Essayez Klanvio avec vos outils</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-400">
          {TRIAL_BADGE} — connectez WhatsApp puis activez les intégrations depuis Réglages.
        </p>
        <Link
          to="/register"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Commencer
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </MarketingPageShell>
  );
}
