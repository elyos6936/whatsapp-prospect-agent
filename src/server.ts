import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  clearAgentConversation,
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
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
  saveGreenApiSettings,
  saveOpenAiKey,
  setAutoReplyEnabled,
  CONTACT_STATUSES,
  type ContactStatus,
} from "./db.js";
import { chatWithAgent } from "./agent.js";
import { chatIdToDisplay, diagnoseEvolutionApi, testGreenApiConnection, setEvolutionWebhook } from "./evolutionapi.js";
import { startNotificationPoller, getWhatsappPollHealth, handleEvolutionWebhook } from "./notifications.js";
import { startScheduler } from "./scheduler.js";
import { registerGreenApiRoutes } from "./greenapi-routes.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { registerFeatureRoutes } from "./feature-routes.js";
import { startAutomationEngine } from "./automation-engine.js";
import { processSendQueue } from "./send-queue.js";
import { processDueSequences } from "./sequences.js";

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

  if (settings.evolution_api_key && settings.evolution_instance_name) {
    try {
      whatsapp = await testGreenApiConnection();
    } catch (err) {
      whatsapp = {
        connected: false,
        state: "error",
        message: err instanceof Error ? err.message : "Erreur Evolution API",
      };
    }
  } else if (settings.green_api_id_instance && settings.green_api_token) {
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

  return {
    ok: true,
    model: config.openaiModel,
    openai: { configured: hasOpenAi },
    whatsapp,
    whatsappPoll: getWhatsappPollHealth(),
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
    evolution: {
      configured: Boolean(s.evolution_api_key && s.evolution_instance_name),
      instanceName: s.evolution_instance_name,
      maskedKey: s.evolution_api_key ? maskSecret(s.evolution_api_key) : "",
      baseUrl: s.evolution_api_base_url || config.defaultEvolutionBaseUrl,
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
  Body: { baseUrl?: string; apiKey?: string; instanceName?: string; webhookUrl?: string };
}>("/api/settings/evolution", async (request, reply) => {
  const baseUrl = request.body?.baseUrl?.trim() || config.defaultEvolutionBaseUrl;
  const apiKey = request.body?.apiKey?.trim();
  const instanceName = request.body?.instanceName?.trim();

  if (!apiKey || !instanceName) {
    return reply.status(400).send({ error: "Clé API et nom d'instance Evolution sont requis." });
  }

  saveEvolutionSettings({ baseUrl, apiKey, instanceName });

  try {
    const result = await testGreenApiConnection();
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
    return await testGreenApiConnection();
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
  const processed = handleEvolutionWebhook(request.body);
  return { ok: true, processed };
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
  const limit = since === 0 ? 500 : 100;
  return { messages: getWhatsAppMessagesSince(since, limit) };
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

await registerGreenApiRoutes(app);
await registerAutomationRoutes(app);
await registerFeatureRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`\n🚀 WhatsApp Agent : http://localhost:${config.port}`);
  console.log(`   Ouvrez l'app → Connexions → configurez OpenAI + Green-API\n`);
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
