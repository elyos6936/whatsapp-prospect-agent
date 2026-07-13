import { Megaphone, RefreshCw, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from './Reveal';

type UseCase = { icon: LucideIcon; title: string; description: string };

const CASES: UseCase[] = [
  {
    icon: Users,
    title: 'Prospecter un groupe',
    description:
      '« Prospecte tous les membres de mon groupe formation » — Klanvio contacte chaque personne avec le bon message, au bon rythme.',
  },
  {
    icon: Megaphone,
    title: 'Closer les clients d\'une pub',
    description:
      'Quand quelqu\'un écrit « je suis intéressé », l\'agent prend le relais pour collecter les infos et closer.',
  },
  {
    icon: RefreshCw,
    title: 'Relancer sans harceler',
    description:
      'Une relance le lendemain si pas de réponse. Puis arrêt intelligent si le prospect n\'est pas intéressé.',
  },
];

export function UseCases() {
  return (
    <section id="cas-usage" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-light text-text-100 sm:text-4xl">
            Cas d&apos;usage concrets
          </h2>
          <p className="mt-3 text-text-400">
            Que vous vendiez une formation, un produit ou un service — Klanvio s&apos;adapte.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {CASES.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal key={c.title} delay={i * 0.08}>
                <div className="panel h-full p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-muted text-brand">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-text-100">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-400">{c.description}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
