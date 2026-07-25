import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Contact,
  Menu,
  MessageSquareText,
  Minus,
  Radio,
  Shield,
  Target,
  Users,
  X,
} from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { FacebookIcon, LinkedinIcon, YoutubeIcon } from '@/components/brand/SocialIcons';
import { AnimatedContainer } from '@/components/landing/AnimatedContainer';
import { BillingSection } from '@/components/landing/BillingSection';
import { IntegrationsSection } from '@/components/landing/IntegrationsSection';
import { LandingFaq } from '@/components/landing/LandingFaq';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { FeatureCard } from '@/components/ui/grid-feature-cards';
import { HowGlassSteps } from '@/components/ui/glass-cards';
import { CTASection } from '@/components/ui/hero-dithering-card';
import { HeroGridBackdrop } from '@/components/ui/hero-grid-backdrop';
import { ShaderBackdrop } from '@/components/ui/shader-backdrop';
import { ShinyButton } from '@/components/ui/shiny-button';
import type { LegalKind } from '@/pages/LegalPage';
import { useNavigate } from 'react-router-dom';
import { COMPARE_PRICE_LABEL, TRIAL_BADGE, TRIAL_DAYS } from '@/lib/pricing';
import { cn } from '@/lib/utils';

type LandingPageProps = {
  // kept optional for legacy unused landing components
  onLogin?: () => void;
  onRegister?: () => void;
  onOpenLegal?: (kind: LegalKind) => void;
};

const NAV_LINKS = [
  ['features', 'Fonctionnalités'],
  ['how', 'Comment ça marche'],
  ['integrations', 'Intégrations'],
  ['pricing', 'Tarif'],
  ['faq', 'FAQ'],
] as const;

const SOCIAL_LINKS = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/profile.php?id=61591310081649',
    icon: FacebookIcon,
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/klanvio/',
    icon: LinkedinIcon,
  },
  {
    label: 'YouTube',
    href: 'https://youtube.com/@klanvio',
    icon: YoutubeIcon,
  },
] as const;

const CAPABILITIES = [
  'Sans API Meta',
  'QR en 30 secondes',
  'Prospection + closing',
  'Anti-blocage intégré',
] as const;

const FEATURES = [
  {
    title: 'Groupes',
    lead: 'Créez, gérez et animez vos groupes sans jamais y toucher.',
    icon: Users,
    items: [
      'Créer et supprimer des groupes',
      'Gérer membres et droits',
      'Modifier profil et invitations',
    ],
  },
  {
    title: 'Messages & médias',
    lead: 'Tous les formats, programmables, interactifs.',
    icon: MessageSquareText,
    items: [
      'Texte, images, vidéos, vocaux',
      "Programmation d'envoi",
      'Sondages et listes',
    ],
  },
  {
    title: 'Statuts',
    lead: 'Restez visible en permanence, sans y penser.',
    icon: Radio,
    items: [
      'Publication automatique',
      'Programmation multi-jours',
      'Rotation intelligente',
    ],
  },
  {
    title: 'Prospection & closing',
    lead: 'Un commercial WhatsApp autonome qui vend pour vous.',
    icon: Target,
    items: [
      'Extraction de contacts de groupes',
      'Campagnes multi-listes',
      'Closing e-commerce',
    ],
  },
  {
    title: 'Contacts',
    lead: 'Ciblez juste, filtrez large, protégez vos données.',
    icon: Contact,
    items: [
      'Vérification WhatsApp en masse',
      'Profils et confidentialité',
      'Blocage automatisé',
    ],
  },
  {
    title: 'Anti-blocage & outils',
    lead: 'La protection intégrée qui garde votre compte en vie.',
    icon: Shield,
    items: [
      "Rythme d'envoi adaptatif",
      'Présence active',
      'Seuil de risque maîtrisé',
    ],
  },
] as const;

const COMPARE_ROWS = [
  ['Réponses automatiques', true, true],
  ['Extraction illimitée de contacts de groupes', false, true],
  ['Gestion complète de groupes', false, true],
  ['Publication de statuts', false, true],
  ['Prospection listes et groupes entiers', 'limité', true],
  ['Closing e-commerce automatique', false, true],
  ['Protection anti-blocage intégrée', false, true],
  ['Instructions en langage naturel', false, true],
] as const;

