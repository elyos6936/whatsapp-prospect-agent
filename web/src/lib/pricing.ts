/** Source unique des tarifs Klanvio (landing + Facturation). Pas d’API paiement pour l’instant. */

export const TRIAL_DAYS = 3;
export const REFUND_DAYS = 14;
export const FOUNDER_TAKEN = 37;
export const FOUNDER_TOTAL = 100;

export type BillingPeriod = 'monthly' | 'annual';

export type PlanId = 'starter' | 'pro' | 'business';

export type PricingPlan = {
  id: PlanId;
  name: string;
  accounts: number;
  monthly: number;
  monthlyOld: number;
  annual: number;
  annualOld: number;
  /** Libellé « X€ par compte » (mensuel). */
  perAccountMonthly: string;
  /** Badge économie vs Starter (Pro / Business). */
  saveLabel?: string;
  features: string[];
  featured?: boolean;
  featuredLabel?: string;
};

export const PLANS: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    accounts: 1,
    monthly: 15,
    monthlyOld: 22,
    annual: 150,
    annualOld: 264,
    perAccountMonthly: '15€ par compte',
    features: [
      '1 agent IA configurable',
      '1 compte WhatsApp connecté',
      '1 000 messages traités/mois',
      'Extraction de contacts WhatsApp',
      'Intégration Google Contacts',
      'Bilans quotidiens automatiques',
      `Essai gratuit ${TRIAL_DAYS} jours`,
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    accounts: 2,
    monthly: 25,
    monthlyOld: 38,
    annual: 250,
    annualOld: 456,
    perAccountMonthly: '12,50€ par compte',
    saveLabel: '-17%',
    featured: true,
    featuredLabel: 'Le plus choisi',
    features: [
      '2 agents IA configurables',
      '2 comptes WhatsApp connectés',
      '3 500 messages traités/mois',
      'Extraction de contacts WhatsApp',
      'Intégration Google Contacts',
      '+ Typeform & Google Sheets',
      'Bilans quotidiens automatiques',
      `Essai gratuit ${TRIAL_DAYS} jours`,
    ],
  },
  {
    id: 'business',
    name: 'Business',
    accounts: 3,
    monthly: 35,
    monthlyOld: 55,
    annual: 350,
    annualOld: 660,
    perAccountMonthly: '11,67€ par compte',
    saveLabel: '-42%',
    features: [
      '3 agents IA configurables',
      '3 comptes WhatsApp connectés',
      'Messages traités illimités',
      'Extraction de contacts WhatsApp',
      'Google Contacts, Typeform & Google Sheets',
      'Rapport hebdomadaire approfondi',
      'Configuration accompagnée en visio',
      'Accès prioritaire aux nouvelles fonctions',
      `Essai gratuit ${TRIAL_DAYS} jours`,
    ],
  },
];

export function getPlan(id: PlanId): PricingPlan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]!;
}

export function planPrice(plan: PricingPlan, period: BillingPeriod): number {
  return period === 'annual' ? plan.annual : plan.monthly;
}

export function planOldPrice(plan: PricingPlan, period: BillingPeriod): number {
  return period === 'annual' ? plan.annualOld : plan.monthlyOld;
}

export function formatEuro(amount: number): string {
  return `${amount}€`;
}

export function periodSuffix(period: BillingPeriod): string {
  return period === 'annual' ? '/an' : '/mois';
}

export function accountsLabel(n: number): string {
  return n === 1 ? '1 compte WhatsApp' : `${n} comptes WhatsApp`;
}

/** Texte compare / hero : point d’entrée bas de gamme. */
export const COMPARE_PRICE_LABEL = `à partir de ${formatEuro(15)}/mois · essai ${TRIAL_DAYS} jours`;

export const TRIAL_BADGE = `Essai gratuit ${TRIAL_DAYS} jours`;
