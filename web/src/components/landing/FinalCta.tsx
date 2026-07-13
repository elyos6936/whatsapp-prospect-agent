import { ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';

type FinalCtaProps = {
  onRegister: () => void;
};

export function FinalCta({ onRegister }: FinalCtaProps) {
  return (
    <section className="border-t border-black/10 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <Reveal>
          <h2 className="font-serif text-3xl font-light text-text-100 sm:text-4xl">
            Prêt à laisser Klanvio prospecter pour toi ?
          </h2>
          <p className="mt-4 text-text-400">
            Connecte ton WhatsApp, décris ton objectif, et laisse l&apos;agent faire le reste.
          </p>
          <button
            type="button"
            onClick={onRegister}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            Commencer gratuitement
            <ArrowRight className="h-4 w-4" />
          </button>
        </Reveal>
      </div>
    </section>
  );
}
