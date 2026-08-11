import { ArrowRight } from 'lucide-react';
import { AnimatedContainer } from '@/components/landing/AnimatedContainer';
import { ShinyButton } from '@/components/ui/shiny-button';
import { TRIAL_BADGE } from '@/lib/pricing';
import { cn } from '@/lib/utils';

type FinalCtaProps = {
  onRegister: () => void;
  className?: string;
};

/**
 * CTA final — même langage visuel que le hero (orbes CSS doux, pas de shader WebGL).
 */
export function FinalCta({ onRegister, className }: FinalCtaProps) {
  return (
    <section
      className={cn(
        'landing-section relative overflow-hidden bg-[#f7f8fb]',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute left-1/2 top-0 h-[min(70vw,420px)] w-[min(90vw,560px)] -translate-x-1/2 -translate-y-1/3 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(32, 87, 206, 0.16) 0%, rgba(32, 87, 206, 0) 70%)',
            filter: 'blur(48px)',
          }}
        />
        <div
          className="absolute bottom-0 right-[-10%] h-[min(50vw,280px)] w-[min(50vw,280px)] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(56, 189, 248, 0) 72%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(rgba(32, 87, 206, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(32, 87, 206, 0.04) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage:
              'radial-gradient(ellipse 70% 60% at 50% 45%, #000 10%, transparent 75%)',
          }}
        />
      </div>

      <AnimatedContainer className="relative z-10 mx-auto max-w-2xl px-4 text-center sm:px-6">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/15 bg-white/80 px-3 py-1 text-xs font-medium text-brand shadow-sm">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
          {TRIAL_BADGE}
        </p>

        <h2 className="landing-h2 text-balance text-text-100">
          Prêt à laisser Klanvio automatiser tout votre WhatsApp&nbsp;?
        </h2>

        <p className="landing-lead mx-auto mt-3 max-w-lg text-balance text-text-400">
          Prospection, closing, groupes, statuts, anti-blocage. Connectez votre numéro et laissez
          l’agent travailler.
        </p>

        <div className="mt-8 flex justify-center">
          <ShinyButton
            onClick={onRegister}
            className="w-full max-w-sm !min-h-[3.1rem] !px-7 !text-[0.95rem] sm:w-auto sm:!min-h-[3.35rem] sm:!px-9"
          >
            Commencer gratuitement
            <ArrowRight className="h-4 w-4 shrink-0" />
          </ShinyButton>
        </div>
      </AnimatedContainer>
    </section>
  );
}
