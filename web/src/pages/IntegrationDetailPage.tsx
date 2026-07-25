import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import {
  getIntegrationBySlug,
  INTEGRATIONS_MARKETING,
  integrationPath,
  type IntegrationSlug,
} from '@/lib/integrations-marketing';
import { TRIAL_BADGE } from '@/lib/pricing';

export function IntegrationDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const integration = getIntegrationBySlug(slug);

  if (!integration) {
    return <Navigate to="/integrations" replace />;
  }

  const Logo = integration.Logo;
  const others = INTEGRATIONS_MARKETING.filter((i) => i.slug !== integration.slug);

  return (
    <MarketingPageShell
      wide
      backTo="/integrations"
      backLabel="Toutes les intégrations"
      seo={{
        title: integration.seoTitle,
        description: integration.seoDescription,
        path: integrationPath(integration.slug as IntegrationSlug),
      }}
    >
      <nav className="mb-6 text-xs text-text-500" aria-label="Fil d’Ariane">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-text-200">
              Accueil
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link to="/integrations" className="hover:text-text-200">
              Intégrations
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="font-medium text-text-300">{integration.name}</li>
        </ol>
      </nav>

      <header className="flex flex-col gap-6 border-b border-black/[0.06] pb-10 sm:flex-row sm:items-start sm:gap-8">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-black/[0.08] bg-white shadow-sm sm:size-20">
          <div className="size-10 sm:size-12">
            <Logo className="size-full" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
            Intégration
          </p>
          <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-text-100 sm:text-3xl">
            {integration.headline}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-400 sm:text-base">
            {integration.lead}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              {TRIAL_BADGE}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-text-200 transition hover:border-brand-border hover:text-brand"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </header>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-text-100">Pourquoi connecter {integration.name}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {integration.benefits.map((b) => (
            <div
              key={b.title}
              className="rounded-2xl border border-black/[0.07] bg-white p-5 shadow-sm shadow-black/[0.02]"
            >
              <h3 className="text-sm font-semibold text-text-100">{b.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-text-400 sm:text-sm">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-text-100">Comment ça marche</h2>
        <ol className="mt-5 space-y-4">
          {integration.steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/[0.1] font-mono text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-sm font-semibold text-text-100">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-text-400">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-text-100">Cas d’usage</h2>
        <ul className="mt-4 space-y-2.5">
          {integration.useCases.map((u) => (
            <li key={u} className="flex items-start gap-2.5 text-sm text-text-300">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2.5} />
              <span>{u}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-2xl border border-black/[0.07] bg-white px-5 py-8 text-center sm:px-8">
        <h2 className="text-lg font-semibold text-text-100">
          Prêt à brancher {integration.name} sur Klanvio ?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-400">
          Créez un compte, connectez WhatsApp, puis activez l’intégration depuis Réglages.
        </p>
        <Link
          to="/register"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Commencer gratuitement
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-text-100">Autres intégrations</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {others.map((o) => {
            const OtherLogo = o.Logo;
            return (
              <Link
                key={o.slug}
                to={integrationPath(o.slug)}
                className="flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white px-4 py-3 transition hover:border-brand-border hover:bg-brand/[0.03]"
              >
                <span className="flex size-10 items-center justify-center rounded-full border border-black/[0.06] bg-[#f7f8fb]">
                  <span className="size-5">
                    <OtherLogo className="size-full" />
                  </span>
                </span>
                <span className="text-sm font-medium text-text-200">{o.name}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </MarketingPageShell>
  );
}
