import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  clearAgentConversation,
  clearAdsAgentConversation,
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
  getAppSettings,
  getAgentMessagesSince,
  getAdsAgentMessagesSince,
  getContactThread,
  getDailyBilan,
  getIncomingMessagesSince,
  getRecentAgentMessages,
  getRecentAdsAgentMessages,
  getWhatsAppMessagesSince,
  isAutoReplyEnabled,
  listContacts,
  maskSecret,
  saveAgentMessage,
  saveAdsAgentMessage,
  saveBusinessProfile,
  saveContact,
  saveGreenApiSettings,
  saveMetaAdsSettings,
  saveOpenAiKey,
  setAutoReplyEnabled,
  CONTACT_STATUSES,
  type ContactStatus,
} from "./db.js";
import { chatWithAgent } from "./agent.js";
import { chatWithAdsAgent } from "./ads-agent.js";
import { chatIdToDisplay, testGreenApiConnection } from "./greenapi.js";
import {
  getAdsInsights,
  listCampaigns,
  setCampaignStatus,
  testMetaAdsConnection,
  type InsightsPreset,
} from "./meta-ads.js";
import { startNotificationPoller } from "./notifications.js";
import { startScheduler } from "./scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/",
  index: ["index.html"],
});

app.get("/", async (_request, reply) => {
  return reply.sendFile("index.html");
});

app.get("/api/health", async () => {
  const settings = getAppSettings();
  const hasOpenAi = Boolean(settings.openai_api_key);
  let whatsapp = { connected: false, state: "not_configured", message: "Non configuré" };
  let metaAds = { connected: false, message: "Non configuré" };

  if (settings.green_api_id_instance && settings.green_api_token) {
    try {
      whatsapp = await testGreenApiConnection();
    } catch (err) {
      whatsapp = {
        connected: false,
        state: "error",
        message: err instanceof Error ? err.message : "Erreur Green-API",
      };
    }
  }

  if (settings.meta_access_token && settings.meta_ad_account_id && settings.meta_page_id) {
    try {
      metaAds = await testMetaAdsConnection();
    } catch (err) {
      metaAds = {
        connected: false,
        message: err instanceof Error ? err.message : "Erreur Meta Ads",
      };
    }
  }

  return {
    ok: true,
    model: config.openaiModel,
    openai: { configured: hasOpenAi },
    whatsapp,
    metaAds,
    autoReply: isAutoReplyEnabled(),
    outbound: {
      today: countOutboundToday(),
      limit: DAILY_OUTBOUND_LIMIT,
    },
  };
});

app.get("/api/settings", async () => {
  const s = getAppSettings();
  return {
    openai: {
      configured: Boolean(s.openai_api_key),
      maskedKey: s.openai_api_key ? maskSecret(s.openai_api_key) : "",
    },
    greenApi: {
      configured: Boolean(s.green_api_id_instance && s.green_api_token),
      idInstance: s.green_api_id_instance,
      maskedToken: s.green_api_token ? maskSecret(s.green_api_token) : "",
      baseUrl: s.green_api_base_url || config.defaultGreenApiBaseUrl,
    },
    business: {
      ownerName: s.business_owner_name,
      offer: s.business_offer,
      price: s.business_price,
    },
    metaAds: {
      configured: Boolean(s.meta_access_token && s.meta_ad_account_id && s.meta_page_id),
      adAccountId: s.meta_ad_account_id,
      pageId: s.meta_page_id,
      whatsappNumber: s.meta_whatsapp_number,
      maskedToken: s.meta_access_token ? maskSecret(s.meta_access_token) : "",
    },
    autoReply: isAutoReplyEnabled(),
  };
});

app.post<{
  Body: { ownerName?: string; offer?: string; price?: string };
}>("/api/settings/business", async (request) => {
  saveBusinessProfile({
    ownerName: request.body?.ownerName,
    offer: request.body?.offer,
    price: request.body?.price,
  });
  const s = getAppSettings();
  return {
    ok: true,
    business: {
      ownerName: s.business_owner_name,
      offer: s.business_offer,
      price: s.business_price,
    },
  };
});

app.get("/api/reports/daily", async (request) => {
  const date = (request.query as { date?: string }).date;
  return getDailyBilan(date);
});

