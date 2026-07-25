import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageSquare, Shield } from 'lucide-react';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';

export type LegalKind = 'mentions' | 'confidentialite' | 'contact';

type LegalPageProps = {
  kind: LegalKind;
  onBack: () => void;
};

const CONTACT_EMAIL = 'contact@klanvio.com';
const SITE_URL = 'https://www.klanvio.com';

const SEO: Record<LegalKind, { title: string; description: string; path: string }> = {
  mentions: {
    title: 'Mentions légales | Klanvio',
    description:
      'Mentions légales de Klanvio : éditeur, hébergement, propriété intellectuelle et conditions d’utilisation du site.',
    path: '/mentions',
  },
  confidentialite: {
    title: 'Politique de confidentialité | Klanvio',
    description:
      'Politique de confidentialité Klanvio : données collectées, finalités, sous-traitants, durées de conservation et vos droits RGPD.',
    path: '/confidentialite',
  },
  contact: {
    title: 'Contact | Klanvio',
    description:
      'Contactez l’équipe Klanvio pour l’essai, la facturation, le support produit ou un partenariat. Réponse sous 1 à 2 jours ouvrés.',
    path: '/contact',
  },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-20">
      <h2 className="text-base font-semibold text-text-100">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-text-300">{children}</div>
    </section>
  );
}

const CONTENT: Record<
  LegalKind,
  { title: string; updated: string; intro: string; body: ReactNode }
