import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Reveal } from './Reveal';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: 'Puis-je utiliser mon WhatsApp personnel ?',
    a: 'Oui. Vous connectez votre numéro via QR code, comme sur WhatsApp Web. Votre compte reste le vôtre.',
  },
  {
    q: 'Vais-je me faire bloquer ?',
    a: 'Klanvio intègre des règles anti-blocage : rythme d\'envoi maîtrisé, refus des actions risquées, arrêt intelligent des conversations. C\'est notre priorité numéro un.',
  },
  {
    q: 'L\'IA répond-elle toute seule à tout le monde ?',
    a: 'Non. Elle répond uniquement aux prospects contactés pendant vos campagnes, ou aux clients qui écrivent le message-clé que vous avez défini (e-commerce).',
  },
  {
    q: 'Puis-je prospecter plusieurs contacts à la fois ?',
    a: 'Oui — un groupe entier, une liste de contacts, ou un seul numéro. Vous choisissez le rythme et le nombre max de messages par jour.',
  },
  {
    q: 'Est-ce que ça marche pour l\'e-commerce ?',
    a: 'Oui. Définissez le message déclencheur (ex. « je suis intéressé ») et Klanvio gère l\'échange jusqu\'au paiement ou à la livraison.',
  },
  {
    q: 'Comment je vois les résultats ?',
    a: 'Chaque campagne a ses statistiques : contactés, réponses, taux de réponse. Vous recevez aussi un rapport quotidien automatique.',
  },
];

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <Reveal className="text-center">
          <h2 className="font-serif text-3xl font-light text-text-100 sm:text-4xl">
            Questions fréquentes
          </h2>
        </Reveal>

        <div className="mt-10 space-y-2">
          {FAQS.map((faq, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={faq.q} delay={i * 0.04}>
                <div className="panel overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-sm font-medium text-text-100">{faq.q}</span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-text-500 transition',
                        isOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                      >
                        <p className="border-t border-black/10 px-5 py-4 text-sm leading-relaxed text-text-400">
                          {faq.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