const HOW_STEPS = [
  {
    id: 1,
    step: '01',
    title: 'Scannez le QR code',
    description:
      'Comme WhatsApp Web. Aucune API, aucun développeur, aucun compte Meta. Prêt en 30 secondes.',
    color: 'rgba(32, 87, 206, 0.8)',
  },
  {
    id: 2,
    step: '02',
    title: 'Donnez une instruction en français',
    description:
      '« Extrais les contacts de ce groupe », « lance une campagne », « publie ce statut ». L’agent comprend.',
    color: 'rgba(32, 87, 206, 0.65)',
  },
  {
    id: 3,
    step: '03',
    title: 'L’agent exécute et rapporte',
    description:
      'Extraction, prospection, closing, publication — en autonomie, avec un bilan quotidien.',
    color: 'rgba(32, 87, 206, 0.5)',
  },
] as const;

function CellMark({ value }: { value: boolean | 'limité' }) {
  if (value === true) {
    return <Check className="h-4 w-4 text-brand" strokeWidth={2.5} aria-label="Oui" />;
  }
  if (value === 'limité') {
    return <span className="text-xs font-medium text-text-500">limité</span>;
  }
  return <Minus className="h-4 w-4 text-text-500/50" strokeWidth={2} aria-label="Non" />;
}