app.get("/api/contacts/:phone/thread", async (request, reply) => {
  const raw = decodeURIComponent((request.params as { phone: string }).phone || "");
  if (!raw.trim()) {
    return reply.status(400).send({ error: "Numéro requis." });
  }
  const limit = Math.min(Number((request.query as { limit?: string }).limit) || 100, 200);
  const messages = getContactThread(raw, limit);
  return {
    phone: raw,
    display: chatIdToDisplay(raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@c.us`),
    count: messages.length,
    messages,
  };
});

app.post<{ Body: { apiKey?: string } }>("/api/settings/openai", async (request, reply) => {
  const apiKey = request.body?.apiKey?.trim();
  if (!apiKey) {
    return reply.status(400).send({ error: "La clé API OpenAI est requise." });
  }
  if (!apiKey.startsWith("sk-")) {
    return reply.status(400).send({ error: "Format de clé OpenAI invalide (doit commencer par sk-)." });
  }

  saveOpenAiKey(apiKey);
  return { ok: true, message: "Clé OpenAI enregistrée." };
});

app.post<{
  Body: { idInstance?: string; apiToken?: string; baseUrl?: string };
}>("/api/settings/greenapi", async (request, reply) => {
  const idInstance = request.body?.idInstance?.trim();
  const apiToken = request.body?.apiToken?.trim();
  const baseUrl = request.body?.baseUrl?.trim() || config.defaultGreenApiBaseUrl;

  if (!idInstance || !apiToken) {
    return reply.status(400).send({ error: "Instance ID et Token Green-API sont requis." });
  }

  saveGreenApiSettings({ idInstance, apiToken, baseUrl });

  try {
    const result = await testGreenApiConnection();
    return {
      ok: result.connected,
      ...result,
    };
  } catch (err) {
    return reply.status(502).send({
      ok: false,
      error: err instanceof Error ? err.message : "Impossible de joindre Green-API",
    });
  }
});

app.post("/api/settings/greenapi/test", async (_request, reply) => {
  try {
    const result = await testGreenApiConnection();
    return result;
  } catch (err) {
    return reply.status(502).send({
      connected: false,
      state: "error",
      message: err instanceof Error ? err.message : "Erreur Green-API",
    });
  }
});

app.post<{
  Body: {
    accessToken?: string;
    adAccountId?: string;
    pageId?: string;
    whatsappNumber?: string;
  };
}>("/api/settings/meta", async (request, reply) => {
  const accessToken = request.body?.accessToken?.trim();
  const adAccountId = request.body?.adAccountId?.trim();
  const pageId = request.body?.pageId?.trim();
  const whatsappNumber = request.body?.whatsappNumber?.trim() || "";

  if (!accessToken || !adAccountId || !pageId) {
    return reply.status(400).send({
      error: "Token, Ad Account ID et Page ID Meta sont requis.",
    });
  }

  saveMetaAdsSettings({ accessToken, adAccountId, pageId, whatsappNumber });

  try {
    const result = await testMetaAdsConnection();
    return { ok: result.connected, ...result };
  } catch (err) {
    return reply.status(502).send({
      ok: false,
      error: err instanceof Error ? err.message : "Impossible de joindre Meta",
    });
  }
});

app.post("/api/settings/meta/test", async (_request, reply) => {
  try {
    return await testMetaAdsConnection();
  } catch (err) {
    return reply.status(502).send({
      connected: false,
      message: err instanceof Error ? err.message : "Erreur Meta Ads",
    });
  }
});

app.get("/api/ads/report", async (request, reply) => {
  const presetRaw = String((request.query as { preset?: string }).preset || "today");
  const preset: InsightsPreset =
    presetRaw === "last_7d" || presetRaw === "last_30d" ? presetRaw : "today";

  const settings = getAppSettings();
  if (!settings.meta_access_token || !settings.meta_ad_account_id || !settings.meta_page_id) {
    return {
      configured: false,
      report: {
        spend: 0,
        impressions: 0,
        clicks: 0,
        messages: 0,
        cpc: null,
        preset,
      },
      campaigns: [],
      message: "Meta Ads non configuré. Ouvrez Connexions → Meta Ads.",
    };
  }

  try {
    const report = await getAdsInsights(preset);
    let campaigns: Awaited<ReturnType<typeof listCampaigns>> = [];
    try {
      campaigns = await listCampaigns(20);
    } catch {
      campaigns = [];
    }
    return { configured: true, report, campaigns };
  } catch (err) {
    return reply.status(502).send({
      configured: true,
      error: err instanceof Error ? err.message : "Impossible de charger le rapport Meta",
    });
  }
});

app.get("/api/ads/campaigns", async (_request, reply) => {
  try {
    const campaigns = await listCampaigns(30);
    return { count: campaigns.length, campaigns };
  } catch (err) {
    return reply.status(502).send({
      error: err instanceof Error ? err.message : "Impossible de lister les campagnes",
    });
  }
});

app.post<{
  Body: { campaignId?: string; status?: string };
}>("/api/ads/campaigns/status", async (request, reply) => {
  const campaignId = request.body?.campaignId?.trim();
  const status = String(request.body?.status || "").toUpperCase();
  if (!campaignId) {
    return reply.status(400).send({ error: "campaignId requis." });
  }
  if (status !== "ACTIVE" && status !== "PAUSED") {
    return reply.status(400).send({ error: "status doit être ACTIVE ou PAUSED." });
  }
  try {
    const result = await setCampaignStatus(campaignId, status as "ACTIVE" | "PAUSED");
    return { ok: true, ...result };
  } catch (err) {
    return reply.status(502).send({
      error: err instanceof Error ? err.message : "Échec changement de statut",
    });
  }
});

app.get("/api/ads/history", async () => ({
  messages: getRecentAdsAgentMessages(100),
}));

app.get("/api/ads/history/since", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: getAdsAgentMessagesSince(since) };
});

app.delete("/api/ads/history", async () => {
  clearAdsAgentConversation();
  return { ok: true };
});

app.post<{ Body: { message?: string } }>("/api/ads/chat", async (request, reply) => {
  const message = request.body?.message?.trim();
  if (!message) {
    return reply.status(400).send({ error: "Le champ « message » est requis." });
  }

  saveAdsAgentMessage("user", message);

  try {
    const assistantReply = await chatWithAdsAgent(message);
    const saved = saveAdsAgentMessage("assistant", assistantReply);
    return { id: saved.id, reply: saved.content, created_at: saved.created_at };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : "Erreur inconnue.";
    const saved = saveAdsAgentMessage("assistant", `❌ ${errorText}`);
    return {
      id: saved.id,
      reply: saved.content,
      created_at: saved.created_at,
      error: true,
    };
  }
});

app.get("/api/history", async () => ({
  messages: getRecentAgentMessages(100),
}));

app.get("/api/incoming", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: getIncomingMessagesSince(since) };
});

app.get("/api/whatsapp", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: getWhatsAppMessagesSince(since) };
});

app.get("/api/history/since", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: getAgentMessagesSince(since) };
});

app.post<{ Body: { enabled?: boolean } }>("/api/settings/auto-reply", async (request, reply) => {
  if (typeof request.body?.enabled !== "boolean") {
    return reply.status(400).send({ error: "Le champ « enabled » (boolean) est requis." });
  }
  setAutoReplyEnabled(request.body.enabled);
  return { ok: true, enabled: request.body.enabled };
});

app.get("/api/contacts", async (request) => {
  const statusRaw = (request.query as { status?: string }).status;
  const status =
    statusRaw && CONTACT_STATUSES.includes(statusRaw as ContactStatus)
      ? (statusRaw as ContactStatus)
      : undefined;
  const contacts = listContacts({ status, limit: 100 });
  return {
    contacts: contacts.map((c) => ({
      ...c,
      display: chatIdToDisplay(c.phone),
      auto_reply: c.auto_reply === 1,
    })),
  };
});

app.post<{
  Body: {
    phone?: string;
    name?: string;
    notes?: string;
    status?: string;
    autoReply?: boolean;
  };
}>("/api/contacts", async (request, reply) => {
  const phone = request.body?.phone?.trim();
  if (!phone) {
    return reply.status(400).send({ error: "Le champ « phone » est requis." });
  }
  const statusRaw = request.body?.status;
  if (statusRaw && !CONTACT_STATUSES.includes(statusRaw as ContactStatus)) {
    return reply.status(400).send({
      error: `Statut invalide. Attendu : ${CONTACT_STATUSES.join(", ")}`,
    });
  }
  try {
    const contact = saveContact({
      phone,
      name: request.body?.name,
      notes: request.body?.notes,
      status: statusRaw as ContactStatus | undefined,
      autoReply: request.body?.autoReply,
    });
    return {
      contact: {
        ...contact,
        display: chatIdToDisplay(contact.phone),
        auto_reply: contact.auto_reply === 1,
      },
    };
  } catch (err) {
    return reply.status(400).send({
      error: err instanceof Error ? err.message : "Erreur enregistrement contact",
    });
  }
});

app.delete("/api/history", async () => {
  clearAgentConversation();
  return { ok: true };
});

app.post<{ Body: { message?: string } }>("/api/chat", async (request, reply) => {
  const message = request.body?.message?.trim();
  if (!message) {
    return reply.status(400).send({ error: "Le champ « message » est requis." });
  }

  saveAgentMessage("user", message);

  try {
    const assistantReply = await chatWithAgent(message);
    const saved = saveAgentMessage("assistant", assistantReply);
    return { id: saved.id, reply: saved.content, created_at: saved.created_at };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : "Erreur inconnue.";
    const saved = saveAgentMessage("assistant", `❌ ${errorText}`);
    return {
      id: saved.id,
      reply: saved.content,
      created_at: saved.created_at,
      error: true,
    };
  }
});

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`\n🚀 WhatsApp Agent : http://localhost:${config.port}`);
  console.log(`   Ouvrez l'app → Connexions → configurez OpenAI + Green-API\n`);
  startNotificationPoller(3000);
  startScheduler(5000);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
