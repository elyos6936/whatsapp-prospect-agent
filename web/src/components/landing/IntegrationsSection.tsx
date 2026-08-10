import { Link } from 'react-router-dom';
import { OrbitingSkills } from '@/components/ui/orbiting-skills';
import { cn } from '@/lib/utils';

type IntegrationsSectionProps = {
  className?: string;
};

/**
 * Section Intégrations — même composant orbite desktop / mobile (échelle responsive).
 */
export function IntegrationsSection({ className }: IntegrationsSectionProps) {
  return (
    <section id="integrations" className={cn('landing-section bg-[#f7f8fb]', className)}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mx-auto max-w-lg space-y-3 text-center">
          <h2 className="landing-h2 text-balance text-text-100">Intégrations</h2>
          <p className="landing-lead text-text-400">
            Confiez à votre agent 1, 2 ou 3 comptes WhatsApp. Il extrait vos contacts, relance vos
            leads et se connecte à vos outils — sans configuration technique.
          </p>
        </div>

        <div className="mt-6 sm:mt-10">
          <OrbitingSkills />
        </div>

        <div className="relative z-20 mt-6 flex justify-center sm:mt-10">
          <Link
            to="/integrations"
            className="inline-flex items-center justify-center rounded-xl border border-black/10 bg-white px-5 py-2.5 text-sm font-semibold text-text-200 transition hover:border-brand-border hover:text-brand"
          >
            Voir toutes les intégrations
          </Link>
        </div>
      </div>
    </section>
  );
}
