import type OpenAI from "openai";
import {
  buildCampaignDraft,
  createWhatsAppCampaign,
  getAdsInsights,
  getMetaAdsCredentials,
  listCampaigns,
  setCampaignStatus,
  testMetaAdsConnection,
  type InsightsPreset,
} from "./meta-ads.js";

export const ADS_TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "check_meta_connection",
      description: "Vérifie la connexion Meta Ads (token, compte pub, page).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_campaigns",
      description: "Liste les campagnes publicitaires du compte Meta.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Nombre max (défaut 25)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_whatsapp_campaign",
      description:
        "Prépare un brouillon de campagne Click-to-WhatsApp SANS créer sur Meta. À utiliser avant create_whatsapp_campaign.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nom de la campagne" },
          daily_budget: {
            type: "number",
            description: "Budget journalier en unité majeurs de la devise du compte (ex. 10 = 10 USD)",
          },
          countries: {
            type: "array",
            items: { type: "string" },
            description: "Codes pays ISO (ex. BJ, SN, CI)",
          },
          primary_text: {
            type: "string",
            description: "Texte principal de la publicité",
          },
          message_template: {
            type: "string",
            description: "Message d'ouverture WhatsApp optionnel",
          },
          age_min: { type: "number" },
          age_max: { type: "number" },
        },
        required: ["name", "daily_budget", "primary_text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_whatsapp_campaign",
      description:
        "Crée une vraie campagne Click-to-WhatsApp (campagne + ad set + ad) en statut PAUSED. Utiliser après validation du brouillon.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          daily_budget: { type: "number" },
          countries: { type: "array", items: { type: "string" } },
          primary_text: { type: "string" },
          message_template: { type: "string" },
          age_min: { type: "number" },
          age_max: { type: "number" },
        },
        required: ["name", "daily_budget", "primary_text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_campaign_status",
      description: "Active (ACTIVE) ou met en pause (PAUSED) une campagne Meta par son ID.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "ID campagne Meta" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
        },
        required: ["campaign_id", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ads_report",
      description:
        "Rapport Meta Ads : dépenses, impressions, clics, conversations messagerie. Période today / last_7d / last_30d.",
      parameters: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: ["today", "last_7d", "last_30d"],
            description: "Période (défaut today)",
          },
        },
        additionalProperties: false,
      },
    },
  },
];

function nowFr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function parseCountries(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
}

export async function executeAdsTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!getMetaAdsCredentials() && name !== "check_meta_connection") {
    return JSON.stringify({
      error:
        "Meta Ads non configuré. Demandez d'ouvrir Connexions → onglet Meta Ads (token, Ad Account, Page, numéro WhatsApp).",
    });
  }

  switch (name) {
    case "check_meta_connection": {
      const result = await testMetaAdsConnection();
      return JSON.stringify({ ...result, checkedAt: nowFr() });
    }

    case "list_campaigns": {
      const campaigns = await listCampaigns(Math.min(Number(args.limit) || 25, 50));
      return JSON.stringify({
        count: campaigns.length,
        campaigns: campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          effectiveStatus: c.effective_status,
          objective: c.objective,
          created: c.created_time,
        })),
        listedAt: nowFr(),
      });
    }

    case "draft_whatsapp_campaign": {
      try {
        const draft = buildCampaignDraft({
          name: args.name ? String(args.name) : undefined,
          dailyBudgetMajor: args.daily_budget !== undefined ? Number(args.daily_budget) : undefined,
          countries: parseCountries(args.countries),
          primaryText: args.primary_text ? String(args.primary_text) : undefined,
          messageTemplate: args.message_template ? String(args.message_template) : undefined,
          ageMin: args.age_min !== undefined ? Number(args.age_min) : undefined,
          ageMax: args.age_max !== undefined ? Number(args.age_max) : undefined,
        });
        return JSON.stringify({
          success: true,
          draft,
          message: `Brouillon prêt à ${nowFr()}. Affiche-le à l'utilisateur et attends confirmation avant create_whatsapp_campaign.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "create_whatsapp_campaign": {
      try {
        const result = await createWhatsAppCampaign({
          name: String(args.name ?? ""),
          dailyBudgetMajor: Number(args.daily_budget),
          countries: parseCountries(args.countries) || ["BJ"],
          primaryText: String(args.primary_text ?? ""),
          messageTemplate: args.message_template ? String(args.message_template) : undefined,
          ageMin: args.age_min !== undefined ? Number(args.age_min) : undefined,
          ageMax: args.age_max !== undefined ? Number(args.age_max) : undefined,
        });
        return JSON.stringify({
          success: true,
          ...result,
          createdAt: nowFr(),
          message: `Campagne créée en PAUSED à ${nowFr()}. Demande confirmation avant set_campaign_status ACTIVE.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "set_campaign_status": {
      const campaignId = String(args.campaign_id ?? "");
      const status = String(args.status ?? "").toUpperCase();
      if (status !== "ACTIVE" && status !== "PAUSED") {
        return JSON.stringify({ error: "status doit être ACTIVE ou PAUSED." });
      }
      try {
        const result = await setCampaignStatus(campaignId, status as "ACTIVE" | "PAUSED");
        return JSON.stringify({
          success: true,
          ...result,
          updatedAt: nowFr(),
          message:
            status === "ACTIVE"
              ? `Campagne ${campaignId} ACTIVÉE à ${nowFr()}.`
              : `Campagne ${campaignId} mise en PAUSE à ${nowFr()}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "get_ads_report": {
      const presetRaw = String(args.preset || "today") as InsightsPreset;
      const preset: InsightsPreset =
        presetRaw === "last_7d" || presetRaw === "last_30d" ? presetRaw : "today";
      try {
        const report = await getAdsInsights(preset);
        return JSON.stringify({
          ...report,
          fetchedAt: nowFr(),
          summary: `Période ${preset} : dépense ${report.spend}${report.currency ? ` ${report.currency}` : ""}, ${report.impressions} impressions, ${report.clicks} clics, ${report.messages} conversations messagerie.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    default:
      return JSON.stringify({ error: `Outil ads inconnu : ${name}` });
  }
}
