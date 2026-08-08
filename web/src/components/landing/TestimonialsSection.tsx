import { motion } from 'motion/react';
import {
  TestimonialsColumn,
  type Testimonial,
} from '@/components/ui/testimonials-columns-1';
import { cn } from '@/lib/utils';

const testimonials: Testimonial[] = [
  {
    text: 'Avant Klanvio, on perdait des leads WhatsApp tous les soirs. Maintenant l’agent relance et close pendant qu’on dort — à Cotonou comme à Porto-Novo.',
    image:
      'https://images.unsplash.com/photo-1531384441138-2736e62e0919?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Codjo Hounsa',
    role: 'Directeur commercial, Cotonou',
  },
  {
    text: 'Connecté en 30 secondes avec le QR. J’ai lancé ma première campagne le même jour — sans API Meta, sans développeur.',
    image:
      'https://images.unsplash.com/photo-1589156280159-276148cc1667?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Adjovi Mensah',
    role: 'Fondatrice d’agence, Abomey-Calavi',
  },
  {
    text: 'L’anti-blocage nous a rassurés. On prospecte plus, sans risque pour nos numéros business.',
    image:
      'https://images.unsplash.com/photo-1522529599102-193c0d76b5b6?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Séidou Alassane',
    role: 'Responsable e-commerce, Parakou',
  },
  {
    text: 'Je donne les consignes en français, l’agent extrait les contacts des groupes et démarre. Exactement ce qu’il nous manquait.',
    image:
      'https://images.unsplash.com/photo-1507152832244-10d45c7eda57?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Aïcha Dossou',
    role: 'Consultante formation, Cotonou',
  },
  {
    text: 'En deux semaines, notre taux de réponse WhatsApp a doublé. Le closing automatique fait le reste.',
    image:
      'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Bio Gandonou',
    role: 'CEO startup, Cotonou',
  },
  {
    text: 'Simple, clair, efficace. Mes formateurs n’ont plus à relancer manuellement chaque prospect.',
    image:
      'https://images.unsplash.com/photo-1531123897727-8f129e168987?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Grâce Akpovo',
    role: 'Coach business, Porto-Novo',
  },
  {
    text: 'On a branché Google Contacts et Typeform : les leads arrivent, Klanvio prend le relais sur WhatsApp.',
    image:
      'https://images.unsplash.com/photo-1506277886164-e25aa3f6ef1a?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Éric Agbodjan',
    role: 'Fondateur école privée, Bohicon',
  },
  {
    text: 'Le suivi en temps réel change tout. Je vois qui a répondu, qui est chaud, qui relancer.',
    image:
      'https://images.unsplash.com/photo-1595956553066-fe24a8c9b8c4?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Akouavi Tossou',
    role: 'Marketing digital, Cotonou',
  },
  {
    text: 'Essai de 3 jours, résultats dès le premier. On est passés au plan annuel sans hésiter.',
    image:
      'https://images.unsplash.com/photo-1607990283143-e81e7a2c9349?auto=format&fit=crop&w=96&h=96&q=80',
    name: 'Mireille Houénou',
    role: 'Directrice commerciale, Calavi',
  },
];

const firstColumn = testimonials.slice(0, 3);
const secondColumn = testimonials.slice(3, 6);
const thirdColumn = testimonials.slice(6, 9);

type TestimonialsSectionProps = {
  className?: string;
};

export function TestimonialsSection({ className }: TestimonialsSectionProps) {
  return (
    <section
      id="testimonials"
      className={cn('landing-section relative bg-[#f7f8fb]', className)}
    >
      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true }}
          className="mx-auto flex max-w-xl flex-col items-center justify-center text-center"
        >
          <div className="rounded-lg border border-black/[0.08] bg-white px-3.5 py-1 text-xs font-medium text-text-400">
            Témoignages
          </div>
          <h2 className="landing-h2 mt-4 text-text-100">Ce que disent nos utilisateurs</h2>
          <p className="landing-lead mt-2.5 text-text-400">
            Des équipes au Bénin qui prospectent et closent sur WhatsApp avec Klanvio.
          </p>
        </motion.div>

        <div className="mt-10 flex justify-center gap-6 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] max-h-[740px]">
          <TestimonialsColumn testimonials={firstColumn} duration={15} />
          <TestimonialsColumn
            testimonials={secondColumn}
            className="hidden md:block"
            duration={19}
          />
          <TestimonialsColumn
            testimonials={thirdColumn}
            className="hidden lg:block"
            duration={17}
          />
        </div>
      </div>
    </section>
  );
}
