import { useState } from 'react';
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
import { AnimatedContainer } from '@/components/landing/AnimatedContainer';
import { BillingSection } from '@/components/landing/BillingSection';
import { FeatureCard } from '@/components/ui/grid-feature-cards';
import { HowGlassSteps } from '@/components/ui/glass-cards';
import { CTASection } from '@/components/ui/hero-dithering-card';
import { HeroGridBackdrop } from '@/components/ui/hero-grid-backdrop';
import { ShaderBackdrop } from '@/components/ui/shader-backdrop';
import { ShinyButton } from '@/components/ui/shiny-button';

type LandingPageProps = {
  onLogin: () => void;
  onRegister: () => void;
};

const NAV_LINKS = [
  ['features', 'Fonctionnalités'],
  ['how', 'Comment ça marche'],
  ['compare', 'Comparatif'],
  ['pricing', 'Tarif'],
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

export function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-full overflow-x-hidden bg-[#f7f8fb] text-text-100">
      <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[#f7f8fb]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="min-w-0 shrink">
            <KlanvioLogo variant="full" size="md" />
          </div>

          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 text-sm font-medium text-text-400 lg:flex">
            {NAV_LINKS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollTo(id)}
                className="cursor-pointer whitespace-nowrap transition hover:text-text-100"
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-2.5 lg:flex">
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white px-3.5 text-[0.8125rem] font-semibold text-text-200 shadow-sm transition hover:border-black/15 hover:bg-white hover:text-text-100"
            >
              Connexion
            </button>
            <ShinyButton size="sm" onClick={onRegister}>
              Essai gratuit
            </ShinyButton>
          </div>

          <button
            type="button"
            className="shrink-0 cursor-pointer rounded-lg p-2 text-text-400 lg:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-black/[0.06] bg-white px-4 py-4 lg:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 text-sm font-medium text-text-400">
              {NAV_LINKS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollTo(id)}
                  className="cursor-pointer rounded-lg px-1 py-2.5 text-left hover:text-text-100"
                >
                  {label}
                </button>
              ))}
              <div className="mt-2 flex flex-col gap-2.5 border-t border-black/[0.06] pt-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={onLogin}
                  className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white px-3.5 text-[0.8125rem] font-semibold text-text-200 shadow-sm sm:w-auto"
                >
                  Connexion
                </button>
                <ShinyButton size="sm" onClick={onRegister} className="w-full sm:w-auto">
                  Essai gratuit
                </ShinyButton>
              </div>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* HERO — fills viewport; denser type so less empty feel */}
        <section className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col overflow-hidden">
          <HeroGridBackdrop />
          <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6 sm:py-10">
            <AnimatedContainer delay={0.05} className="flex w-full max-w-full flex-col items-center">
              <h1 className="landing-h1 w-full text-balance text-text-100">
                Le seul agent IA qui automatise{' '}
                <span className="text-brand">tout WhatsApp</span>, pas juste vos réponses
              </h1>

              <p className="landing-lead mx-auto mt-4 max-w-xl text-balance text-text-400">
                Les autres outils se contentent de répondre aux messages. Klanvio prospecte, relance,
                close vos ventes, gère vos groupes et publie vos statuts — comme un vrai commercial
                WhatsApp, 24h/24.
              </p>

              <div className="mt-5 flex w-full justify-center">
                <ShinyButton onClick={onRegister} className="max-w-full">
                  Essayer gratuitement 7 jours
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
                    <p className="font-semibold text-brand">15€/mois · essai 7 jours</p>
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
                        15€/mois · essai 7 jours
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

        {/* BILLING */}
        <AnimatedContainer>
          <BillingSection onStartTrial={onRegister} />
        </AnimatedContainer>

        {/* FINAL CTA — dither only here (+ features) */}
        <div className="pb-4 sm:pb-6">
          <AnimatedContainer>
            <CTASection
              badge="Essai gratuit 7 jours"
              title="Prêt à laisser Klanvio automatiser tout votre WhatsApp ?"
              description="Prospection, closing, groupes, statuts, anti-blocage. Connectez votre numéro et laissez l’agent travailler."
              buttonLabel="Commencer gratuitement"
              onButtonClick={onRegister}
            />
          </AnimatedContainer>
        </div>
      </main>

      <footer className="border-t border-black/[0.06] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 text-center text-sm text-text-500 sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <div className="flex items-center gap-3">
            <KlanvioLogo variant="full" size="sm" />
            <span className="hidden text-text-500 sm:inline">© 2026 Klanvio</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span>Mentions légales</span>
            <span>Confidentialité</span>
            <span>Contact</span>
          </div>
          <span className="text-text-500 sm:hidden">© 2026 Klanvio</span>
        </div>
      </footer>
    </div>
  );
}