export function LandingPage(props: LandingPageProps = {}) {
  const { onLogin, onRegister, onOpenLegal } = props;
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const root = document.getElementById('root');
    const read = () =>
      setScrolled(
        (root?.scrollTop ?? 0) > 8 || window.scrollY > 8 || document.documentElement.scrollTop > 8,
      );
    read();
    root?.addEventListener('scroll', read, { passive: true });
    window.addEventListener('scroll', read, { passive: true });
    return () => {
      root?.removeEventListener('scroll', read);
      window.removeEventListener('scroll', read);
    };
  }, []);

  const goLogin = onLogin ?? (() => navigate('/login'));
  const goRegister = onRegister ?? (() => navigate('/register'));
  const goLegal = onOpenLegal ?? ((kind: LegalKind) => navigate(`/${kind}`));

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    // html/body/#root ont height:100% + overflow-x:hidden : le conteneur qui défile
    // est #root, pas la fenêtre, donc window.scrollTo() reste sans effet.
    // scrollIntoView remonte au bon conteneur ; l'offset du header vient du
    // scroll-margin-top posé sur section[id] dans index.css.
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // overflow-x-clip (et non hidden) sur le wrapper : `hidden` en ferait un conteneur
  // de scroll, ce qui désactiverait le position:sticky du header.
  return (
    <div className="min-h-full overflow-x-clip bg-[#f7f8fb] text-text-100">
      {/* Meta homepage = index.html uniquement (évite que SeoHead client écrase le head crawlé). */}
      <header
        className={cn(
          'sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300',
          scrolled
            ? 'border-black/[0.08] bg-white/85 shadow-[0_10px_30px_-24px_rgba(10,15,26,0.45)] backdrop-blur-xl'
            : 'border-black/[0.05] bg-[#f7f8fb]/80 backdrop-blur-md',
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center">
            <KlanvioLogo variant="full" size="md" />
          </div>

          <nav className="hidden items-center gap-0.5 rounded-full border border-black/[0.08] bg-gradient-to-b from-white to-[#f5f7fc] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(10,15,26,0.05)] lg:flex">
            {NAV_LINKS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollTo(id)}
                className="cursor-pointer whitespace-nowrap rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium text-text-400 transition hover:bg-black/[0.045] hover:text-text-100"
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={goLogin}
              className="hidden h-9 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white px-3.5 text-[0.8125rem] font-semibold text-text-200 shadow-sm transition hover:border-black/15 hover:text-text-100 lg:inline-flex"
            >
              Connexion
            </button>
            <div className="hidden lg:block">
              <ShinyButton size="sm" onClick={goRegister}>
                Essai gratuit
              </ShinyButton>
            </div>

            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/[0.08] bg-white text-text-300 shadow-sm transition hover:text-text-100 lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-black/[0.06] bg-white/95 px-4 pb-4 pt-3 backdrop-blur-xl sm:px-6 lg:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-0.5 text-sm font-medium text-text-400">
              {NAV_LINKS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollTo(id)}
                  className="cursor-pointer rounded-xl px-3 py-2.5 text-left transition hover:bg-black/[0.04] hover:text-text-100"
                >
                  {label}
                </button>
              ))}
              <div className="mt-3 flex flex-col gap-2.5 border-t border-black/[0.06] pt-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={goLogin}
                  className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white px-3.5 text-[0.8125rem] font-semibold text-text-200 shadow-sm sm:w-auto"
                >
                  Connexion
                </button>
                <ShinyButton size="sm" onClick={goRegister} className="w-full sm:w-auto">
                  Essai gratuit
                </ShinyButton>
              </div>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* HERO — fills viewport; denser type so less empty feel */}
        <section className="relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden">
          <HeroGridBackdrop />
          <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6 sm:py-10">
            <AnimatedContainer
              eager
              delay={0.05}
              className="flex w-full max-w-full flex-col items-center"
            >
              <h1 className="landing-h1 w-full text-balance text-text-100">
                Klanvio — l&apos;agent IA qui automatise{' '}
                <span className="text-brand">tout WhatsApp</span>, pas juste vos réponses
              </h1>

              <p className="landing-lead mx-auto mt-4 max-w-xl text-balance text-text-400">
                Les autres outils se contentent de répondre aux messages. Klanvio prospecte, relance,
                close vos ventes, gère vos groupes et publie vos statuts — comme un vrai commercial
                WhatsApp, 24h/24.
              </p>

              <div className="mt-5 flex w-full justify-center">
                <ShinyButton onClick={goRegister} className="max-w-full">
                  Essayer gratuitement {TRIAL_DAYS} jours
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </ShinyButton>
              </div>

              <div className="mt-6 flex w-full flex-wrap items-center justify-center gap-2">
                {CAPABILITIES.map((label) => (
                  <span
                    key={label}
                    className="inline-flex max-w-full items-center rounded-full border border-black/[0.08] bg-white/90 px-3 py-1 text-[11px] font-medium text-text-300 sm:text-xs"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </AnimatedContainer>
          </div>
        </section>

        <TrustStrip />

        {/* HOW — glass steps */}
        <section id="how" className="landing-section mx-auto max-w-6xl px-4 sm:px-6">
          <AnimatedContainer className="mx-auto max-w-2xl text-center">
            <h2 className="landing-h2 text-text-100">Aussi simple qu’une conversation</h2>
            <p className="landing-lead mt-2.5 text-text-400">
              Là où les autres outils demandent des heures de configuration, Klanvio comprend vos
              instructions en français. Trois étapes, c’est tout.
            </p>
          </AnimatedContainer>

          <div className="mt-6">
            <HowGlassSteps steps={[...HOW_STEPS]} />
          </div>
        </section>

        {/* COMPARE */}
        <section id="compare" className="landing-section bg-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <AnimatedContainer className="mx-auto max-w-2xl text-center">
              <h2 className="landing-h2 text-text-100">
                Répondre à un message ≠ gérer tout votre WhatsApp
              </h2>
              <p className="landing-lead mt-2.5 text-text-400">
                Les concurrents utilisent l’API Meta, qui bloque groupes et statuts. Klanvio, non.
              </p>
            </AnimatedContainer>

            <AnimatedContainer delay={0.1}>
              {/* Mobile: stacked rows — no horizontal scroll / cutoff */}
              <div className="mx-auto mt-8 max-w-3xl space-y-2.5 sm:hidden">
                {COMPARE_ROWS.map(([label, other, ours]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-black/[0.07] bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium text-text-200">{label}</p>
                    <div className="mt-2.5 grid grid-cols-2 gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="mb-1 text-text-500">Autres outils</p>
                        <CellMark value={other} />
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 font-medium text-brand">Klanvio</p>
                        <CellMark value={ours} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-black/[0.07] bg-[#f7f8fb] px-4 py-3">
                  <p className="text-sm font-medium text-text-200">Tarif</p>
                  <div className="mt-2.5 grid grid-cols-2 gap-3 text-xs">
                    <p className="text-text-400">40€ à 400€+/mois</p>
                    <p className="font-semibold text-brand">{COMPARE_PRICE_LABEL}</p>
                  </div>
                </div>
              </div>

              {/* Desktop / tablet table */}
              <div className="mx-auto mt-8 hidden max-w-3xl overflow-hidden rounded-xl border border-black/[0.07] sm:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/[0.06] bg-[#f7f8fb]">
                      <th className="w-[46%] px-4 py-3 font-medium text-text-500 md:px-5">
                        Fonctionnalité
                      </th>
                      <th className="w-[27%] px-3 py-3 font-medium text-text-500 md:px-5">
                        Autres outils
                      </th>
                      <th className="w-[27%] px-3 py-3 font-semibold text-brand md:px-5">Klanvio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map(([label, other, ours]) => (
                      <tr key={label} className="border-b border-black/[0.04] last:border-0">
                        <td className="px-4 py-3 text-text-300 md:px-5">{label}</td>
                        <td className="px-3 py-3 md:px-5">
                          <CellMark value={other} />
                        </td>
                        <td className="px-3 py-3 md:px-5">
                          <CellMark value={ours} />
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-[#f7f8fb]/60">
                      <td className="px-4 py-3 font-medium text-text-200 md:px-5">Tarif</td>
                      <td className="px-3 py-3 text-text-400 md:px-5">40€ à 400€+/mois</td>
                      <td className="px-3 py-3 font-semibold text-brand md:px-5">
                        {COMPARE_PRICE_LABEL}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </AnimatedContainer>
          </div>
        </section>

        {/* FEATURES — soft dither OK here */}
        <section id="features" className="landing-section mx-auto max-w-6xl px-4 sm:px-6">
          <AnimatedContainer className="mx-auto max-w-2xl text-center">
            <h2 className="landing-h2 text-text-100">Tout ce que Klanvio automatise</h2>
            <p className="landing-lead mt-2.5 text-text-400">
              Six domaines, un seul agent, zéro intervention manuelle — avec une protection
              anti-blocage intégrée.
            </p>
          </AnimatedContainer>

          <AnimatedContainer
            delay={0.12}
            className="relative mt-8 overflow-hidden rounded-2xl border border-black/[0.06] bg-white"
          >
            <ShaderBackdrop opacity={0.12} />
            <div className="relative z-10 grid grid-cols-1 divide-y divide-dashed divide-black/10 sm:grid-cols-2 sm:divide-x sm:divide-y md:grid-cols-3">
              {FEATURES.map((f) => (
                <FeatureCard
                  key={f.title}
                  feature={{
                    title: f.title,
                    icon: f.icon,
                    description: f.lead,
                    items: f.items,
                  }}
                />
              ))}
            </div>
          </AnimatedContainer>
        </section>

        {/* INTEGRATIONS then PRICING */}
        <AnimatedContainer>
          <IntegrationsSection />
        </AnimatedContainer>

        <AnimatedContainer>
          <BillingSection onStartTrial={goRegister} />
        </AnimatedContainer>

        <LandingFaq />

        {/* FINAL CTA — dither only here (+ features) */}
        <div className="pb-4 sm:pb-6">
          <AnimatedContainer>
            <CTASection
              badge={TRIAL_BADGE}
              title="Prêt à laisser Klanvio automatiser tout votre WhatsApp ?"
              description="Prospection, closing, groupes, statuts, anti-blocage. Connectez votre numéro et laissez l’agent travailler."
              buttonLabel="Commencer gratuitement"
              onButtonClick={goRegister}
            />
          </AnimatedContainer>
        </div>
      </main>

      <footer className="border-t border-black/[0.06] bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-5 px-4 py-8 sm:px-6 md:grid-cols-3 md:gap-4">
          <div className="flex flex-col items-center gap-1.5 md:items-start">
            <KlanvioLogo variant="full" size="sm" />
            <span className="text-xs text-text-500">© 2026 Klanvio</span>
          </div>

          <div className="flex items-center justify-center gap-2">
            {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] bg-white text-text-300 transition hover:border-brand/25 hover:text-brand"
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-text-500 md:justify-end">
            <button
              type="button"
              onClick={() => goLegal('mentions')}
              className="cursor-pointer transition hover:text-text-100"
            >
              Mentions légales
            </button>
            <button
              type="button"
              onClick={() => goLegal('confidentialite')}
              className="cursor-pointer transition hover:text-text-100"
            >
              Confidentialité
            </button>
            <button
              type="button"
              onClick={() => goLegal('contact')}
              className="cursor-pointer transition hover:text-text-100"
            >
              Contact
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
