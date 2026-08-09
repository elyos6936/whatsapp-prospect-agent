import type { ComponentType, SVGProps } from 'react';
import {
  CalendlyLogo,
  GoogleContactsLogo,
  GoogleSheetsLogo,
  TallyLogo,
  TypeformLogo,
  WhatsAppLogo,
} from '@/components/brand/IntegrationLogos';
import {
  INTEGRATIONS_MARKETING_DATA,
  integrationPath,
  getIntegrationDataBySlug,
  type IntegrationSlug,
  type IntegrationMarketingData,
} from './integrations-marketing-data';

export type { IntegrationSlug };

const LOGOS: Record<
  IntegrationSlug,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  whatsapp: WhatsAppLogo,
  'google-contacts': GoogleContactsLogo,
  typeform: TypeformLogo,
  calendly: CalendlyLogo,
  tally: TallyLogo,
  'google-sheets': GoogleSheetsLogo,
};

export type IntegrationMarketing = IntegrationMarketingData & {
  Logo: ComponentType<SVGProps<SVGSVGElement>>;
};

export const INTEGRATIONS_MARKETING: IntegrationMarketing[] =
  INTEGRATIONS_MARKETING_DATA.map((item) => ({
    ...item,
    Logo: LOGOS[item.slug],
  }));

export function getIntegrationBySlug(slug: string): IntegrationMarketing | null {
  const data = getIntegrationDataBySlug(slug);
  if (!data) return null;
  return { ...data, Logo: LOGOS[data.slug] };
}

export { integrationPath };
