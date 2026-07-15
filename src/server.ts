import { config } from "./config.js";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  clearAgentConversation,
  cancelPendingSendQueue,
  countOutboundToday,
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
  setAutoReplyEnabled,
  CONTACT_STATUSES,
  type ContactStatus,
} from "./db.js";
import { chatWithAgent } from "./agent.js";
import { transcribeChatAudio } from "./media-understanding.js";
import { chatIdToDisplay, diagnoseEvolutionApi, testEvolutionConnection } from "./evolutionapi.js";
import { startNotificationPoller, getWhatsappPollHealth, handleEvolutionWebhook, reprocessPendingAutoReplies } from "./notifications.js";
import { startScheduler } from "./scheduler.js";
import { registerAuth, requireUserId } from "./auth.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerEvolutionRoutes } from "./evolution-routes.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { registerFeatureRoutes } from "./feature-routes.js";
import { startAutomationEngine } from "./automation-engine.js";
import { processSendQueue } from "./send-queue.js";
import { processDueSequences } from "./sequences.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadsDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// bodyLimit relevé pour accepter les uploads base64 (fichiers du chat, audio de dictée vocale).
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

const corsOrigins = (process.env.CORS_ORIGINS || "https://klanvio.netlify.app,https://klanvio1.netlify.app,http://localhost:3000,http://localhost:5174,http://localhost:8888")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin: string): boolean {
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;
  // Tout site Netlify (prod, alias, previews) — l'API est multi-tenant côté auth.
  try {
    const host = new URL(origin).hostname;
    return host === "netlify.app" || host.endsWith(".netlify.app");
  } catch {
    return false;
  }
}

await app.register(fastifyCors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (isAllowedCorsOrigin(origin)) return cb(null, true);
    cb(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/",
  index: ["index.html"],
});

await registerAuth(app);
await registerAuthRoutes(app);

app.get("/", async (_request, reply) => {
  return reply.sendFile("index.html");
});

app.get("/api/health", async () => {
  return {
    ok: true,
    model: config.openaiModel,
    whatsappPoll: getWhatsappPollHealth(),
  };
});

app.get("/api/settings", async (request) => {
  const userId = requireUserId(request);
  const s = await getAppSettings(userId);
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
    autoReply: await isAutoReplyEnabled(userId),
  };
});

app.post<{
  Body: { ownerName?: string; offer?: string; price?: string };
}>("/api/settings/business", async (request) => {
  const userId = requireUserId(request);
  await saveBusinessProfile(userId, {
    ownerName: request.body?.ownerName,
    offer: request.body?.offer,
    price: request.body?.price,
  });
  const s = await getAppSettings(userId);
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
  const userId = requireUserId(request);
  const date = (request.query as { date?: string }).date;
  return await getDailyBilan(userId, date);
});

app.get("/api/contacts/:phone/thread", async (request, reply) => {
  const userId = requireUserId(request);
  const raw = decodeURIComponent((request.params as { phone: string }).phone || "");
  if (!raw.trim()) {
    return reply.status(400).send({ error: "Numéro requis." });
  }
  const limit = Math.min(Number((request.query as { limit?: string }).limit) || 100, 200);
  const messages = await getContactThread(userId, raw, limit);
  return {
    phone: raw,
    display: chatIdToDisplay(raw.includes("@") ? raw : `${raw.replace(/\D/g, "")}@c.us`),
    count: messages.length,
    messages,
  };
});

app.post("/api/settings/openai", async () => {
  // Clé LLM gérée par la plateforme (DEEPSEEK_API_KEY / OPENAI_API_KEY).
  return { ok: true, message: "Clé IA gérée par la plateforme (DeepSeek)." };
});

app.post("/api/settings/evolution", async () => {
  // Instance Evolution provisionnée automatiquement par la plateforme (klanvio_<userId>).
  return { ok: true, message: "Connexion WhatsApp gérée par la plateforme." };
});

app.post("/api/settings/evolution/test", async (request, reply) => {
  const userId = requireUserId(request);
  try {
    return await testEvolutionConnection(userId);
  } catch (err) {
    return reply.status(502).send({
      connected: false,
      state: "error",
      message: err instanceof Error ? err.message : "Erreur Evolution API",
    });
  }
});

