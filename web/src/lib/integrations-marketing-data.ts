export type IntegrationSlug =
  | 'whatsapp'
  | 'google-contacts'
  | 'typeform'
  | 'calendly'
  | 'tally'
  | 'google-sheets';

export type IntegrationMarketingData = {
  slug: IntegrationSlug;
  name: string;
  shortName: string;
  seoTitle: string;
  seoDescription: string;
  headline: string;
  lead: string;
  benefits: { title: string; text: string }[];
  steps: { title: string; text: string }[];
  useCases: string[];
};

/** Données texte partagées UI + prerender SEO (sans composants React). */
export const INTEGRATIONS_MARKETING_DATA: IntegrationMarketingData[] = [
  {
    slug: 'whatsapp',
    name: 'WhatsApp',
    shortName: 'WhatsApp',
    seoTitle: 'Intégration WhatsApp | Klanvio',
    seoDescription:
      'Connectez WhatsApp à Klanvio : prospection, campagnes, réponses IA et extraction de contacts — sans API Meta, via QR code.',
    headline: 'WhatsApp, le canal où Klanvio travaille pour vous',
    lead: 'Liez votre numéro en scannant un QR. Votre agent prospecte, répond et relance sur WhatsApp Business ou personnel, avec les garde-fous anti-blocage intégrés.',
    benefits: [
      {
        title: 'Connexion simple par QR',
        text: 'Comme WhatsApp Web : Appareils connectés → Lier un appareil. Aucune API Meta à configurer.',
      },
      {
        title: 'Prospection & closing',
        text: 'Campagnes multi-cibles, réponses automatiques et clôture d’objectifs (livraison, RDV, paiement…).',
      },
      {
        title: 'Groupes & contacts',
        text: 'Extraction de membres, envoi ciblé et synchro possible vers Google Contacts pour limiter les blocages.',
      },
    ],
    steps: [
      {
        title: 'Ouvrir les réglages',
        text: 'Dans Klanvio, allez dans Réglages → WhatsApp et lancez la connexion.',
      },
      {
        title: 'Scanner le QR',
        text: 'Sur votre téléphone : WhatsApp → Appareils connectés → Lier un appareil.',
      },
      {
        title: 'Lancer l’agent',
        text: 'Dès que le statut est connecté, créez une campagne ou laissez l’agent répondre.',
      },
    ],
    useCases: [
      'Prospection de contacts ou de membres de groupes',
      'Relances et closing e-commerce sur WhatsApp',
      'Bilans quotidiens sur l’activité du compte',
    ],
  },
  {
    slug: 'google-contacts',
    name: 'Google Contacts',
    shortName: 'Contacts',
    seoTitle: 'Intégration Google Contacts | Klanvio',
    seoDescription:
      'Synchronisez automatiquement vos prospects WhatsApp vers Google Contacts pour un carnet unifié et une meilleure délivrabilité.',
    headline: 'Google Contacts : chaque prospect a sa fiche',
    lead: 'Quand un inconnu répond ou qu’une campagne démarre, Klanvio peut créer ou mettre à jour le contact dans Google Contacts — avec le nom WhatsApp, pas seulement le numéro.',
    benefits: [
      {
        title: 'Fiches visibles dans « Contacts »',
        text: 'Les contacts sont ajoutés au groupe Mes contacts pour apparaître dans l’app Google Contacts.',
      },
      {
        title: 'Nom WhatsApp réel',
        text: 'Push name / profil WA priorisés pour éviter les fiches au seul numéro.',
      },
      {
        title: 'Idempotence',
        text: 'Pas de doublons inutiles : Klanvio vérifie avant de créer ou de mettre à jour.',
      },
    ],
    steps: [
      {
        title: 'Connecter Google',
        text: 'Réglages → Intégrations → Google Contacts, avec le compte synchronisé sur le téléphone WhatsApp.',
      },
      {
        title: 'Autoriser l’accès',
        text: 'Validez le consentement OAuth (scope Contacts) une seule fois.',
      },
      {
        title: 'Laisser tourner les campagnes',
        text: 'À l’envoi ou via save_contact, la synchro Google se fait en arrière-plan.',
      },
    ],
    useCases: [
      'Enregistrement auto des leads campagne',
      'Carnet partagé équipe / téléphone',
      'Réduction des blocages liés aux numéros inconnus',
    ],
  },
  {
    slug: 'typeform',
    name: 'Typeform',
    shortName: 'Typeform',
    seoTitle: 'Intégration Typeform | Klanvio',
    seoDescription:
      'Transformez les réponses Typeform en leads WhatsApp : Klanvio lit vos formulaires et relance automatiquement les prospects.',
    headline: 'Typeform → lead WhatsApp, sans copier-coller',
    lead: 'Reliez votre compte Typeform. L’agent s’appuie sur vos formulaires et réponses pour enrichir le pipeline et relancer sur WhatsApp.',
    benefits: [
      {
        title: 'Formulaires & réponses',
        text: 'Accès en lecture aux forms et responses pour piloter des campagnes ou des relances.',
      },
      {
        title: 'Parcours inbound',
        text: 'Une réponse Typeform devient un contact à traiter dans Klanvio / WhatsApp.',
      },
      {
        title: 'OAuth sécurisé',
        text: 'Connexion officielle Typeform, révocable à tout moment depuis les réglages.',
      },
    ],
    steps: [
      {
        title: 'Connecter Typeform',
        text: 'Réglages → Intégrations → Typeform, puis autorisez l’application.',
      },
      {
        title: 'Choisir le formulaire',
        text: 'Indiquez à l’agent quel form utiliser (liste disponible une fois connecté).',
      },
      {
        title: 'Automatiser la suite',
        text: 'Campagne ou scénario : chaque réponse utile peut déclencher une action WhatsApp.',
      },
    ],
    useCases: [
      'Leads webinar / landing → message WhatsApp',
      'Qualification avant appel commercial',
      'Collecte d’adresse / infos livraison puis notif tiers',
    ],
  },
  {
    slug: 'calendly',
    name: 'Calendly',
    shortName: 'Calendly',
    seoTitle: 'Intégration Calendly | Klanvio',
    seoDescription:
      'Connectez Calendly à Klanvio : lisez vos RDV et votre carnet Contacts, puis relancez sur WhatsApp.',
    headline: 'Calendly → RDV WhatsApp, sans copier-coller',
    lead: 'Reliez Calendly. L’agent voit vos types d’événements, bookings (invitees) et Contacts pour enrichir le pipeline WhatsApp.',
    benefits: [
      {
        title: 'Types d’événements & RDV',
        text: 'Liste des event types et lecture des scheduled events / invitees.',
      },
      {
        title: 'Carnet Contacts',
        text: 'Lecture du carnet Contacts Calendly pour enrichir les leads.',
      },
      {
        title: 'Leads depuis les bookings',
        text: 'Téléphone (SMS reminder ou questions custom) → suggested_leads WhatsApp.',
      },
      {
        title: 'OAuth sécurisé',
        text: 'Connexion officielle Calendly, révocable depuis les réglages.',
      },
    ],
    steps: [
      {
        title: 'Connecter Calendly',
        text: 'Réglages → Intégrations → Calendly, puis autorisez l’application.',
      },
      {
        title: 'Choisir une source',
        text: 'Event type ou carnet Contacts — indiquez-le à l’agent.',
      },
      {
        title: 'Relancer les leads',
        text: 'L’agent lit les données et peut proposer une campagne WhatsApp.',
      },
    ],
    useCases: [
      'No-show / confirmation RDV sur WhatsApp',
      'Relance après booking demo',
      'Qualification post-calendrier',
    ],
  },
  {
    slug: 'tally',
    name: 'Tally',
    shortName: 'Tally',
    seoTitle: 'Intégration Tally | Klanvio',
    seoDescription:
      'Connectez Tally à Klanvio : lisez vos formulaires et soumissions, puis transformez les réponses en leads WhatsApp.',
    headline: 'Tally → lead WhatsApp, sans copier-coller',
    lead: 'Collez votre clé API Tally. L’agent lit formulaires et soumissions pour détecter les téléphones et relancer sur WhatsApp.',
    benefits: [
      {
        title: 'Formulaires & soumissions',
        text: 'Lecture des forms et submissions (comme Typeform).',
      },
      {
        title: 'Clé API simple',
        text: 'Pas d’OAuth : une clé API personnelle, chiffrée côté Klanvio.',
      },
      {
        title: 'Leads inbound',
        text: 'Téléphones détectés → suggested_leads pour campagnes WhatsApp.',
      },
    ],
    steps: [
      {
        title: 'Créer une clé API',
        text: 'Sur Tally → Settings → API keys, créez une clé puis collez-la dans Klanvio.',
      },
      {
        title: 'Connecter dans Klanvio',
        text: 'Réglages → Intégrations → Tally.',
      },
      {
        title: 'Briefer l’agent',
        text: 'Demandez la liste des forms puis les réponses d’un formulaire précis.',
      },
    ],
    useCases: [
      'Landing / waitlist → WhatsApp',
      'Qualification formulaire → campagne',
      'Collecte téléphone post-inscription',
    ],
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    shortName: 'Sheets',
    seoTitle: 'Intégration Google Sheets | Klanvio',
    seoDescription:
      'Connectez Google Sheets à Klanvio pour synchroniser listes de prospects, exports et suivi de campagnes WhatsApp.',
    headline: 'Google Sheets comme source et journal de campagne',
    lead: 'Importez ou suivez vos prospects depuis une feuille Google. Klanvio s’intègre à votre stack tableur sans outil ETL.',
    benefits: [
      {
        title: 'Listes de prospection',
        text: 'Utilisez une feuille comme audience : numéros, noms, colonnes utiles à l’agent.',
      },
      {
        title: 'Suivi opérationnel',
        text: 'Gardez une vue tableur des contacts et de l’avancement à côté de WhatsApp.',
      },
      {
        title: 'Compte Google unifié',
        text: 'Même famille OAuth que Contacts / Drive file, depuis les Intégrations Klanvio.',
      },
    ],
    steps: [
      {
        title: 'Lier Google Sheets',
        text: 'Réglages → Intégrations → Google Sheets et choisissez le compte Google.',
      },
      {
        title: 'Sélectionner le classeur',
        text: 'Pointez la feuille qui contient (ou recevra) vos prospects.',
      },
      {
        title: 'Briefer l’agent',
        text: 'En campagne ou en chat, indiquez d’utiliser cette feuille comme source ou suivi.',
      },
    ],
    useCases: [
      'Import d’une liste CRM exportée en Sheets',
      'Suivi commercial partagé avec l’équipe',
      'Export des contacts traités par campagne',
    ],
  },
];

export function integrationPath(slug: IntegrationSlug): string {
  return `/integrations/${slug}`;
}

export function getIntegrationDataBySlug(slug: string): IntegrationMarketingData | null {
  return INTEGRATIONS_MARKETING_DATA.find((i) => i.slug === slug) ?? null;
}
