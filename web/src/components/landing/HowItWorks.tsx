import { Reveal } from './Reveal';

const STEPS = [
  {
    num: '01',
    title: 'Connecte ton WhatsApp',
    desc: 'Scanne le QR code en 30 secondes. Ton numéro reste le tien.',
  },
  {
    num: '02',
    title: 'Décris ton objectif',
    desc: 'Prospection, vente, relance — l\'agent te pose les bonnes questions.',
  },
  {
    num: '03',
    title: 'Simule avant d\'activer',
    desc: 'Tu vois exactement comment Klanvio va parler à tes prospects.',
  },
  {
    num: '04',
    title: 'Active et reçois tes rapports',
    desc: 'Chaque jour : combien contactés, qui a répondu, qui est intéressé.',
  },
];

export function HowItWorks() {
  return (
    <section id="comment" className="border-t border-white/10 bg-bg-100/30 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-light text-text-100 sm:text-4xl">
            Comment ça marche
          </h2>
          <p className="mt-3 text-text-400">Quatre étapes. Zéro complexité.</p>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.num} delay={i * 0.08}>
              <div className="relative">
                <span className="font-serif text-4xl font-light text-brand/40">{s.num}</span>
                <h3 className="mt-2 text-base font-semibold text-text-100">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-400">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