app.get("/api/evolution/diagnose", async (request, reply) => {
  const userId = requireUserId(request);
  try {
    return await diagnoseEvolutionApi(userId);
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

app.get("/api/history", async (request) => ({
  messages: await getRecentAgentMessages(requireUserId(request), 100),
}));

app.get("/api/incoming", async (request) => {
  const userId = requireUserId(request);
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: await getIncomingMessagesSince(userId, since) };
});

app.get("/api/whatsapp", async (request) => {
  const userId = requireUserId(request);
  const since = Number((request.query as { since?: string }).since) || 0;
  const limit = since === 0 ? 500 : 100;
  return { messages: await getWhatsAppMessagesSince(userId, since, limit) };
});

app.get("/api/history/since", async (request) => {
  const userId = requireUserId(request);
  const since = Number((request.query as { since?: string }).since) || 0;
  return { messages: await getAgentMessagesSince(userId, since) };
});

app.post<{ Body: { enabled?: boolean } }>("/api/settings/auto-reply", async (request, reply) => {
  const userId = requireUserId(request);
  if (typeof request.body?.enabled !== "boolean") {
    return reply.status(400).send({ error: "Le champ « enabled » (boolean) est requis." });
  }
  await setAutoReplyEnabled(userId, request.body.enabled);
  return { ok: true, enabled: request.body.enabled };
});

app.post<{
  Body: { action?: "reset" | "setLimit"; extra?: number; limit?: number };
}>("/api/settings/outbound-quota", async (request, reply) => {
  const userId = requireUserId(request);
  const action = request.body?.action;
  if (action === "reset") {
    const extra = Number(request.body?.extra ?? 15);
    const result = await resetOutboundQuotaForToday(userId, Number.isFinite(extra) ? extra : 15);
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
    const saved = await setDailyOutboundLimit(userId, limit);
    return {
      ok: true,
      action: "setLimit",
      outbound: {
        today: await countOutboundToday(userId),
        baseLimit: saved,
        bonus: await getOutboundQuotaBonus(userId),
        limit: await getEffectiveOutboundLimit(userId),
      },
      message: `Limite journalière fixée à ${saved} messages.`,
    };
  }
  return reply.status(400).send({
    error: "Le champ « action » doit valoir « reset » ou « setLimit ».",
  });
});

app.post("/api/settings/reprocess-auto-replies", async (request) => {
  const userId = requireUserId(request);
  const queued = await reprocessPendingAutoReplies(userId);
  return { ok: true, queued, message: `${queued} réponse(s) auto remise(s) en file.` };
});

/** Arrêt d'urgence : annule la file d'envoi et met en pause les automatisations actives. */
app.post("/api/emergency/stop-sending", async (request) => {
  const userId = requireUserId(request);
  const cancelledQueue = await cancelPendingSendQueue(userId);
  const pausedAutomations = await pauseAllActiveAutomations(userId);
  await setAutoReplyEnabled(userId, false);
  return {
    ok: true,
    cancelledQueue,
    pausedAutomations,
    autoReplyEnabled: false,
    message: `${cancelledQueue} envoi(s) en attente annulé(s), ${pausedAutomations} automatisation(s) en pause, réponses auto désactivées.`,
  };
});

app.get("/api/contacts", async (request) => {
  const userId = requireUserId(request);
  const statusRaw = (request.query as { status?: string }).status;
  const status =
    statusRaw && CONTACT_STATUSES.includes(statusRaw as ContactStatus)
      ? (statusRaw as ContactStatus)
      : undefined;
  const contacts = await listContacts(userId, { status, limit: 100 });
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
  const userId = requireUserId(request);
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
    const contact = await saveContact(userId, {
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

app.delete("/api/history", async (request) => {
  await clearAgentConversation(requireUserId(request));
  return { ok: true };
});

app.post<{ Body: { message?: string } }>("/api/chat", async (request, reply) => {
  const userId = requireUserId(request);
  const message = request.body?.message?.trim();
  if (!message) {
    return reply.status(400).send({ error: "Le champ « message » est requis." });
  }

  await saveAgentMessage(userId, "user", message);

  try {
    const assistantReply = await chatWithAgent(userId, message);
    const saved = await saveAgentMessage(userId, "assistant", assistantReply);
    return { id: saved.id, reply: saved.content, created_at: saved.created_at };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : "Erreur inconnue.";
    const saved = await saveAgentMessage(userId, "assistant", `❌ ${errorText}`);
    return {
      id: saved.id,
      reply: saved.content,
      created_at: saved.created_at,
      error: true,
    };
  }
});

app.post<{ Body: { data?: string; mimetype?: string } }>("/api/chat/transcribe", async (request, reply) => {
  const userId = requireUserId(request);
  const { data, mimetype } = request.body ?? {};
  if (!data) return reply.status(400).send({ error: "Audio requis." });
  try {
    const text = await transcribeChatAudio(userId, data, mimetype || "audio/webm");
    return { text };
  } catch (err) {
    return reply.status(500).send({ error: err instanceof Error ? err.message : "Transcription échouée." });
  }
});

app.post<{ Body: { name?: string; type?: string; data?: string } }>("/api/upload", async (request, reply) => {
  const { name, data } = request.body ?? {};
  if (!name || !data) return reply.status(400).send({ error: "name et data requis." });
  const ext = path.extname(name) || ".bin";
  const filename = `${crypto.randomUUID()}${ext}`;
  try {
    fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(data, "base64"));
    return { url: `/uploads/${filename}` };
  } catch (err) {
    return reply.status(500).send({ error: "Erreur lors de l'enregistrement du fichier." });
  }
});

await registerEvolutionRoutes(app);
await registerAutomationRoutes(app);
await registerFeatureRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`\n🚀 WhatsApp Agent : http://localhost:${config.port}`);
  console.log(`🕐 Fuseau horaire : ${config.timezone} (process.env.TZ=${process.env.TZ})`);
  console.log(`   LLM : ${config.llmProvider} (${config.openaiModel}) @ ${config.llmBaseUrl}`);
  console.log(`   Ouvrez l'app → Connexions → Evolution API + WhatsApp QR\n`);
  startNotificationPoller(12_000);
  startScheduler(5000);
  startAutomationEngine(15000);
  setInterval(() => {
    void processSendQueue(2);
    void processDueSequences();
  }, 8000);
  // Watchdog sessions WhatsApp — restaure les close silencieux sans QR
  const { watchWhatsAppConnections } = await import("./whatsapp-connection.js");
  const { listActiveUserIds } = await import("./users.js");
  setInterval(() => {
    void watchWhatsAppConnections(listActiveUserIds).catch(() => {});
  }, 60_000);
  void watchWhatsAppConnections(listActiveUserIds).catch(() => {});
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
