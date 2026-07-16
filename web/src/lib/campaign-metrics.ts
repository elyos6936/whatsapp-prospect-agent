export const TARGET_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente', color: '#94a3b8' },
  contacted: { label: 'Sans réponse', color: '#2057ce' },
  replied: { label: 'Réponses', color: '#0ea5e9' },
  interested: { label: 'Intéressés', color: '#10b981' },
  stopped: { label: 'Arrêtés', color: '#f59e0b' },
  error: { label: 'Erreurs', color: '#ef4444' },
};

export const TARGET_ORDER = [
  'interested',
  'replied',
  'contacted',
  'pending',
  'stopped',
  'error',
] as const;

/** Métriques réelles : « contacté » DB = encore sans réponse ; « atteints » = tous ceux touchés. */
export function outreachMetrics(stats?: Record<string, number | string | undefined> | null) {
  const pending = Number(stats?.pending ?? 0);
  const waitingReply = Number(stats?.contacted ?? 0);
  const replied = Number(stats?.replied ?? 0);
  const interested = Number(stats?.interested ?? 0);
  const stopped = Number(stats?.stopped ?? 0);
  const errors = Number(stats?.errors ?? 0);
  const reached = waitingReply + replied + interested + stopped;
  const answered = replied + interested;
  const rate = reached > 0 ? Math.round((answered / reached) * 100) : null;
  const interestRate = answered > 0 ? Math.round((interested / answered) * 100) : null;
  return {
    pending,
    waitingReply,
    replied,
    interested,
    stopped,
    errors,
    reached,
    answered,
    rate,
    interestRate,
  };
}

export function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

export type CampaignGoal =
  | 'payment'
  | 'delivery'
  | 'link'
  | 'appointment'
  | 'support'
  | 'outreach'
  | string;

export type StatCard = {
  key: string;
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'default' | 'success' | 'warn';
};

/** KPIs adaptés au type / objectif de campagne (e-commerce, RDV, support…). */
export function goalAwareStatCards(input: {
  type: string;
  closingGoal?: string | null;
  productName?: string | null;
  stats?: Record<string, number | string | undefined> | null;
}): { title: string; subtitle: string; cards: StatCard[]; funnelLabels: [string, string, string, string] } {
  const metrics = outreachMetrics(input.stats);
  const handled = Number(input.stats?.messagesHandled ?? 0);
  const conversions = Number(input.stats?.conversions ?? 0);
  const goal = (input.closingGoal || '').toLowerCase();
  const type = input.type;
  const isOutbound = type === 'group_prospect' || type === 'contact_prospect';
  const isInbound = type === 'keyword_sales';
  const productHint = input.productName?.trim();

  if (goal === 'appointment' || /\brdv|rendez/.test(productHint || '')) {
    return {
      title: 'Prise de rendez-vous',
      subtitle: 'Focus : conversations engagées et RDV confirmés',
      funnelLabels: ['Cibles', 'Atteints', 'Réponses', 'RDV'],
      cards: [
        { key: 'reached', label: 'Atteints', value: metrics.reached },
        { key: 'answered', label: 'Réponses', value: metrics.answered },
        {
          key: 'rate',
          label: 'Taux de réponse',
          value: metrics.rate != null ? `${metrics.rate}%` : '—',
        },
        {
          key: 'conversions',
          label: 'RDV / conversions',
          value: conversions || metrics.interested,
          accent: 'success',
          hint: 'Prospects passés à l’action (lien / confirmation)',
        },
      ],
    };
  }

  if (goal === 'payment' || goal === 'delivery' || /e-?commerce|boutique|produit|vendre/i.test(productHint || '')) {
    const label =
      goal === 'delivery' ? 'Commandes / livraisons' : goal === 'payment' ? 'Paiements' : 'Conversions vente';
    return {
      title: goal === 'delivery' ? 'E-commerce · livraison' : 'Vente / e-commerce',
      subtitle: 'Focus : intérêt, conversion et suivi commandes',
      funnelLabels: ['Cibles', 'Atteints', 'Réponses', 'Achats'],
      cards: [
        { key: 'reached', label: isOutbound ? 'Atteints' : 'Messages', value: isOutbound ? metrics.reached : handled },
        { key: 'answered', label: 'Réponses', value: isOutbound ? metrics.answered : handled },
        {
          key: 'interested',
          label: 'Intéressés',
          value: metrics.interested,
          accent: 'success',
        },
        {
          key: 'conversions',
          label,
          value: conversions,
          accent: 'success',
          hint: metrics.answered
            ? `${pct(conversions, metrics.answered || handled || 1)}% des réponses`
            : undefined,
        },
      ],
    };
  }

  if (goal === 'link') {
    return {
      title: 'Objectif lien',
      subtitle: 'Focus : clics / ouvertures du lien envoyé',
      funnelLabels: ['Cibles', 'Atteints', 'Réponses', 'Liens'],
      cards: [
        { key: 'reached', label: 'Atteints', value: metrics.reached },
        { key: 'answered', label: 'Réponses', value: metrics.answered },
        {
          key: 'rate',
          label: 'Taux de réponse',
          value: metrics.rate != null ? `${metrics.rate}%` : '—',
        },
        {
          key: 'conversions',
          label: 'Liens / actions',
          value: conversions || metrics.interested,
          accent: 'success',
        },
      ],
    };
  }

  if (isInbound || type === 'custom_followup') {
    return {
      title: isInbound ? 'Support / closing entrant' : 'Suivi personnalisé',
      subtitle: 'Focus : messages traités et conversions',
      funnelLabels: ['Messages', 'Engagés', 'Intéressés', 'Conversions'],
      cards: [
        { key: 'handled', label: 'Messages traités', value: handled },
        {
          key: 'conversions',
          label: 'Conversions',
          value: conversions,
          accent: 'success',
          hint: handled ? `${pct(conversions, handled)}%` : undefined,
        },
        {
          key: 'interested',
          label: 'Intéressés',
          value: metrics.interested,
        },
        {
          key: 'stopped',
          label: 'Arrêtés',
          value: metrics.stopped,
          accent: 'warn',
        },
      ],
    };
  }

  // Prospection générique
  return {
    title: 'Prospection',
    subtitle: 'Focus : atteinte, réponses et intérêt',
    funnelLabels: ['Cibles', 'Atteints', 'Réponses', 'Intéressés'],
    cards: [
      { key: 'reached', label: 'Atteints', value: metrics.reached },
      { key: 'answered', label: 'Réponses', value: metrics.answered },
      {
        key: 'rate',
        label: 'Taux de réponse',
        value: metrics.rate != null ? `${metrics.rate}%` : '—',
      },
      {
        key: 'interested',
        label: 'Intéressés',
        value: metrics.interested,
        accent: 'success',
      },
    ],
  };
}

