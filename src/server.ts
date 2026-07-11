import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  clearAgentConversation,
  cancelPendingSendQueue,
  countOutboundToday,
  getDailyOutboundLimit,
  getEffectiveOutboundLimit,
  getOutboundQuotaBonus,
  resetOutboundQuotaForToday,
  setDailyOutboundLimit,
  pauseAllActiveAutomations,
  getAppSettings,
  getAgentMessagesSince,
  getContactThread,
  getDailyBilan,
  getIncomingMessagesSince,
  getRecentAgentMessages,
  getWhatsAppMessagesSince,
  isAutoReplyEnabled,
  listContacts,
  maskSecret,
  saveAgentMessage,
  saveBusinessProfile,
  saveContact,
  saveEvolutionSettings,
  saveOpenAiKey,
  setAutoReplyEnabled,
  CONTACT_STATUSES,
  type ContactStatus,
} from "./db.js";
import { chatWithAgent } from "./agent.js";
import { chatIdToDisplay, diagnoseEvolutionApi, testEvolutionConnection, setEvolutionWebhook } from "./evolutionapi.js";
import { startNotificationPoller, getWhatsappPollHealth, handleEvolutionWebhook, reprocessPendingAutoReplies } from "./notifications.js";
import { startScheduler } from "./scheduler.js";
import { registerEvolutionRoutes } from "./evolution-routes.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { registerFeatureRoutes } from "./feature-routes.js";
import { startAutomationEngine } from "./automation-engine.js";
import { processSendQueue } from "./send-queue.js";
import { processDueSequences } from "./sequences.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

const corsOrigins = (process.env.CORS_ORIGINS || "https://klanvio.netlify.app,http://localhost:3000,http://localhost:8888")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

await app.register(fastifyCors, {
  origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? true : corsOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/",
  index: ["index.html"],
});

app.get("/", async (_request, reply) => {
  return reply.sendFile("index.html");
});

app.get("/api/health", async () => {
  const settings = await getAppSettings();
  const hasOpenAi = Boolean(settings.openai_api_key);
  let whatsapp = { connected: false, state: "not_configured", message: "Non configuré" };

  if (settings.evolution_api_key && settings.evolution_instance_name) {
    try {
      whatsapp = await testEvolutionConnection();
    } catch (err) {
      whatsapp = {
        connected: false,
        state: "error",
        message: err instanceof Error ? err.message : "Erreur Evolution API",
      };
    }
  }

  return {
    ok: true,
    model: config.openaiModel,
    openai: { configured: hasOpenAi },
    whatsapp,
    whatsappPoll: getWhatsappPollHealth(),
    autoReply: await isAutoReplyEnabled(),
    outbound: {
      today: await countOutboundToday(),
      limit: await getEffectiveOutboundLimit(),
      baseLimit: await getDailyOutboundLimit(),
      bonus: await getOutboundQuotaBonus(),
    },
  };
});

app.get("/api/settings", async () => {
  const s = await getAppSettings();
  return {
    openai: {
      configured: Boolean(s.openai_api_key),
      maskedKey: s.openai_api_key ? maskSecret(s.openai_api_key) : "",
    },
    evolution: {
      configured: Boolean(s.evolution_api_key && s.evolution_instance_name),
      instanceName: s.evolution_instance_name,
      maskedKey: s.evolution_api_key ? maskSecret(s.evolution_api_key) : "",
      baseUrl: s.evolution_api_base_url || config.defaultEvolutionBaseUrl,
    },
    business: {
      ownerName: s.business_owner_name,
      offer: s.business_offer,
      price: s.business_price,
    },
    autoReply: await isAutoReplyEnabled(),
  };
});

app.post<{
  Body: { ownerName?: string; offer?: string; price?: string };
}>("/api/settings/business", async (request) => {
  await saveBusinessProfile({
    ownerName: request.body?.ownerName,
    offer: request.body?.offer,
    price: request.body?.price,
  });
  const s = await getAppSettings();
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
  return await getDailyBilan(date);
});

app.get("/api/contacts/:phone/thread", async (request, reply) => {
  const raw = decodeURIComponent((request.params as { phone: string }).phone || "");
  if (!raw.trim()) {
    return reply.status(400).send({ error: "Numéro requis." });
  }
  const limit = Math.min(Number((request.query as { limit?: string }).limit) || 100, 200);
  const messages = await getContactThread(raw, limit);
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

  await saveOpenAiKey(apiKey);
  return { ok: true, message: "Clé OpenAI enregistrée." };
});

app.post<{
  Body: { baseUrl?: string; apiKey?: string; instanceName?: string; webhookUrl?: string };
}>("/api/settings/evolution", async (request, reply) => {
  const baseUrl = request.body?.baseUrl?.trim() || config.defaultEvolutionBaseUrl;
  const apiKey = request.body?.apiKey?.trim();
  const instanceName = request.body?.instanceName?.trim();

  if (!apiKey || !instanceName) {
    return reply.status(400).send({ error: "Clé API et nom d'instance Evolution sont requis." });
  }

  await saveEvolutionSettings({ baseUrl, apiKey, instanceName });

  try {
    const result = await testEvolutionConnection();
    if (request.body?.webhookUrl?.trim()) {
      await setEvolutionWebhook(request.body.webhookUrl.trim());
    }
    return { ok: result.connected, ...result };
  } catch (err) {
    return reply.status(502).send({
      ok: false,
      error: err instanceof Error ? err.message : "Impossible de joindre Evolution API",
    });
  }
});

app.post("/api/settings/evolution/test", async (_request, reply) => {
  try {
    return await testEvolutionConnection();
  } catch (err) {
    return reply.status(502).send({
      connected: false,
      state: "error",
      message: err instanceof Error ? err.message : "Erreur Evolution API",
    });
  }
});

