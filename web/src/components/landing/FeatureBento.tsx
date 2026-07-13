import {
  BarChart3,
  Image,
  Megaphone,
  MessageCircle,
  Mic,
  Shield,
  ShoppingCart,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from './Reveal';
import { cn } from '@/lib/utils';

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
  className?: string;
};

const FEATURES: Feature[] = [
  {
    icon: Users,
    title: 'Prospection guidée',
    description: 'Groupes ou listes de contacts — l\'agent configure tout avec vous, étape par étape.',
    className: 'sm:col-span-2',
  },
  {
    icon: MessageCircle,
    title: 'Conversations qui gardent le fil',
    description: 'Chaque échange reste cohérent. Pas de re-salutation, pas de réponses robotiques.',
  },
  {
    icon: ShoppingCart,
    title: 'Closing e-commerce',
    description: 'Quand un client écrit le bon message, Klanvio prend le relais pour closer.',
  },
  {
    icon: Shield,
    title: 'Protection anti-blocage',
    description: 'Rythme d\'envoi maîtrisé, bonnes pratiques WhatsApp intégrées.',
  },
  {
    icon: BarChart3,
    title: 'Rapports & statistiques',
    description: 'Taux de réponse, messages envoyés, état de chaque campagne.',
    className: 'sm:col-span-2',
  },
  {
    icon: Mic,
    title: 'Comprend les vocaux',
    description: 'Messages vocaux, images et médias — l\'agent continue la conversation.',
  },
  {
    icon: Image,
    title: 'Images & stickers',
    description: 'Réponses adaptées même quand le prospect envoie une photo ou un sticker.',
  },
  {
    icon: Megaphone,
    title: 'Diffusion dans vos chaînes',
    description: 'Publiez dans vos chaînes WhatsApp existantes en un message.',
    className: 'sm:col-span-2',
  },
];

export function FeatureBento() {
  return (
    <section id="fonctionnalites" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-light text-text-100 sm:text-4xl">
            Tout ce qu&apos;il faut pour vendre sur WhatsApp
          </h2>
          <p className="mt-3 text-text-400">
            Des campagnes intelligentes, des réponses humaines, et un expert qui protège votre compte.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.title} delay={i * 0.04} className={cn(f.className)}>
                <div className="panel group h-full p-5 transition hover:border-brand-border">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-muted text-brand transition group-hover:bg-brand group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-text-100">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-400">{f.description}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
