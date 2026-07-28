/**
 * Données SEO + HTML crawlable pour le prerender post-build (sans React).
 */
import {
  INTEGRATIONS_MARKETING_DATA,
  integrationPath,
  type IntegrationSlug,
} from './integrations-marketing-data.ts';

export type PrerenderPage = {
  path: string;
  title: string;
  description: string;
  robots?: string;
  bodyHtml: string;
};

const SITE = 'https://www.klanvio.com';

function integrationDetailHtml(slug: IntegrationSlug): string {
  const item = INTEGRATIONS_MARKETING_DATA.find((i) => i.slug === slug);
  if (!item) return '';

  const benefits = item.benefits
    .map((b) => `<h3>${b.title}</h3><p>${b.text}</p>`)
    .join('');
  const steps = item.steps
    .map((s, i) => `<li><strong>${i + 1}. ${s.title}</strong> — ${s.text}</li>`)
    .join('');
  const useCases = item.useCases.map((u) => `<li>${u}</li>`).join('');

  return `
    <nav aria-label="Fil d'Ariane"><a href="/">Accueil</a> / <a href="/integrations">Intégrations</a> / ${item.name}</nav>
    <h1>${item.headline}</h1>
    <p>${item.lead}</p>
    <p><a href="/register">Essai gratuit 7 jours</a> · <a href="/login">Se connecter</a></p>
    <h2>Pourquoi connecter ${item.name}</h2>
    ${benefits}
    <h2>Comment ça marche</h2>
    <ol>${steps}</ol>
    <h2>Cas d'usage</h2>
    <ul>${useCases}</ul>
    <p><a href="/integrations">Voir toutes les intégrations Klanvio</a></p>
  `;
}

export function getPrerenderPages(): PrerenderPage[] {
  const integrationHubCards = INTEGRATIONS_MARKETING_DATA.map(
    (item) =>
      `<li><a href="${integrationPath(item.slug)}"><strong>${item.name}</strong></a> — ${item.lead}</li>`,
  ).join('');

  const integrationPages: PrerenderPage[] = INTEGRATIONS_MARKETING_DATA.map((item) => ({
    path: integrationPath(item.slug),
    title: item.seoTitle,
    description: item.seoDescription,
    bodyHtml: integrationDetailHtml(item.slug),
  }));

  return [
    {
      path: '/integrations',
      title: 'Intégrations | Klanvio',
      description:
        'Connectez WhatsApp, Google Contacts, Typeform et Google Sheets à Klanvio pour prospecter et closer sans configuration technique.',
      bodyHtml: `
        <h1>Vos outils, reliés à l'agent WhatsApp Klanvio</h1>
        <p>Confiez à votre agent 1, 2 ou 3 comptes WhatsApp. Il extrait vos contacts, relance vos leads et se connecte à vos outils — sans configuration technique.</p>
        <h2>Intégrations disponibles</h2>
        <ul>${integrationHubCards}</ul>
        <p><a href="/register">Essai gratuit 7 jours</a></p>
      `,
    },
    ...integrationPages,
    {
      path: '/register',
      title: 'Créer un compte | Klanvio',
      description:
        'Créez votre compte Klanvio et essayez gratuitement l’agent WhatsApp IA pour prospecter, relancer et closer vos ventes.',
      bodyHtml: `
        <h1>Créer un compte Klanvio</h1>
        <p>Agent WhatsApp IA pour prospection, relances et closing. Connexion par QR code, anti-blocage intégré, essai gratuit 7 jours.</p>
        <p><a href="/login">Déjà inscrit ? Se connecter</a></p>
      `,
    },
    {
      path: '/contact',
      title: 'Contact | Klanvio',
      description:
        'Contactez l’équipe Klanvio pour l’essai, la facturation, le support produit ou un partenariat. Réponse sous 1 à 2 jours ouvrés.',
      bodyHtml: `
        <h1>Contact Klanvio</h1>
        <p>Une question sur l'essai, une campagne, une intégration ou un partenariat ? Écrivez-nous.</p>
        <p><a href="mailto:contact@klanvio.com">contact@klanvio.com</a></p>
        <p>Réponse sous 1 à 2 jours ouvrés. Consultez aussi la <a href="/#faq">FAQ</a> et les <a href="/integrations">intégrations</a>.</p>
      `,
    },
    {
      path: '/mentions',
      title: 'Mentions légales | Klanvio',
      description:
        'Mentions légales de Klanvio : éditeur, hébergement, propriété intellectuelle et conditions d’utilisation du site.',
      bodyHtml: `
        <h1>Mentions légales</h1>
        <p>Klanvio — logiciel SaaS d'automatisation commerciale sur WhatsApp (prospection, campagnes, intégrations).</p>
        <h2>Éditeur</h2>
        <p>Site : <a href="${SITE}">${SITE}</a> — Contact : <a href="mailto:contact@klanvio.com">contact@klanvio.com</a></p>
        <h2>Hébergement</h2>
        <p>Application web et API hébergées en Europe. Données utilisateur sur infrastructure cloud sécurisée.</p>
      `,
    },
    {
      path: '/confidentialite',
      title: 'Politique de confidentialité | Klanvio',
      description:
        'Politique de confidentialité Klanvio : données collectées, finalités, sous-traitants, durées de conservation et vos droits RGPD.',
      bodyHtml: `
        <h1>Politique de confidentialité</h1>
        <p>Klanvio traite les données nécessaires au compte, aux campagnes WhatsApp et aux intégrations (Google, Typeform).</p>
        <h2>Vos droits</h2>
        <p>Accès, rectification, suppression, portabilité — contact@klanvio.com</p>
        <h2>Données WhatsApp</h2>
        <p>Messages et contacts traités pour exécuter vos campagnes et réponses automatiques, selon vos instructions.</p>
      `,
    },
  ];
}