app.get("/api/evolution/diagnose", async (_request, reply) => {
  try {
    return await diagnoseEvolutionApi();
  } catch (err) {
    return reply.status(502).send({
      error: err instanceof Error ? err.message : "Diagnostic Evolution impossible",
    });
  }
});

app.get("/api/evolution/webhook-info", async (request) => {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const proto = request.headers["x-forwarded-proto"] || "http";
  const base = host ? `${proto}://${host}` : null;
  return {
    endpoint: "/api/evolution/webhook",
    localUrl: base ? `${base}/api/evolution/webhook` : null,
    hint:
      "En local, lancez « npm run tunnel » puis utilisez https://VOTRE-TUNNEL.trycloudflare.com/api/evolution/webhook dans Connexions → Evolution API.",
    events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
  };
});

app.post("/api/evolution/webhook", async (request) => {
  const processed = await handleEvolutionWebhook(request.body);
  return { ok: true, processed };
});

app.get("/api/history", async () => ({
  messages: await getRecentAgentMessages(100),
}));

app.get("/api/incoming", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: await getIncomingMessagesSince(since) };
});

app.get("/api/whatsapp", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  const limit = since === 0 ? 500 : 100;
  return { messages: await getWhatsAppMessagesSince(since, limit) };
});

app.get("/api/history/since", async (request) => {
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: await getAgentMessagesSince(since) };
});

app.post<{ Body: { enabled?: boolean } }>("/api/settings/auto-reply", async (request, reply) => {
  if (typeof request.body?.enabled !== "boolean") {
    return reply.status(400).send({ error: "Le champ « enabled » (boolean) est requis." });
  }
  await setAutoReplyEnabled(request.body.enabled);
  return { ok: true, enabled: request.body.enabled };
});

app.post<{
  Body: { action?: "reset" | "setLimit"; extra?: number; limit?: number };
}>("/api/settings/outbound-quota", async (request, reply) => {
  const action = request.body?.action;
  if (action === "reset") {
    const extra = Number(request.body?.extra ?? 15);
    const result = await resetOutboundQuotaForToday(Number.isFinite(extra) ? extra : 15);
    return {
      ok: true,
      action: "reset",
      outbound: {
        today: result.sent,
        baseLimit: result.limit,
        bonus: result.bonus,
        limit: result.effectiveLimit,
      },
      message: `Quota débloqué : ${result.sent}/${result.effectiveLimit} messages aujourd'hui.`,
    };
  }
  if (action === "setLimit") {
    const limit = Number(request.body?.limit);
    if (!Number.isFinite(limit) || limit < 5) {
      return reply.status(400).send({ error: "Le champ « limit » (nombre ≥ 5) est requis." });
    }
    const saved = await setDailyOutboundLimit(limit);
    return {
      ok: true,
      action: "setLimit",
      outbound: {
        today: await countOutboundToday(),
        baseLimit: saved,
        bonus: await getOutboundQuotaBonus(),
        limit: await getEffectiveOutboundLimit(),
      },
      message: `Limite journalière fixée à ${saved} messages.`,
    };
  }
  return reply.status(400).send({
    error: "Le champ « action » doit valoir « reset » ou « setLimit ».",
  });
});

app.post("/api/settings/reprocess-auto-replies", async () => {
  const queued = await reprocessPendingAutoReplies();
  return { ok: true, queued, message: `${queued} réponse(s) auto remise(s) en file.` };
});

/** Arrêt d'urgence : annule la file d'envoi et met en pause les automatisations actives. */
app.post("/api/emergency/stop-sending", async () => {
  const cancelledQueue = await cancelPendingSendQueue();
  const pausedAutomations = await pauseAllActiveAutomations();
  await setAutoReplyEnabled(false);
  return {
    ok: true,
    cancelledQueue,
    pausedAutomations,
    autoReplyEnabled: false,
    message: `${cancelledQueue} envoi(s) en attente annulé(s), ${pausedAutomations} automatisation(s) en pause, réponses auto désactivées.`,
  };
});

app.get("/api/contacts", async (request) => {
  const statusRaw = (request.query as { status?: string }).status;
  const status =
    statusRaw && CONTACT_STATUSES.includes(statusRaw as ContactStatus)
      ? (statusRaw as ContactStatus)
      : undefined;
  const contacts = await listContacts({ status, limit: 100 });
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
    const contact = await saveContact({
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
  await clearAgentConversation();
  return { ok: true };
});

app.post<{ Body: { message?: string } }>("/api/chat", async (request, reply) => {
  const message = request.body?.message?.trim();
  if (!message) {
    return reply.status(400).send({ error: "Le champ « message » est requis." });
  }

  await saveAgentMessage("user", message);

  try {
    const assistantReply = await chatWithAgent(message);
    const saved = await saveAgentMessage("assistant", assistantReply);
    return { id: saved.id, reply: saved.content, created_at: saved.created_at };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : "Erreur inconnue.";
    const saved = await saveAgentMessage("assistant", `❌ ${errorText}`);
    return {
      id: saved.id,
      reply: saved.content,
      created_at: saved.created_at,
      error: true,
    };
  }
});

await registerEvolutionRoutes(app);
await registerAutomationRoutes(app);
await registerFeatureRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`\n🚀 WhatsApp Agent : http://localhost:${config.port}`);
  console.log(`   Ouvrez l'app → Connexions → configurez OpenAI + Evolution API\n`);
  startNotificationPoller(3000);
  startScheduler(5000);
  startAutomationEngine(15000);
  setInterval(() => {
    void processSendQueue(2);
    void processDueSequences();
  }, 8000);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
