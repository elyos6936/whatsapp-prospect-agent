import { motion } from 'framer-motion';
import { ArrowRight, MessageCircle, Sparkles } from 'lucide-react';
import { Reveal } from './Reveal';
import { Spotlight } from './Spotlight';
import { AnimatedGradient } from './AnimatedGradient';

type HeroProps = {
  onRegister: () => void;
};

export function Hero({ onRegister }: HeroProps) {
  const scrollToFeatures = () => {
    document.getElementById('fonctionnalites')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative overflow-hidden pt-28 pb-20 sm:pt-32 sm:pb-28">
      <Spotlight />
      <AnimatedGradient />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-muted px-3 py-1 text-xs font-medium text-brand">
              <Sparkles className="h-3.5 w-3.5" />
              Agent WhatsApp intelligent
            </span>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="mt-5 font-serif text-4xl font-light leading-tight text-text-100 sm:text-5xl lg:text-[3.25rem]">
              Votre commercial WhatsApp qui prospecte et vend,{' '}
              <span className="text-brand">24h/24</span>.
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-text-400 sm:text-lg">
              Klanvio discute avec vos prospects comme un humain, relance au bon moment et
              close vos ventes — sans jamais faire bloquer votre compte.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onRegister}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:bg-brand-dark"
              >
                Commencer gratuitement
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={scrollToFeatures}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm text-text-200 transition hover:bg-bg-200"
              >
                Voir une démo
              </button>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.2} className="relative">
          <div className="panel relative overflow-hidden p-5">
            <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3">
              <MessageCircle className="h-4 w-4 text-brand" />
              <span className="text-sm font-medium text-text-200">Simulation en direct</span>
              <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">
                Campagne active
              </span>
            </div>

            <div className="space-y-3">
              <motion.div
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-sm text-white"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6, duration: 0.4 }}
              >
                Bonjour ! Je propose une formation en marketing digital. Ça vous intéresse ?
              </motion.div>
              <motion.div
                className="max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-bg-200 px-3.5 py-2.5 text-sm text-text-200"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.2, duration: 0.4 }}
              >
                Oui, c&apos;est quoi le prix et comment ça se passe ?
              </motion.div>
              <motion.div
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-sm text-white"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.8, duration: 0.4 }}
              >
                C&apos;est 25 000 FCFA, en ligne sur 4 semaines. Je vous envoie le lien ?
              </motion.div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-center">
              <div>
                <p className="text-lg font-semibold text-text-100">47</p>
                <p className="text-[10px] text-text-500">Contactés</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-emerald-400">12</p>
                <p className="text-[10px] text-text-500">Réponses</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-brand">26%</p>
                <p className="text-[10px] text-text-500">Taux</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
