import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';

export type LegalKind = 'mentions' | 'confidentialite' | 'contact';

type LegalPageProps = {
  kind: LegalKind;
  onBack: () => void;
};

const CONTACT_EMAIL = 'rapports@klanvio.com';

const CONTENT: Record<LegalKind, { title: string; body: ReactNode }> = {
  mentions: {
    title: 'Mentions légales',
    body: (
      <>
        <p>
          <strong>Éditeur :</strong> Klanvio — service d’automatisation WhatsApp destiné aux
          professionnels.
        </p>
        <p>
          <strong>Contact :</strong>{' '}
          <a className="text-brand underline-offset-2 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
        <p>
          <strong>Hébergement :</strong> application web (Netlify) et API (Hostinger VPS). Base de
          données : Supabase.
        </p>
        <p className="text-text-500">
          Ces mentions seront complétées (raison sociale, siège, responsable de publication) dès
          finalisation des formalités d’entreprise.
        </p>
      </>
    ),
  },
  confidentialite: {
    title: 'Confidentialité',
    body: (
      <>
        <p>
          Klanvio traite les données nécessaires au fonctionnement du service : compte (email,
          nom), connexion WhatsApp, messages et campagnes que vous pilotez via l’agent.
        </p>
        <p>
          Les données ne sont pas vendues. Elles servent uniquement à fournir le produit, la
          sécurité du compte et les rapports d’activité que vous activez.
        </p>
        <p>
          Vous pouvez demander l’accès, la rectification ou la suppression de vos données à{' '}
          <a className="text-brand underline-offset-2 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="text-text-500">
          Une politique de confidentialité détaillée sera publiée avant la commercialisation
          étendue.
        </p>
      </>
    ),
  },
  contact: {
    title: 'Contact',
    body: (
      <>
        <p>Une question sur Klanvio, l’essai ou votre campagne ? Écrivez-nous.</p>
        <p>
          <a
            className="inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
            href={`mailto:${CONTACT_EMAIL}?subject=Contact%20Klanvio`}
          >
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="text-text-500">Nous répondons en général sous 1 à 2 jours ouvrés.</p>
      </>
    ),
  },
};

export function LegalPage({ kind, onBack }: LegalPageProps) {
  const page = CONTENT[kind];

  return (
    <div className="min-h-full bg-[#f7f8fb] text-text-100">
      <header className="border-b border-black/[0.06] bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <KlanvioLogo variant="full" size="md" />
          <button
            type="button"
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-400 transition hover:text-text-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="landing-h2 text-text-100">{page.title}</h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-text-300">{page.body}</div>
      </main>
    </div>
  );
}