> = {
  mentions: {
    title: 'Mentions légales',
    updated: '25 juillet 2026',
    intro:
      'Conformément aux dispositions applicables à la publication d’un service en ligne, les présentes mentions informent les utilisateurs du site Klanvio.',
    body: (
      <>
        <Section title="1. Éditeur du site">
          <p>
            <strong className="font-medium text-text-200">Nom commercial :</strong> Klanvio
          </p>
          <p>
            <strong className="font-medium text-text-200">Activité :</strong> logiciel SaaS
            d’automatisation et d’assistance commerciale sur WhatsApp (prospection, campagnes,
            intégrations).
          </p>
          <p>
            <strong className="font-medium text-text-200">Site :</strong>{' '}
            <a className="text-brand underline-offset-2 hover:underline" href={SITE_URL}>
              {SITE_URL}
            </a>
          </p>
          <p>
            <strong className="font-medium text-text-200">Contact :</strong>{' '}
            <a
              className="text-brand underline-offset-2 hover:underline"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
          </p>
          <p className="text-text-500">
            La raison sociale, le numéro d’immatriculation (SIRET / équivalent), l’adresse du siège
            et l’identité du responsable de publication seront complétés dès finalisation des
            formalités d’entreprise. En attendant, le point de contact ci-dessus fait foi pour
            toute demande relative au service.
          </p>
        </Section>

        <Section title="2. Hébergement">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-medium text-text-200">Front-end :</strong> Netlify (pages
              statiques / CDN) — Netlify, Inc.
            </li>
            <li>
              <strong className="font-medium text-text-200">API applicative :</strong> serveur VPS
              Hostinger.
            </li>
            <li>
              <strong className="font-medium text-text-200">Base de données :</strong> Supabase
              (infrastructure cloud).
            </li>
          </ul>
          <p className="text-text-500">
            Les coordonnées complètes des hébergeurs sont disponibles sur leurs sites institutionnels
            respectifs.
          </p>
        </Section>

        <Section title="3. Propriété intellectuelle">
          <p>
            L’ensemble des éléments du site et de l’application Klanvio (marques, logos, textes,
            interfaces, code, bases de données) est protégé. Toute reproduction, représentation ou
            adaptation non autorisée est interdite, hors exceptions légales.
          </p>
          <p>
            Les marques tierces (WhatsApp, Google, Typeform, etc.) appartiennent à leurs
            titulaires respectifs ; leur mention n’implique aucune affiliation non déclarée.
          </p>
        </Section>

        <Section title="4. Responsabilité">
          <p>
            Klanvio s’efforce d’assurer l’accès et le bon fonctionnement du service. Des
            interruptions (maintenance, incidents réseaux, dépendances WhatsApp / Google /
            Typeform) peuvent survenir. L’utilisateur reste responsable de l’usage qu’il fait de
            l’agent, du respect des conditions des plateformes tierces et de la conformité de ses
            campagnes (consentement, opt-out, contenu).
          </p>
        </Section>

        <Section title="5. Données personnelles">
          <p>
            Le traitement des données est décrit dans la{' '}
            <Link className="text-brand underline-offset-2 hover:underline" to="/confidentialite">
              politique de confidentialité
            </Link>
            .
          </p>
        </Section>

        <Section title="6. Droit applicable">
          <p>
            Les présentes mentions sont régies par le droit français. À défaut de résolution
            amiable, les tribunaux français seront compétents dans les conditions de droit commun.
          </p>
        </Section>
      </>
    ),
  },
  confidentialite: {
    title: 'Politique de confidentialité',
    updated: '25 juillet 2026',
    intro:
      'Cette politique explique quelles données Klanvio traite, pourquoi, avec qui, et quels droits vous pouvez exercer. Elle s’applique au site et à l’application.',
    body: (
      <>
        <Section title="1. Responsable du traitement">
          <p>
            Le responsable du traitement est l’éditeur de Klanvio, joignable à{' '}
            <a
              className="text-brand underline-offset-2 hover:underline"
              href={`mailto:${CONTACT_EMAIL}?subject=Confidentialit%C3%A9%20Klanvio`}
            >
              {CONTACT_EMAIL}
            </a>
            . Les mentions d’identification légale seront complétées avec les formalités
            d’entreprise.
          </p>
        </Section>

        <Section title="2. Données collectées">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="font-medium text-text-200">Compte :</strong> nom, adresse e-mail,
              mot de passe (hashé) ou identifiants via connexion Google.
            </li>
            <li>
              <strong className="font-medium text-text-200">WhatsApp :</strong> état de connexion,
              identifiant d’instance, messages et métadonnées nécessaires aux campagnes et
              réponses (contenu que vous choisissez de traiter via le service).
            </li>
            <li>
              <strong className="font-medium text-text-200">CRM léger :</strong> contacts, notes,
              statuts, journaux de campagne, mémoires de conversation.
            </li>
            <li>
              <strong className="font-medium text-text-200">Intégrations :</strong> jetons OAuth et
              données en lecture/écriture selon les permissions que vous accordez (Google
              Contacts, Google Sheets, Typeform…).
            </li>
            <li>
              <strong className="font-medium text-text-200">Usage technique :</strong> logs
              applicatifs, diagnostics, données de session (cookie / jeton d’auth).
            </li>
          </ul>
        </Section>

        <Section title="3. Finalités">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Fournir et sécuriser le service (auth, session, anti-abus).</li>
            <li>Exécuter les campagnes, réponses et automatisations que vous configurez.</li>
            <li>Synchroniser les outils que vous connectez.</li>
            <li>Vous envoyer les rapports / bilans que vous activez.</li>
            <li>Améliorer la stabilité du produit (logs, correction d’incidents).</li>
            <li>Répondre à vos demandes support.</li>
          </ul>
        </Section>

        <Section title="4. Bases légales">
          <p>
            Selon le cas : exécution du contrat (fourniture du SaaS), intérêt légitime
            (sécurité, amélioration du service) et/ou consentement (certaines intégrations ou
            communications). Vous pouvez retirer un consentement OAuth en déconnectant
            l’intégration dans Réglages.
          </p>
        </Section>

        <Section title="5. Destinataires et sous-traitants">
          <p>
            Les données sont accessibles aux équipes habilitées de Klanvio et aux prestataires
            techniques nécessaires : hébergement (Netlify, Hostinger), base de données
            (Supabase), fournisseurs LLM pour la rédaction assistée, et plateformes tierces que
            vous connectez explicitement (Google, Typeform, infrastructure WhatsApp).
          </p>
          <p>Nous ne vendons pas vos données personnelles.</p>
        </Section>

        <Section title="6. Durées de conservation">
          <p>
            Les données de compte et d’activité sont conservées tant que le compte est actif, puis
            archivées ou supprimées dans un délai raisonnable après clôture ou demande, sous
            réserve d’obligations légales (facturation future, sécurité). Les jetons
            d’intégration sont révoqués lorsque vous déconnectez le fournisseur.
          </p>
        </Section>

        <Section title="7. Transferts hors UE">
          <p>
            Certains prestataires peuvent traiter des données hors de l’Espace économique
            européen. Dans ce cas, des garanties appropriées (clauses contractuelles types ou
            mécanismes équivalents) sont recherchées auprès des fournisseurs.
          </p>
        </Section>

        <Section title="8. Vos droits">
          <p>
            Conformément au RGPD, vous disposez d’un droit d’accès, de rectification,
            d’effacement, de limitation, d’opposition et de portabilité, dans les conditions
            légales. Pour les exercer :{' '}
            <a
              className="text-brand underline-offset-2 hover:underline"
              href={`mailto:${CONTACT_EMAIL}?subject=Droits%20RGPD%20Klanvio`}
            >
              {CONTACT_EMAIL}
            </a>
            . Vous pouvez aussi introduire une réclamation auprès de la CNIL (
            <a
              className="text-brand underline-offset-2 hover:underline"
              href="https://www.cnil.fr"
              target="_blank"
              rel="noopener noreferrer"
            >
              cnil.fr
            </a>
            ).
          </p>
        </Section>

        <Section title="9. Cookies et traceurs">
          <p>
            Klanvio utilise des cookies ou stockages locaux essentiels à l’authentification et au
            fonctionnement de l’application. Des outils de mesure d’audience / performance
            (ex. analytics d’hébergeur) peuvent être présents sur le site public ; ils sont
            configurés de façon aussi limitée que possible.
          </p>
        </Section>

        <Section title="10. Modifications">
          <p>
            Cette politique peut évoluer (nouveaux modules, paiement, obligations légales). La
            date de mise à jour figure en tête de page. En cas de changement substantiel, une
            information pourra être affichée dans le produit ou par e-mail.
          </p>
        </Section>
      </>
    ),
  },
  contact: {
    title: 'Contact',
    updated: '25 juillet 2026',
    intro:
      'Une question sur l’essai, une campagne, une intégration ou un partenariat ? Écrivez-nous — un humain vous répond.',
    body: (
      <>
        <div className="rounded-2xl border border-black/[0.07] bg-white p-6 shadow-sm shadow-black/[0.02]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/[0.1] text-brand">
              <Mail className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-100">E-mail support</h2>
              <p className="mt-1 text-sm text-text-400">
                Canal principal pour le produit, le compte et la facturation (bientôt).
              </p>
              <a
                className="mt-4 inline-flex items-center rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
                href={`mailto:${CONTACT_EMAIL}?subject=Contact%20Klanvio`}
              >
                {CONTACT_EMAIL}
              </a>
              <p className="mt-3 text-xs text-text-500">Réponse sous 1 à 2 jours ouvrés en général.</p>
            </div>
          </div>
        </div>

        <Section title="Sujets fréquents">
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              {
                icon: MessageSquare,
                title: 'Essai & onboarding',
                text: 'Connexion WhatsApp, première campagne, bonnes pratiques.',
              },
              {
                icon: Shield,
                title: 'Compte & données',
                text: 'Accès RGPD, suppression, sécurité, intégrations OAuth.',
              },
            ].map((item) => (
              <li
                key={item.title}
                className="flex gap-3 rounded-xl border border-black/[0.06] bg-white/80 px-4 py-3"
              >
                <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div>
                  <p className="text-sm font-medium text-text-200">{item.title}</p>
                  <p className="mt-0.5 text-xs text-text-500">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <p>
            Pour un partenariat ou une demande presse, indiquez-le dans l’objet du message à la
            même adresse.
          </p>
        </Section>

        <Section title="Avant d’écrire">
          <p>
            Consultez la FAQ sur la{' '}
            <Link className="text-brand underline-offset-2 hover:underline" to="/#faq">
              page d’accueil
            </Link>
            , les pages{' '}
            <Link className="text-brand underline-offset-2 hover:underline" to="/integrations">
              Intégrations
            </Link>
            , ou reconnectez WhatsApp depuis Réglages si le statut est hors ligne.
          </p>
        </Section>
      </>
    ),
  },
};

export function LegalPage({ kind, onBack: _onBack }: LegalPageProps) {
  const page = CONTENT[kind];
  const seo = SEO[kind];

  return (
    <MarketingPageShell seo={seo} backTo="/" backLabel="Accueil">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Klanvio</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text-100 sm:text-3xl">
        {page.title}
      </h1>
      <p className="mt-2 text-xs text-text-500">Dernière mise à jour : {page.updated}</p>
      <p className="mt-5 text-sm leading-relaxed text-text-400">{page.intro}</p>
      <div className="mt-10 space-y-10">{page.body}</div>
    </MarketingPageShell>
  );
}
