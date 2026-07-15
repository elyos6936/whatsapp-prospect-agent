import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedContainer } from '@/components/landing/AnimatedContainer';

const FAQS = [
  {
    q: 'Puis-je utiliser mon WhatsApp personnel ?',
    a: 'Oui. Vous connectez votre numéro via QR code, comme sur WhatsApp Web. Votre compte reste le vôtre.',
  },
  {
    q: 'Vais-je me faire bloquer ?',
    a: "Klanvio intègre des règles anti-blocage : rythme d'envoi maîtrisé, refus des actions risquées, arrêt intelligent des conversations. C'est notre priorité numéro un.",
  },
  {
    q: "L'IA répond-elle toute seule à tout le monde ?",
    a: 'Non. Elle répond uniquement aux prospects contactés pendant vos campagnes, ou aux clients qui écrivent le message-clé que vous avez défini (e-commerce).',
  },
  {
    q: 'Puis-je prospecter plusieurs contacts à la fois ?',
    a: 'Oui — un groupe entier, une liste de contacts, ou un seul numéro. Vous choisissez le rythme et le nombre max de messages par jour.',
  },
  {
    q: "Est-ce que ça marche pour l'e-commerce ?",
    a: 'Oui. Définissez le message déclencheur (ex. « je suis intéressé ») et Klanvio gère l’échange jusqu’au paiement ou à la livraison.',
  },
  {
    q: 'Comment je vois les résultats ?',
    a: 'Chaque campagne a ses statistiques : contactés, réponses, taux de réponse. Vous recevez aussi un rapport quotidien automatique.',
  },
] as const;

/** Lightweight FAQ — CSS only, no framer-motion. */
export function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="landing-section mx-auto max-w-3xl px-4 sm:px-6">
      <AnimatedContainer className="text-center">
        <h2 className="landing-h2 text-text-100">Questions fréquentes</h2>
        <p className="landing-lead mt-2.5 text-text-400">
          Les réponses utiles avant de démarrer votre essai.
        </p>
      </AnimatedContainer>

      <div className="mt-7 space-y-2">
        {FAQS.map((faq, i) => {
          const isOpen = open === i;
          return (
            <AnimatedContainer key={faq.q} delay={0.04 * i}>
              <div className="overflow-hidden rounded-xl border border-black/[0.07] bg-white">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3.5 text-left sm:px-5"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-medium text-text-100">{faq.q}</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-text-500 transition-transform duration-200',
                      isOpen && 'rotate-180',
                    )}
                  />
                </button>
                {isOpen && (
                  <p className="border-t border-black/[0.05] px-4 py-3.5 text-sm leading-relaxed text-text-400 sm:px-5">
                    {faq.a}
                  </p>
                )}
              </div>
            </AnimatedContainer>
          );
        })}
      </div>
    </section>
  );
}
