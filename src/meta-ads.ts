import { getAppSettings } from "./db.js";
import { config } from "./config.js";

export interface MetaAdsCredentials {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  whatsappNumber: string;
}

export class MetaAdsError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "MetaAdsError";
  }
}

export function getMetaAdsCredentials(): MetaAdsCredentials | null {
  const s = getAppSettings();
  if (!s.meta_access_token || !s.meta_ad_account_id || !s.meta_page_id) return null;
  let adAccountId = s.meta_ad_account_id.trim();
  if (!adAccountId.startsWith("act_")) adAccountId = `act_${adAccountId}`;
  return {
    accessToken: s.meta_access_token,
    adAccountId,
    pageId: s.meta_page_id.trim(),
    whatsappNumber: s.meta_whatsapp_number.trim(),
  };
}

function graphBase(): string {
  return `https://graph.facebook.com/${config.metaGraphVersion}`;
}

async function metaFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    accessToken?: string;
  } = {}
): Promise<T> {
  const creds = getMetaAdsCredentials();
  const token = options.accessToken || creds?.accessToken;
  if (!token) throw new MetaAdsError("Meta Ads non configuré (token manquant).");

  const url = new URL(`${graphBase()}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("access_token", token);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    let body: string | undefined;
    let headers: Record<string, string> | undefined;
    if (options.body) {
      // Marketing API accepte mieux du form-urlencoded avec objets JSON sérialisés
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(options.body)) {
        if (value === undefined || value === null) continue;
        form.set(
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value)
        );
      }
      body = form.toString();
      headers = { "Content-Type": "application/x-www-form-urlencoded" };
    }

    const res = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new MetaAdsError(`Réponse Meta invalide (${path})`, res.status);
    }

    if (
      typeof data === "object" &&
      data &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "object"
    ) {
      const err = (data as { error: { message?: string; error_user_msg?: string; code?: number } })
        .error;
      throw new MetaAdsError(
        err.error_user_msg || err.message || "Erreur Meta Marketing API",
        res.status
      );
    }

    if (!res.ok) {
      throw new MetaAdsError(`Meta API ${path} : HTTP ${res.status}`, res.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof MetaAdsError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new MetaAdsError("Meta API : délai d'attente dépassé (45 s)");
    }
    throw new MetaAdsError(
      `Meta API indisponible : ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function testMetaAdsConnection(): Promise<{
  connected: boolean;
  message: string;
  userName?: string;
  adAccountName?: string;
  currency?: string;
  pageName?: string;
}> {
  const creds = getMetaAdsCredentials();
  if (!creds) {
    return {
      connected: false,
      message:
        "Identifiants Meta incomplets. Renseignez token, Ad Account ID et Page ID dans Connexions.",
    };
  }

  try {
    const me = await metaFetch<{ id: string; name?: string }>("/me", {
      query: { fields: "id,name" },
    });

    const account = await metaFetch<{
      id: string;
      name?: string;
      account_status?: number;
      currency?: string;
    }>(`/${creds.adAccountId}`, {
      query: { fields: "id,name,account_status,currency" },
    });

    const page = await metaFetch<{ id: string; name?: string }>(`/${creds.pageId}`, {
      query: { fields: "id,name" },
    });

    const statusOk = account.account_status === undefined || account.account_status === 1;

    return {
      connected: statusOk,
      message: statusOk
        ? `Meta Ads prêt — compte « ${account.name || account.id} », page « ${page.name || page.id} ».`
        : `Compte pub ${account.name || account.id} trouvé mais statut non actif (${account.account_status}).`,
      userName: me.name,
      adAccountName: account.name,
      currency: account.currency,
      pageName: page.name,
    };
  } catch (err) {
    return {
      connected: false,
      message: err instanceof Error ? err.message : "Impossible de joindre Meta.",
    };
  }
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  created_time?: string;
}

export async function listCampaigns(limit = 25): Promise<MetaCampaign[]> {
  const creds = getMetaAdsCredentials();
  if (!creds) throw new MetaAdsError("Meta Ads non configuré.");

  const data = await metaFetch<{ data?: MetaCampaign[] }>(`/${creds.adAccountId}/campaigns`, {
    query: {
      fields: "id,name,status,effective_status,objective,created_time",
      limit: String(Math.min(Math.max(limit, 1), 50)),
    },
  });

  return data.data ?? [];
}

export async function setCampaignStatus(
  campaignId: string,
  status: "ACTIVE" | "PAUSED"
): Promise<{ id: string; status: string }> {
  const trimmed = campaignId.trim();
  if (!trimmed) throw new MetaAdsError("ID de campagne requis.");

  await metaFetch(`/${trimmed}`, {
    method: "POST",
    body: { status },
  });

  return { id: trimmed, status };
}

/** Budget journalier en unité mineure (centimes) pour Meta. Ex. 5 USD → 500. */
export function dailyBudgetToMinorUnits(amountMajor: number): number {
  const n = Number(amountMajor);
  if (!Number.isFinite(n) || n <= 0) {
    throw new MetaAdsError("Budget journalier invalide (doit être > 0).");
  }
  return Math.round(n * 100);
}

export interface CreateWhatsAppCampaignInput {
  name: string;
  dailyBudgetMajor: number;
  countries: string[];
  primaryText: string;
  messageTemplate?: string;
  ageMin?: number;
  ageMax?: number;
}

export interface CreateWhatsAppCampaignResult {
  campaignId: string;
  adsetId: string;
  creativeId: string;
  adId: string;
  status: "PAUSED";
  name: string;
  dailyBudgetMajor: number;
  countries: string[];
}

/**
 * Crée campagne + ad set Click-to-WhatsApp + creative + ad, le tout en PAUSED.
 * Objective: OUTCOME_ENGAGEMENT + destination MESSENGER / WhatsApp selon doc Click-to-WA.
 */
export async function createWhatsAppCampaign(
  input: CreateWhatsAppCampaignInput
): Promise<CreateWhatsAppCampaignResult> {
  const creds = getMetaAdsCredentials();
  if (!creds) throw new MetaAdsError("Meta Ads non configuré.");
  if (!creds.whatsappNumber) {
    throw new MetaAdsError(
      "Numéro WhatsApp Business manquant. Renseignez-le dans Connexions → Meta Ads."
    );
  }

  const name = input.name.trim();
  const text = input.primaryText.trim();
  if (!name || !text) throw new MetaAdsError("Nom de campagne et texte publicitaire requis.");

  const countries = (input.countries.length ? input.countries : ["BJ"])
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (!countries.length) throw new MetaAdsError("Au moins un pays de ciblage est requis (ex. BJ).");

  const dailyBudget = dailyBudgetToMinorUnits(input.dailyBudgetMajor);
  const ageMin = Math.min(Math.max(input.ageMin ?? 18, 13), 65);
  const ageMax = Math.min(Math.max(input.ageMax ?? 65, ageMin), 65);

  const campaign = await metaFetch<{ id: string }>(`/${creds.adAccountId}/campaigns`, {
    method: "POST",
    body: {
      name,
      objective: "OUTCOME_ENGAGEMENT",
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    },
  });

  const adset = await metaFetch<{ id: string }>(`/${creds.adAccountId}/adsets`, {
    method: "POST",
    body: {
      name: `${name} — Ad set`,
      campaign_id: campaign.id,
      daily_budget: dailyBudget,
      billing_event: "IMPRESSIONS",
      optimization_goal: "CONVERSATIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WHATSAPP",
      promoted_object: {
        page_id: creds.pageId,
        whatsapp_phone_number: creds.whatsappNumber,
      },
      targeting: {
        geo_locations: { countries },
        age_min: ageMin,
        age_max: ageMax,
        publisher_platforms: ["facebook", "instagram"],
      },
      status: "PAUSED",
    },
  });

  const phoneDigits = creds.whatsappNumber.replace(/\D/g, "");
  const creative = await metaFetch<{ id: string }>(`/${creds.adAccountId}/adcreatives`, {
    method: "POST",
    body: {
      name: `${name} — Creative`,
      object_story_spec: {
        page_id: creds.pageId,
        link_data: {
          link: `https://api.whatsapp.com/send?phone=${phoneDigits}`,
          message: text.slice(0, 2000),
          name: name.slice(0, 40),
          description: (input.messageTemplate || text).slice(0, 200),
          call_to_action: {
            type: "WHATSAPP_MESSAGE",
            value: {
              link: `https://api.whatsapp.com/send?phone=${phoneDigits}`,
            },
          },
        },
      },
    },
  });

  const ad = await metaFetch<{ id: string }>(`/${creds.adAccountId}/ads`, {
    method: "POST",
    body: {
      name: `${name} — Ad`,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: "PAUSED",
    },
  });

  return {
    campaignId: campaign.id,
    adsetId: adset.id,
    creativeId: creative.id,
    adId: ad.id,
    status: "PAUSED",
    name,
    dailyBudgetMajor: input.dailyBudgetMajor,
    countries,
  };
}

export type InsightsPreset = "today" | "last_7d" | "last_30d";

function datePreset(preset: InsightsPreset): string {
  if (preset === "today") return "today";
  if (preset === "last_30d") return "last_30d";
  return "last_7d";
}

export interface AdsInsights {
  spend: number;
  impressions: number;
  clicks: number;
  messages: number;
  cpc: number | null;
  currency?: string;
  dateStart?: string;
  dateStop?: string;
  preset: InsightsPreset;
}

function parseActionMessages(actions?: Array<{ action_type: string; value: string }>): number {
  if (!actions?.length) return 0;
  const keys = [
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.total_messaging_connection",
    "messaging_conversation_started_7d",
    "conversations_started",
    "lead",
  ];
  let total = 0;
  for (const a of actions) {
    if (keys.some((k) => a.action_type.includes(k) || a.action_type === k)) {
      total += Number(a.value) || 0;
    }
  }
  // Si aucune clé connue, tenter messaging générique
  if (total === 0) {
    for (const a of actions) {
      if (/messag|conversation|whatsapp/i.test(a.action_type)) {
        total += Number(a.value) || 0;
      }
    }
  }
  return total;
}

export async function getAdsInsights(preset: InsightsPreset = "today"): Promise<AdsInsights> {
  const creds = getMetaAdsCredentials();
  if (!creds) throw new MetaAdsError("Meta Ads non configuré.");

  const data = await metaFetch<{
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      cpc?: string;
      actions?: Array<{ action_type: string; value: string }>;
      date_start?: string;
      date_stop?: string;
      account_currency?: string;
    }>;
  }>(`/${creds.adAccountId}/insights`, {
    query: {
      fields: "spend,impressions,clicks,cpc,actions,account_currency",
      date_preset: datePreset(preset),
      level: "account",
    },
  });

  const row = data.data?.[0];
  const spend = Number(row?.spend ?? 0);
  const clicks = Number(row?.clicks ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  const cpc = row?.cpc != null ? Number(row.cpc) : clicks > 0 ? spend / clicks : null;

  return {
    spend,
    impressions,
    clicks,
    messages: parseActionMessages(row?.actions),
    cpc: Number.isFinite(cpc as number) ? (cpc as number) : null,
    currency: row?.account_currency,
    dateStart: row?.date_start,
    dateStop: row?.date_stop,
    preset,
  };
}

export interface CampaignDraft {
  name: string;
  dailyBudgetMajor: number;
  countries: string[];
  primaryText: string;
  messageTemplate?: string;
  ageMin: number;
  ageMax: number;
  estimatedNote: string;
}

export function buildCampaignDraft(input: {
  name?: string;
  dailyBudgetMajor?: number;
  countries?: string[];
  primaryText?: string;
  messageTemplate?: string;
  ageMin?: number;
  ageMax?: number;
}): CampaignDraft {
  const name = (input.name || "Campagne WhatsApp").trim();
  const dailyBudgetMajor = Number(input.dailyBudgetMajor) || 10;
  const countries = (input.countries?.length ? input.countries : ["BJ"]).map((c) =>
    c.trim().toUpperCase()
  );
  const primaryText = (input.primaryText || "").trim();
  if (!primaryText) {
    throw new MetaAdsError("Le texte de la publicité (primary_text) est requis pour le brouillon.");
  }

  return {
    name,
    dailyBudgetMajor,
    countries,
    primaryText,
    messageTemplate: input.messageTemplate?.trim(),
    ageMin: input.ageMin ?? 18,
    ageMax: input.ageMax ?? 65,
    estimatedNote:
      "La campagne sera créée en PAUSED. Confirmez avec « ok » / « lance » pour passer en ACTIVE.",
  };
}
