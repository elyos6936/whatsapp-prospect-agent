/** Source unique des tarifs Klanvio (landing + Facturation). */

export const TRIAL_DAYS = 3;
export const REFUND_DAYS = 14;

export type BillingPeriod = 'monthly' | 'annual';

/** Un seul plan produit — id `pro` conservé pour MoneyFusion / API. */
export type PlanId = 'pro';

export type PricingPlan = {
  id: PlanId;
  name: string;
  monthly: number;
  /** Prix annuel total (€). */
  annual: number;
  /** Équivalent mensuel affiché en mode annuel. */
  annualMonthly: number;
  features: string[];
  description: string;
  valueAnchor: string;
};

export const PLAN: PricingPlan = {
  id: 'pro',
  name: 'Klanvio',
  monthly: 20,
  annual: 200, // 2 mois offerts
  annualMonthly: 17,
  valueAnchor: 'Valeur réelle : 150€+/mois ailleurs',
  description:
    'Toutes les fonctionnalités. Aucune limite cachée. Essai 3 jours sans carte bancaire.',
  features: [
    'Prospection & diffusion WhatsApp automatisées',
    'Agent IA conversationnel (texte, voix, image, PDF)',
    'Anti-blocage & warmup intégrés',
    'WhatsApp natif — QR code, sans API Meta',
    'Sheets, Contacts, Typeform, Calendly, Tally',
    'n8n & Make pour aller plus loin',
    'Stats campagnes + bilan quotidien + rapport hebdo',
    'Équipe & rôles inclus',
  ],
};

/** Alias pour les écrans qui itèrent encore sur une liste. */
export const PLANS: PricingPlan[] = [PLAN];

export function getPlan(_id?: string): PricingPlan {
  return PLAN;
}

export function planPrice(plan: PricingPlan, period: BillingPeriod): number {
  return period === 'annual' ? plan.annual : plan.monthly;
}

/** Prix “par mois” affiché (annuel = équivalent mensuel). */
export function planDisplayMonthly(plan: PricingPlan, period: BillingPeriod): number {
  return period === 'annual' ? plan.annualMonthly : plan.monthly;
}

export function formatEuro(amount: number): string {
  return `${amount}€`;
}

export function periodSuffix(period: BillingPeriod): string {
  return period === 'annual' ? '/an' : '/mois';
}

export const COMPARE_PRICE_LABEL = `${formatEuro(PLAN.monthly)}/mois · essai ${TRIAL_DAYS} jours`;

export const TRIAL_BADGE = `Essai gratuit ${TRIAL_DAYS} jours`;
