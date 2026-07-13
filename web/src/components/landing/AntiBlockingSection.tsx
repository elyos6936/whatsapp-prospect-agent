import { Shield, Timer, UserX } from 'lucide-react';
import { Reveal } from './Reveal';

const POINTS = [
  {
    icon: Timer,
    title: 'Rythme maîtrisé',
    desc: 'Délais entre chaque message, limite quotidienne — configurés avec vous avant chaque campagne.',
  },
  {
    icon: Shield,
    title: 'Bonnes pratiques intégrées',
    desc: 'Klanvio refuse les actions risquées (spam massif, envois simultanés) et propose des alternatives sûres.',
  },
  {
    icon: UserX,
    title: 'Arrêt intelligent',
    desc: 'Si le prospect n\'est pas intéressé ou pose trop de questions, la conversation s\'arrête proprement.',
  },
];

export function AntiBlockingSection() {
  return (
    <section className="border-t border-black/10 bg-bg-100/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <h2 className="font-serif text-3xl font-light text-text-100 sm:text-4xl">
              Un expert WhatsApp qui protège ton compte
            </h2>
            <p className="mt-4 text-text-400 leading-relaxed">
              Klanvio a 20 ans d&apos;expérience WhatsApp business intégrés. Chaque action est pensée
              pour maximiser vos résultats sans jamais dépasser le seuil de risque de blocage.
            </p>
          </Reveal>

          <div className="space-y-4">
            {POINTS.map((p, i) => {
              const Icon = p.icon;
              return (
                <Reveal key={p.title} delay={i * 0.08}>
                  <div className="panel flex gap-4 p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-medium text-text-100">{p.title}</h3>
                      <p className="mt-1 text-sm text-text-400">{p.desc}</p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
