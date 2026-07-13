import { BarChart3, MessageSquare, Shield, ShoppingBag } from 'lucide-react';
import { Reveal } from './Reveal';

const BADGES = [
  { icon: MessageSquare, label: 'Réponses humaines' },
  { icon: Shield, label: 'Anti-blocage' },
  { icon: BarChart3, label: 'Rapports quotidiens' },
  { icon: ShoppingBag, label: 'Prospection + e-commerce' },
];

export function TrustStrip() {
  return (
    <section className="border-y border-black/10 bg-bg-100/50 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-6 px-4 sm:gap-10 sm:px-6">
        {BADGES.map((b, i) => {
          const Icon = b.icon;
          return (
            <Reveal key={b.label} delay={i * 0.05}>
              <div className="flex items-center gap-2 text-sm text-text-300">
                <Icon className="h-4 w-4 text-brand" />
                {b.label}
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
