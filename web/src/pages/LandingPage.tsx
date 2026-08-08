import { useEffect, useState } from 'react';
import { ArrowRight, Menu, QrCode, Shield, Target, X, type LucideIcon } from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { FacebookIcon, LinkedinIcon, YoutubeIcon } from '@/components/brand/SocialIcons';
import { AnimatedContainer } from '@/components/landing/AnimatedContainer';
import { BillingSection } from '@/components/landing/BillingSection';
import { HeroFloatingIcons } from '@/components/landing/HeroFloatingIcons';
import { HeroTypingWord } from '@/components/landing/HeroTypingWord';
import { IntegrationsSection } from '@/components/landing/IntegrationsSection';
import { LandingFaq } from '@/components/landing/LandingFaq';
import { TestimonialsSection } from '@/components/landing/TestimonialsSection';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { HowItWorks, type HowStep } from '@/components/ui/how-it-works';
import { CTASection } from '@/components/ui/hero-dithering-card';
import { ShaderBackground } from '@/components/ui/light-blue-plasma-shader-w-grain-interactive';
import { ShinyButton } from '@/components/ui/shiny-button';
import type { LegalKind } from '@/pages/LegalPage';
import { useNavigate } from 'react-router-dom';
import { TRIAL_BADGE } from '@/lib/pricing';
import { cn } from '@/lib/utils';

type LandingPageProps = {
  // kept optional for legacy unused landing components
  onLogin?: () => void;
  onRegister?: () => void;
  onOpenLegal?: (kind: LegalKind) => void;
};

const NAV_LINKS = [
  ['how', 'Comment ça marche'],
  ['integrations', 'Intégrations'],
  ['testimonials', 'Témoignages'],
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

const CAPABILITIES: { label: string; icon: LucideIcon }[] = [
  { label: 'QR en 30 secondes', icon: QrCode },
  { label: 'Prospection + closing', icon: Target },
  { label: 'Anti-blocage intégré', icon: Shield },
];

const HOW_FEATURES: HowStep[] = [
  {
    title: 'Scannez le QR code',
    description:
      'Comme WhatsApp Web. Aucune API, aucun développeur, aucun compte Meta. Prêt en 30 secondes.',
    imageSrc: '/landing/how/step-01-qr.png',
    imageAlt: 'Connexion WhatsApp via QR code dans Klanvio',
    tone: 'brand',
  },
  {
    title: 'Donnez une instruction en français',
    description:
      '« Extrais les contacts de ce groupe », « lance une campagne », « publie ce statut ». L’agent comprend.',
    imageSrc: '/landing/how/step-02-instruction.png',
    imageAlt: 'Instruction de campagne donnée à l’agent Klanvio',
    tone: 'sky',
  },
  {
    title: 'L’agent exécute et rapporte',
    description:
      'Extraction, prospection, closing, publication — en autonomie, avec anti-blocage et suivi en temps réel.',
    imageSrc: '/landing/how/step-03-execute.png',
    imageAlt: 'Campagne active et simulation WhatsApp dans Klanvio',
    tone: 'navy',
  },
];

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
            : 'border-black/[0.05] bg-white/70 backdrop-blur-md',
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
        {/* HERO — white canvas + soft brand plasma + 4 integration logos */}
        <section className="relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-white">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <ShaderBackground className="absolute inset-0 h-full w-full" />
            {/* Soft white center for text — sides keep the plasma bubbles */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.88)_0%,rgba(255,255,255,0.45)_36%,rgba(255,255,255,0.08)_62%,transparent_78%)]" />
          </div>

          <HeroFloatingIcons />

          <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-14">
            <AnimatedContainer
              eager
              delay={0.05}
              className="flex w-full max-w-full flex-col items-center gap-0"
            >
              <h1 className="landing-h1 w-full text-balance text-text-100">
                Klanvio l&apos;agent IA qui automatise{' '}
                <span className="whitespace-nowrap">
                  <HeroTypingWord text="tout WhatsApp" className="text-brand" />,
                </span>{' '}
                pas juste vos réponses
              </h1>

              <p className="landing-lead mx-auto mt-5 max-w-xl text-balance text-text-400">
                Klanvio prospecte, relance, close vos ventes, gère vos groupes et publie vos
                statuts comme un vrai commercial WhatsApp, 24h/24.
              </p>

              <div className="mt-7 flex w-full justify-center">
                <ShinyButton onClick={goRegister} className="max-w-full">
                  Commencer gratuitement
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </ShinyButton>
              </div>

              <div className="mt-8 flex w-full flex-wrap items-center justify-center gap-2.5">
                {CAPABILITIES.map(({ label, icon: Icon }) => (
                  <span
                    key={label}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/90 px-3.5 py-1.5 text-[11px] font-medium text-text-300 shadow-sm sm:text-xs"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                    {label}
                  </span>
                ))}
              </div>
            </AnimatedContainer>
          </div>
        </section>

        <TrustStrip />

        {/* HOW — pin cards + product screenshots */}
        <section id="how" className="landing-section">
          <AnimatedContainer className="mx-auto max-w-2xl px-4 text-center sm:px-6">
            <h2 className="landing-h2 text-text-100">Aussi simple qu’une conversation</h2>
            <p className="landing-lead mt-2.5 text-text-400">
              Là où les autres outils demandent des heures de configuration, Klanvio comprend vos
              instructions en français. Trois étapes, c’est tout.
            </p>
          </AnimatedContainer>

          <div className="mt-4">
            <HowItWorks features={HOW_FEATURES} />
          </div>
        </section>

        {/* INTEGRATIONS → TÉMOIGNAGES → PRICING */}
        <AnimatedContainer>
          <IntegrationsSection />
        </AnimatedContainer>

        <AnimatedContainer>
          <TestimonialsSection />
        </AnimatedContainer>

        <AnimatedContainer>
          <BillingSection onStartTrial={goRegister} />
        </AnimatedContainer>

        <LandingFaq />

        {/* FINAL CTA */}
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
