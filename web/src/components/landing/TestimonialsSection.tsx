import { TestimonialsRow, type Testimonial } from '@/components/ui/testimonials-columns-1';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

/** Verified Unsplash face crops (broken IDs removed — several prior URLs 404’d). */
const testimonials: Testimonial[] = [
  {
    text: 'Avant Klanvio, on perdait des leads WhatsApp tous les soirs. Maintenant l’agent relance et close pendant qu’on dort — à Cotonou comme à Porto-Novo.',
    image:
      'https://images.unsplash.com/photo-1531384441138-2736e62e0919?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Codjo Hounsa',
    role: 'Directeur commercial, Cotonou',
  },
  {
    text: 'Connecté en 30 secondes avec le QR. J’ai lancé ma première campagne le même jour — sans API Meta, sans développeur.',
    image:
      'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Adjovi Mensah',
    role: 'Fondatrice d’agence, Abomey-Calavi',
  },
  {
    text: 'L’anti-blocage nous a rassurés. On prospecte plus, sans risque pour nos numéros business.',
    image:
      'https://images.unsplash.com/photo-1522529599102-193c0d76b5b6?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Séidou Alassane',
    role: 'Responsable e-commerce, Parakou',
  },
  {
    text: 'Je donne les consignes en français, l’agent extrait les contacts des groupes et démarre. Exactement ce qu’il nous manquait.',
    image:
      'https://images.unsplash.com/photo-1507152832244-10d45c7eda57?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Aïcha Dossou',
    role: 'Consultante formation, Cotonou',
  },
  {
    text: 'En deux semaines, notre taux de réponse WhatsApp a doublé. Le closing automatique fait le reste.',
    image:
      'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Bio Gandonou',
    role: 'CEO startup, Cotonou',
  },
  {
    text: 'Simple, clair, efficace. Mes formateurs n’ont plus à relancer manuellement chaque prospect.',
    image:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Grâce Akpovo',
    role: 'Coach business, Porto-Novo',
  },
  {
    text: 'On a branché Google Contacts et Typeform : les leads arrivent, Klanvio prend le relais sur WhatsApp.',
    image:
      'https://images.unsplash.com/photo-1615109398623-88346a601842?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Éric Agbodjan',
    role: 'Fondateur école privée, Bohicon',
  },
  {
    text: 'Le suivi en temps réel change tout. Je vois qui a répondu, qui est chaud, qui relancer.',
    image:
      'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Akouavi Tossou',
    role: 'Marketing digital, Cotonou',
  },
  {
    text: 'Essai de 3 jours, résultats dès le premier. On est passés au plan annuel sans hésiter.',
    image:
      'https://images.unsplash.com/photo-1607990283143-e81e7a2c9349?auto=format&fit=crop&w=128&h=128&q=80&crop=faces',
    name: 'Mireille Houénou',
    role: 'Directrice commerciale, Calavi',
  },
];

const row1 = testimonials.slice(0, 5);
const row2 = testimonials.slice(5, 9);

type TestimonialsSectionProps = {
  className?: string;
};

export function TestimonialsSection({ className }: TestimonialsSectionProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isMd = useMediaQuery('(min-width: 768px)');

  return (
    <section
      id="testimonials"
      className={cn('landing-section relative overflow-hidden bg-[#f7f8fb]', className)}
    >
      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto flex max-w-xl flex-col items-center justify-center text-center">
          <h2 className="landing-h2 text-text-100">Ce que disent nos utilisateurs</h2>
          <p className="landing-lead mt-2.5 text-text-400">
            Des équipes au Bénin qui prospectent et closent sur WhatsApp avec Klanvio.
          </p>
        </div>
      </div>

      <div className="relative mt-10 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        {reduceMotion ? (
          <div className="mx-auto grid max-w-5xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {testimonials.slice(0, 6).map((item) => (
              <article
                key={item.name}
                className="rounded-3xl border border-black/[0.08] bg-white p-6 text-left shadow-sm"
              >
                <p className="text-sm leading-relaxed text-text-300">{item.text}</p>
                <div className="mt-5 flex items-center gap-2.5">
                  <img
                    width={40}
                    height={40}
                    src={item.image}
                    alt={item.name}
                    className="h-10 w-10 rounded-full object-cover"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-100">{item.name}</p>
                    <p className="text-xs text-text-400">{item.role}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <TestimonialsRow testimonials={row1} duration={42} />
            {isMd && <TestimonialsRow testimonials={row2} duration={48} />}
          </div>
        )}
      </div>
    </section>
  );
}
