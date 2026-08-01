export const TARGET_META: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente', color: '#94a3b8' },
  queued: { label: 'En cours d\'envoi', color: '#64748b' },
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

/** Métriques réelles : « contacté » DB = encore sans réponse ; « atteints » = tous ceux touchés.
 * « Réponses » inclut les arrêtés : à l’objectif / refus on passe en `stopped`, ce qui écrase
 * `replied`/`interested` — sans ça on affichait 0 réponse avec 1 conversion. */
export function outreachMetrics(stats?: Record<string, number | string | undefined> | null) {
  const pending = Number(stats?.pending ?? 0);
  const waitingReply = Number(stats?.contacted ?? 0);
  const replied = Number(stats?.replied ?? 0);
  const interested = Number(stats?.interested ?? 0);
  const stopped = Number(stats?.stopped ?? 0);
  const errors = Number(stats?.errors ?? 0);
  const reached = waitingReply + replied + interested + stopped;
  const answered = replied + interested + stopped;
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

export type PeriodAnalyticsSummary = {
  discussing?: number;
  discussingLifetime?: number;
  inboundMessages?: number;
  outboundMessages?: number;
  newlyReached?: number;
  newlyAnswered?: number;
  newlyInterested?: number;
};

/** KPIs adaptés au type / objectif de campagne (e-commerce, RDV, support…). */
export function goalAwareStatCards(input: {
  type: string;
  closingGoal?: string | null;
  productName?: string | null;
  stats?: Record<string, number | string | undefined> | null;
  /** Stats filtrées par période (prioritaires sur messagesHandled pour l'inbound). */
  period?: PeriodAnalyticsSummary | null;
  /** true si un filtre de date est actif (pas « tout »). */
  periodFiltered?: boolean;
}): { title: string; subtitle: string; cards: StatCard[]; funnelLabels: [string, string, string, string] } {
  const metrics = outreachMetrics(input.stats);
  const handled = Number(input.stats?.messagesHandled ?? 0);
  const conversions = Number(input.stats?.conversions ?? 0);
  const goal = (input.closingGoal || '').toLowerCase();
  const type = input.type;
  const isOutbound = type === 'group_prospect' || type === 'contact_prospect';
  const isInbound = type === 'keyword_sales';
  const isGroupBroadcast = type === 'group_broadcast';
  const productHint = input.productName?.trim();
  const discussing =
    input.periodFiltered && input.period?.discussing != null
      ? Number(input.period.discussing)
      : Number(
          input.period?.discussingLifetime ??
            input.stats?.discussing ??
            input.period?.discussing ??
            0,
        );
  const inboundMsgs = Number(input.period?.inboundMessages ?? handled);
  const periodHint =
    input.periodFiltered && input.period ? 'sur la période' : undefined;
  const periodOr = <T,>(periodValue: T | null | undefined, lifetime: T): T =>
    input.periodFiltered ? ((periodValue ?? 0) as T) : lifetime;

  if (isGroupBroadcast) {
    const total = Number(input.stats?.targetsTotal ?? 0);
    const sent =
      Number(input.stats?.messagesSent ?? 0) ||
      metrics.reached ||
      Number(input.stats?.outboundUsed ?? 0);
    const remaining = Math.max(0, metrics.pending);
    return {
      title: 'Diffusion groupes WhatsApp',
      subtitle: 'Messages publiés dans les groupes (admin) — envoyés vs restants',
      funnelLabels: ['Groupes', 'Envoyés', 'Restants', 'Erreurs'],
      cards: [
        {
          key: 'total',
          label: 'Groupes ciblés',
          value: total || sent + remaining,
        },
        {
          key: 'sent',
          label: 'Messages envoyés',
          value: sent,
          accent: 'success',
          hint: periodHint,
        },
        {
          key: 'remaining',
          label: 'Messages restants',
          value: remaining,
          accent: remaining > 0 ? 'warn' : 'default',
          hint: 'Groupes encore en file',
        },
        {
          key: 'errors',
          label: 'Erreurs',
          value: metrics.errors,
          accent: metrics.errors > 0 ? 'warn' : 'default',
        },
      ],
    };
  }

  if (goal === 'appointment' || /\brdv|rendez/.test(productHint || '')) {
    return {
      title: 'Prise de rendez-vous',
      subtitle: 'Focus : conversations engagées et RDV confirmés',
      funnelLabels: ['Cibles', 'Atteints', 'Réponses', 'RDV'],
      cards: [
        {
          key: 'reached',
          label: 'Atteints',
          value: periodOr(input.period?.newlyReached, metrics.reached),
          hint: periodHint,
        },
        {
          key: 'answered',
          label: 'Réponses',
          value: periodOr(input.period?.newlyAnswered, metrics.answered),
          hint: periodHint,
        },
        {
          key: 'rate',
          label: 'Taux de réponse',
          value: metrics.rate != null ? `${metrics.rate}%` : '—',
          hint: input.periodFiltered ? 'taux lifetime' : undefined,
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
      cards: isOutbound
        ? [
            {
              key: 'reached',
              label: 'Atteints',
              value: periodOr(input.period?.newlyReached, metrics.reached),
              hint: periodHint,
            },
            {
              key: 'answered',
              label: 'Réponses',
              value: periodOr(input.period?.newlyAnswered, metrics.answered),
              hint: periodHint,
            },
            {
              key: 'interested',
              label: 'Intéressés',
              value: periodOr(input.period?.newlyInterested, metrics.interested),
              accent: 'success',
              hint: periodHint,
            },
            {
              key: 'conversions',
              label,
              value: conversions,
              accent: 'success',
            },
          ]
        : [
            {
              key: 'discussing',
              label: 'Personnes en discussion',
              value: discussing,
              hint: inboundMsgs
                ? `${inboundMsgs} message(s) reçu(s)${periodHint ? ` ${periodHint}` : ''}`
                : periodHint,
            },
            {
              key: 'inbound',
              label: 'Messages reçus',
              value: inboundMsgs,
              hint: 'événements, pas de personnes',
            },
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
        {
          key: 'reached',
          label: 'Atteints',
          value: periodOr(input.period?.newlyReached, metrics.reached),
          hint: periodHint,
        },
        {
          key: 'answered',
          label: 'Réponses',
          value: periodOr(input.period?.newlyAnswered, metrics.answered),
          hint: periodHint,
        },
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
      subtitle: 'Focus : personnes qui vous ont écrit et conversions',
      funnelLabels: ['Personnes', 'Messages', 'Intéressés', 'Conversions'],
      cards: [
        {
          key: 'discussing',
          label: 'Personnes en discussion',
          value: discussing,
          hint: inboundMsgs
            ? `${inboundMsgs} message(s) reçu(s)${periodHint ? ` · ${periodHint}` : ''}`
            : periodHint || 'contacts distincts ayant écrit',
        },
        {
          key: 'inbound',
          label: 'Messages reçus',
          value: inboundMsgs,
          hint: 'chaque message compte 1 — pas les personnes',
        },
        {
          key: 'conversions',
          label: 'Conversions',
          value: conversions,
          accent: 'success',
          hint: discussing > 0 ? `${pct(conversions, discussing)}% des personnes` : undefined,
        },
        {
          key: 'interested',
          label: 'Intéressés',
          value: periodOr(input.period?.newlyInterested, metrics.interested),
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
      {
        key: 'reached',
        label: 'Atteints',
        value: periodOr(input.period?.newlyReached, metrics.reached),
        hint: periodHint,
      },
      {
        key: 'answered',
        label: 'Réponses',
        value: periodOr(input.period?.newlyAnswered, metrics.answered),
        hint: periodHint,
      },
      {
        key: 'rate',
        label: 'Taux de réponse',
        value: metrics.rate != null ? `${metrics.rate}%` : '—',
        hint: input.periodFiltered ? 'taux lifetime' : undefined,
      },
      {
        key: 'interested',
        label: 'Intéressés',
        value: periodOr(input.period?.newlyInterested, metrics.interested),
        accent: 'success',
        hint: periodHint,
      },
    ],
  };
}

