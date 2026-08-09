import './landing-hero.css';

import { ArrowRight, Clock3, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { AnimatedContainer } from '@/components/landing/AnimatedContainer';
import { HeroTypingWord } from '@/components/landing/HeroTypingWord';
import { ShinyButton } from '@/components/ui/shiny-button';
import { cn } from '@/lib/utils';

type LandingHeroProps = {
  onStart: () => void;
  className?: string;
};

const TRUST: { icon: LucideIcon; label: string }[] = [
  { icon: Clock3, label: 'Réponse en 10 secondes' },
  { icon: Users, label: '24/7 disponible' },
  { icon: TrendingUp, label: 'Augmentez vos conversions' },
];

/**
 * Light brand hero — soft blue atmosphere, one CTA, compact trust row.
 */
export function LandingHero({ onStart, className }: LandingHeroProps) {
  return (
    <section
      className={cn(
        'landing-hero relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden',
        className,
      )}
    >
      <div className="landing-hero__atmosphere" aria-hidden>
        <div className="landing-hero__orb landing-hero__orb--brand" />
        <div className="landing-hero__orb landing-hero__orb--sky" />
        <div className="landing-hero__grid" />
        <div className="landing-hero__glow" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-5 py-14 text-center sm:px-8 sm:py-16 lg:py-20">
        <AnimatedContainer
          eager
          delay={0.04}
          className="flex w-full max-w-4xl flex-col items-center"
        >
          <h1 className="landing-hero__title w-full text-balance text-text-100">
            <span className="text-text-100">Klanvio</span>
            <span className="font-medium text-text-300"> l&apos;agent IA qui automatise </span>
            <span className="whitespace-nowrap">
              <HeroTypingWord text="tout WhatsApp" className="text-brand" />
              <span className="text-text-300">,</span>
            </span>
            <span className="font-medium text-text-300"> pas juste vos réponses</span>
          </h1>

          <p className="landing-hero__lead mx-auto mt-5 max-w-2xl text-balance text-text-400 sm:mt-6">
            Prospecte, relance, close, gère vos groupes et publie vos statuts — comme un vrai
            commercial WhatsApp, 24h/24.
          </p>

          <div className="mt-8 flex w-full justify-center sm:mt-10">
            <ShinyButton
              onClick={onStart}
              className="w-full max-w-sm !min-h-[3.25rem] !px-7 !text-[0.95rem] sm:w-auto sm:!min-h-[3.5rem] sm:!px-9 sm:!text-base"
            >
              Commencer gratuitement
              <ArrowRight className="h-4 w-4 shrink-0 sm:h-[1.1rem] sm:w-[1.1rem]" />
            </ShinyButton>
          </div>

          <ul className="mt-10 flex w-full max-w-3xl flex-col items-center gap-3.5 sm:mt-12 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-8 sm:gap-y-3">
            {TRUST.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2.5 text-sm font-medium text-text-300 sm:text-[0.9375rem]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/[0.1] text-brand ring-1 ring-brand/15">
                  <Icon className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </AnimatedContainer>
      </div>
    </section>
  );
}
