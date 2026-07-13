import { LandingNav } from '@/components/landing/LandingNav';
import { Hero } from '@/components/landing/Hero';
import { TrustStrip } from '@/components/landing/TrustStrip';
import { FeatureBento } from '@/components/landing/FeatureBento';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { UseCases } from '@/components/landing/UseCases';
import { AntiBlockingSection } from '@/components/landing/AntiBlockingSection';
import { FaqAccordion } from '@/components/landing/FaqAccordion';
import { FinalCta } from '@/components/landing/FinalCta';
import { LandingFooter } from '@/components/landing/LandingFooter';

type LandingPageProps = {
  onLogin: () => void;
  onRegister: () => void;
};

export function LandingPage({ onLogin, onRegister }: LandingPageProps) {
  return (
    <div className="min-h-full bg-bg-0 text-text-100">
      <LandingNav onLogin={onLogin} onRegister={onRegister} />
      <main>
        <Hero onRegister={onRegister} />
        <TrustStrip />
        <FeatureBento />
        <HowItWorks />
        <UseCases />
        <AntiBlockingSection />
        <FaqAccordion />
        <FinalCta onRegister={onRegister} />
      </main>
      <LandingFooter />
    </div>
  );
}
