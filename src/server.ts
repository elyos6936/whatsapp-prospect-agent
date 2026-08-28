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
  getAgentThread,
  getAutomationDetail,
  getContactThread,
  getDailyBilan,
  getIncomingMessagesSince,
  getRecentAgentMessages,
  getWhatsAppMessagesSince,
  isAutoReplyEnabled,
  listContacts,
  listAgentThreads,
  createAgentThread,
  deleteAgentThread,
  updateAgentThreadTitle,
  maskSecret,
  saveAgentMessage,
  saveBusinessProfile,
  saveContact,
  setAutoReplyEnabled,
  CONTACT_STATUSES,
  type ContactStatus,
} from "./db.js";
import { chatWithAgent, getLastAgentPath, resetLastAgentPath } from "./agent.js";
import { chatIdToDisplay, diagnoseEvolutionApi, testEvolutionConnection } from "./evolutionapi.js";
import { startNotificationPoller, getWhatsappPollHealth, handleEvolutionWebhook, reprocessPendingAutoReplies } from "./notifications.js";
import { startScheduler } from "./scheduler.js";
import { registerAuth, requireUserId } from "./auth.js";
import { requireAdmin } from "./admin-auth.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerEvolutionRoutes } from "./evolution-routes.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { registerFeatureRoutes } from "./feature-routes.js";
import { registerIntegrationRoutes } from "./integration-routes.js";
import { registerBillingRoutes } from "./billing-routes.js";
import { registerTeamRoutes } from "./team-routes.js";
import { registerCampaignMemoryRoutes } from "./campaign-memory-routes.js";
import { registerSupportRoutes } from "./support-routes.js";
import {
  ensureCampaignMemoriesSchema,
  getCampaignMemory,
  getThreadCampaignMemoryId,
  setThreadCampaignMemory,
} from "./campaign-memory.js";
import { startAutomationEngine } from "./automation-engine.js";
import { processSendQueue } from "./send-queue.js";
import { processDueSequences } from "./sequences.js";
import {
  createAgentChatJob,
  finishAgentChatJob,
  hasPendingAgentChatJob,
  markLostAgentChatJobs,
} from "./agent-chat-jobs.js";
import {
  generateRequestId,
  logEvent,
  recordWorkerTick,
  runWithRequestContext,
} from "./observability.js";
import { sql } from "./pg.js";

declare module "fastify" {
  interface FastifyRequest {
    requestId?: string;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadsDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// bodyLimit relevé pour accepter les uploads base64 (fichiers du chat).
const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

const corsOrigins = (process.env.CORS_ORIGINS || "https://www.klanvio.com,https://klanvio.com,http://localhost:3000,http://localhost:5174,http://127.0.0.1:5174,http://127.0.0.1:3000,http://localhost:8888")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin: string): boolean {
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    // Dev local : localhost et 127.0.0.1 sur ports Vite/API
    if (
      (host === "localhost" || host === "127.0.0.1") &&
      ["5174", "5175", "3000", "3001", "8888"].includes(u.port)
    ) {
      return true;
    }
    // Domaine principal Klanvio
    if (host === "klanvio.com" || host.endsWith(".klanvio.com")) return true;
    // Préviews Netlify / Vercel (transition + déploiements preview)
    if (host === "netlify.app" || host.endsWith(".netlify.app")) return true;
    return host === "vercel.app" || host.endsWith(".vercel.app");
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
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  credentials: true,
});

app.addHook("onRequest", async (request, reply) => {
  const incoming = request.headers["x-request-id"];
  request.requestId =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim()
      : generateRequestId();
  reply.header("X-Request-Id", request.requestId);
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/",
  index: ["index.html"],
});

await registerAuth(app);
await registerAuthRoutes(app);
await registerAdminRoutes(app);
await registerCampaignMemoryRoutes(app);

app.get("/", async (_request, reply) => {
  return reply.sendFile("index.html");
});

/** SPA ops — fallback index pour /ops et /ops/* ; assets servis explicitement (sinon 404). */
app.get("/ops", async (_request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
  return reply.sendFile("ops/index.html");
});
app.get("/ops/", async (_request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
  return reply.sendFile("ops/index.html");
});
app.get("/ops/*", async (request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
  const urlPath = (request.url.split("?")[0] ?? "").replace(/^\/ops\/?/, "");
  // La route catch-all prime sur @fastify/static : il faut servir les fichiers ici.
  if (urlPath && !urlPath.includes("..") && /\.[a-zA-Z0-9]+$/.test(urlPath)) {
    return reply.sendFile(`ops/${urlPath}`);
  }
  return reply.sendFile("ops/index.html");
});

/** SPA support client — api.klanvio.com/support */
app.get("/support", async (_request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
  return reply.sendFile("support/index.html");
});
app.get("/support/", async (_request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
  return reply.sendFile("support/index.html");
});
app.get("/support/*", async (request, reply) => {
  reply.header("X-Robots-Tag", "noindex, nofollow");
  const urlPath = (request.url.split("?")[0] ?? "").replace(/^\/support\/?/, "");
  if (urlPath && !urlPath.includes("..") && /\.[a-zA-Z0-9]+$/.test(urlPath)) {
    return reply.sendFile(`support/${urlPath}`);
  }
  return reply.sendFile("support/index.html");
});

app.addHook("onSend", async (request, reply, payload) => {
  const path = request.url.split("?")[0] ?? "";
  if (
    path.startsWith("/ops") ||
    path.startsWith("/support") ||
    path.startsWith("/api/admin") ||
    path.startsWith("/api/support/tickets")
  ) {
    if (!path.startsWith("/api/support/tickets/mine")) {
      reply.header("X-Robots-Tag", "noindex, nofollow");
    }
  }
  return payload;
});
app.get("/api/health", async () => {
  return {
    ok: true,
    model: config.openaiModel,
    whatsappPoll: getWhatsappPollHealth(),
  };
});

app.get("/api/health/ready", { preHandler: requireAdmin }, async (_request, reply) => {
  const checks: Record<string, boolean | string | null> = {
    database: false,
    jwtSecret: Boolean(config.jwtSecret),
    pollerRecent: false,
    pollerLastAt: getWhatsappPollHealth().lastPollAt ?? null,
  };
  try {
    await sql`SELECT 1`;
    checks.database = true;
  } catch (err) {
    checks.databaseError = err instanceof Error ? err.message : String(err);
  }
  const lastPoll = getWhatsappPollHealth().lastPollAt;
  if (lastPoll) {
    const ageMs = Date.now() - new Date(lastPoll).getTime();
    checks.pollerRecent = Number.isFinite(ageMs) && ageMs < 5 * 60_000;
  }
  const ready = checks.database === true && checks.jwtSecret === true;
  if (!ready) {
    return reply.status(503).send({ ok: false, ready: false, checks });
  }
  return { ok: true, ready: true, checks };
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
  // Clé LLM gérée par la plateforme selon LLM_PROVIDER.
  return { ok: true, message: `Clé IA gérée par la plateforme (${config.llmProvider}).` };
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

function verifyEvolutionWebhookAuth(request: { headers: Record<string, string | string[] | undefined> }): boolean {
  const expected = config.envEvolutionApiKey;
  if (!expected) return process.env.NODE_ENV !== "production";
  const raw =
    request.headers.apikey ??
    request.headers["x-api-key"] ??
    request.headers.authorization;
  const token = String(Array.isArray(raw) ? raw[0] : raw ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return token.length > 0 && token === expected;
}

app.post("/api/evolution/webhook", async (request, reply) => {
  if (!verifyEvolutionWebhookAuth(request)) {
    return reply.status(401).send({ error: "Webhook Evolution non autorisé." });
  }
  const processed = await handleEvolutionWebhook(request.body);
  return { ok: true, processed };
});

app.get("/api/history", async (request, reply) => {
  const userId = requireUserId(request);
  const threadId = Number((request.query as { thread_id?: string }).thread_id);
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "Le paramètre « thread_id » est requis." });
  }
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  return {
    messages: await getRecentAgentMessages(userId, threadId, 100),
  };
});

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

app.get("/api/history/since", async (request, reply) => {
  const userId = requireUserId(request);
  const since = Number((request.query as { since?: string }).since) || 0;
  const threadId = Number((request.query as { thread_id?: string }).thread_id);
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "Le paramètre « thread_id » est requis." });
  }
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  return { messages: await getAgentMessagesSince(userId, threadId, since) };
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
    const { ensureGoogleContactBeforeSend } = await import("./integrations/google-contacts.js");
    const google = await ensureGoogleContactBeforeSend(userId, {
      phone: contact.phone,
      name: contact.name,
    });
    return {
      contact: {
        ...contact,
        display: chatIdToDisplay(contact.phone),
        auto_reply: contact.auto_reply === 1,
      },
      googleContactsSynced: google.synced,
      googleContactsReason: google.reason ?? null,
    };
  } catch (err) {
    return reply.status(400).send({
      error: err instanceof Error ? err.message : "Erreur enregistrement contact",
    });
  }
});

app.get("/api/threads", async (request) => {
  const userId = requireUserId(request);
  await ensureCampaignMemoriesSchema().catch(() => {});
  const threads = await listAgentThreads(userId);
  // Liste vide autorisée : l'utilisateur peut tout supprimer ; création via POST /api/threads.
  return { threads };
});

app.post<{ Body: { title?: string; description?: string; purpose?: string } }>(
  "/api/threads",
  async (request, reply) => {
    const userId = requireUserId(request);
    const { normalizeThreadPurpose } = await import("./db.js");
    const purpose = normalizeThreadPurpose(request.body?.purpose);
    if (request.body?.purpose != null && String(request.body.purpose).trim() && !purpose) {
      return reply.status(400).send({
        error: "Le champ « purpose » doit valoir « prospection », « support » ou « groupes ».",
      });
    }
    const thread = await createAgentThread(
      userId,
      request.body?.title?.trim() || "Automatisation",
      request.body?.description?.trim() || null,
      purpose
    );
    return { thread };
  }
);

app.patch<{ Params: { id: string }; Body: { title?: string } }>("/api/threads/:id", async (request, reply) => {
  const userId = requireUserId(request);
  const id = Number(request.params.id);
  if (!Number.isFinite(id)) {
    return reply.status(400).send({ error: "ID invalide." });
  }
  const title = request.body?.title?.trim();
  if (!title) {
    return reply.status(400).send({ error: "Le champ « title » est requis." });
  }
  const thread = await updateAgentThreadTitle(userId, id, title);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  return { thread };
});

app.get<{ Params: { id: string } }>("/api/threads/:id/memory", async (request, reply) => {
  const userId = requireUserId(request);
  const threadId = Number(request.params.id);
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "ID invalide." });
  }
  await ensureCampaignMemoriesSchema().catch(() => {});
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  const memoryId = await getThreadCampaignMemoryId(userId, threadId);
  const memory = memoryId != null ? await getCampaignMemory(userId, memoryId) : null;
  return {
    threadId,
    campaign_memory_id: memory?.id ?? null,
    memory: memory
      ? {
          id: memory.id,
          name: memory.name,
          instructions: memory.instructions,
          ownerName: memory.ownerName,
          introFormula: memory.introFormula,
          tone: memory.tone,
          toneNote: memory.toneNote,
          formality: memory.formality,
          stickersEnabled: memory.stickersEnabled,
          emojiLevel: memory.emojiLevel,
          sendWindowStart: memory.sendWindowStart,
          sendWindowEnd: memory.sendWindowEnd,
          isDefault: memory.isDefault,
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
        }
      : null,
  };
});

app.put<{
  Params: { id: string };
  Body: { memoryId?: number | null };
}>("/api/threads/:id/memory", async (request, reply) => {
  const userId = requireUserId(request);
  const threadId = Number(request.params.id);
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "ID invalide." });
  }
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  const raw = request.body?.memoryId;
  const memoryId =
    raw === null || raw === undefined
      ? null
      : Number.isFinite(Number(raw))
        ? Number(raw)
        : NaN;
  if (raw != null && !Number.isFinite(memoryId as number)) {
    return reply.status(400).send({ error: "memoryId invalide." });
  }
  try {
    await setThreadCampaignMemory(userId, threadId, memoryId);
  } catch (err) {
    return reply.status(400).send({
      error: err instanceof Error ? err.message : "Impossible de lier la mémoire.",
    });
  }
  const updated = await getAgentThread(userId, threadId);
  let note: { id: number; content: string; created_at: string } | null = null;
  try {
    if (memoryId != null) {
      const mem = await getCampaignMemory(userId, memoryId);
      const content = mem
        ? `Mémoire « ${mem.name} » connectée à cette automatisation. Je m'appuie dessus pour la suite — tu peux continuer tes instructions. Les réponses WhatsApp prospects resteront alignées sur cette mémoire.`
        : `Mémoire connectée à cette automatisation. Tu peux continuer tes instructions.`;
      const saved = await saveAgentMessage(userId, threadId, "assistant", content);
      note = {
        id: saved.id,
        content: saved.content,
        created_at: saved.created_at,
      };
      // Sync campagne liée (si existe déjà)
      try {
        const { syncThreadAutomationFromMemory } = await import("./campaign-sync.js");
        await syncThreadAutomationFromMemory(userId, threadId);
      } catch (err) {
        console.warn("[memory] sync on link:", err);
      }
    } else {
      const content =
        "Mémoire déconnectée de cette automatisation. Relie une mémoire (bouton Mémoire) pour reprendre le brief.";
      const saved = await saveAgentMessage(userId, threadId, "assistant", content);
      note = {
        id: saved.id,
        content: saved.content,
        created_at: saved.created_at,
      };
    }
  } catch (err) {
    console.warn("[memory] note chat:", err);
  }
  return { ok: true, thread: updated, note };
});

app.delete<{ Params: { id: string } }>("/api/threads/:id", async (request, reply) => {
  const userId = requireUserId(request);
  const id = Number(request.params.id);
  if (!Number.isFinite(id)) {
    return reply.status(400).send({ error: "ID invalide." });
  }
  const ok = await deleteAgentThread(userId, id);
  if (!ok) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  return { ok: true };
});

app.get<{
  Params: { id: string };
  Querystring: { from?: string; to?: string; range?: string };
}>("/api/threads/:id/campaign", async (request, reply) => {
  const userId = requireUserId(request);
  const threadId = Number(request.params.id);
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "ID invalide." });
  }
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  if (!thread.automation_id) {
    return reply.status(404).send({ error: "Aucune campagne liée à ce fil." });
  }
  const detail = await getAutomationDetail(userId, thread.automation_id);
  if (!detail) {
    return reply.status(404).send({ error: "Campagne introuvable." });
  }
  const auto = detail.automation;
  const targets = detail.targets;
  /** Aligné sur TARGET_META / outreachMetrics : « contacted » = sans réponse. */
  const contacted = targets.filter((t) => t.status === "contacted").length;
  const reachedTargets = targets.filter(
    (t) => t.status !== "pending" && t.status !== "queued"
  ).length;
  const replied = targets.filter(
    (t) => t.status === "replied" || t.status === "interested" || t.status === "stopped"
  ).length;
  const interested = targets.filter((t) => t.status === "interested").length;
  const pending = targets.filter((t) => t.status === "pending").length;
  const stopped = targets.filter((t) => t.status === "stopped").length;
  const messagesSent = (Number(auto.stats.outboundUsed) || 0) || reachedTargets;
  const messagesHandled = Number(auto.stats.messagesHandled) || 0;
  const responseRate = reachedTargets > 0 ? Math.round((replied / reachedTargets) * 100) : null;
  const bilan = await getDailyBilan(userId).catch(() => null);

  const { resolveCampaignAnalyticsWindow, getCampaignAnalytics } = await import("./db.js");
  const window = resolveCampaignAnalyticsWindow({
    range: request.query.range,
    from: request.query.from,
    to: request.query.to,
    campaignCreatedAt: auto.created_at,
  });
  const analytics = await getCampaignAnalytics(
    userId,
    thread.automation_id,
    window.from,
    window.toExclusive
  ).catch((err) => {
    console.error("campaign analytics:", err);
    return null;
  });

  return {
    thread_id: threadId,
    detail,
    stats: {
      targetsTotal: targets.length,
      contacted,
      pending,
      replied,
      interested,
      stopped,
      messagesSent,
      messagesHandled,
      /** Personnes distinctes ayant écrit (lifetime) — pas messagesHandled. */
      discussing: analytics?.summary.discussingLifetime ?? 0,
      responseRatePercent: responseRate,
      conversions: Number(auto.stats.conversions) || 0,
      lastActionAt: auto.stats.lastActionAt ?? null,
      report: typeof auto.stats.report === "string" ? auto.stats.report : null,
    },
    analytics,
    today: bilan ? { date: bilan.date, incoming: bilan.incoming, outgoing: bilan.outgoing } : null,
  };
});

app.delete("/api/history", async (request, reply) => {
  const userId = requireUserId(request);
  const threadId = Number((request.query as { thread_id?: string }).thread_id);
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "Le paramètre « thread_id » est requis." });
  }
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }
  await clearAgentConversation(userId, threadId);
  return { ok: true };
});

app.post<{
  Body: {
    opener?: string;
    history?: Array<{ role?: string; text?: string }>;
    prospectMessage?: string;
    guide?: string;
    offer?: string;
    mode?: string;
    threadId?: number;
    thread_id?: number;
  };
}>("/api/simulation/preview", async (request, reply) => {
  const userId = requireUserId(request);
  const body = request.body ?? {};
  try {
    const { replyInSimulationPreview } = await import("./simulation-preview.js");
    const history = Array.isArray(body.history)
      ? body.history
          .filter((t) => t && (t.role === "you" || t.role === "prospect") && t.text)
          .map((t) => ({ role: t.role as "you" | "prospect", text: String(t.text) }))
      : [];
    const mode = body.mode === "inbound" ? "inbound" : "outbound";
    const threadRaw = body.threadId ?? body.thread_id;
    const threadId =
      threadRaw != null && Number.isFinite(Number(threadRaw))
        ? Number(threadRaw)
        : null;
    const result = await replyInSimulationPreview(userId, {
      opener: String(body.opener ?? ""),
      history,
      prospectMessage: String(body.prospectMessage ?? ""),
      guide: body.guide ? String(body.guide) : undefined,
      offer: body.offer ? String(body.offer) : undefined,
      mode,
      threadId,
    });
    return result;
  } catch (err) {
    return reply.status(400).send({
      error: err instanceof Error ? err.message : "Simulation impossible.",
    });
  }
});

app.post<{ Body: { message?: string; thread_id?: number } }>("/api/chat", async (request, reply) => {
  const userId = requireUserId(request);
  const message = request.body?.message?.trim();
  const threadId = Number(request.body?.thread_id);
  const requestId = request.requestId ?? generateRequestId();
  if (!message) {
    return reply.status(400).send({ error: "Le champ « message » est requis." });
  }
  if (!Number.isFinite(threadId)) {
    return reply.status(400).send({ error: "Le champ « thread_id » est requis." });
  }
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return reply.status(404).send({ error: "Fil introuvable." });
  }

  if (await hasPendingAgentChatJob(userId, threadId)) {
    return reply.status(429).send({
      error: "Une réponse est déjà en cours sur ce fil. Attendez quelques secondes puis réessayez.",
    });
  }

  let userSaved: { id: number; created_at: string };
  let jobId: number;
  try {
    userSaved = await saveAgentMessage(userId, threadId, "user", message);
    const job = await createAgentChatJob({ userId, threadId, requestId });
    jobId = job.id;
  } catch (err) {
    logEvent({
      level: "error",
      component: "chat",
      event: "chat.job.create_failed",
      requestId,
      userId,
      threadId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  void runWithRequestContext({ requestId, userId, threadId, jobId }, async () => {
    const started = Date.now();
    logEvent({
      component: "chat",
      event: "chat.job.started",
      requestId,
      userId,
      threadId,
      jobId,
      meta: { msgLen: message.length },
    });
    resetLastAgentPath();
    try {
      const assistantReply = await chatWithAgent(userId, message, threadId);
      await saveAgentMessage(userId, threadId, "assistant", assistantReply);
      const pathInfo = getLastAgentPath();
      await finishAgentChatJob(jobId, {
        status: "completed",
        path: pathInfo.path,
        slot: pathInfo.slot ?? null,
        durationMs: Date.now() - started,
      });
      logEvent({
        component: "chat",
        event: "chat.job.completed",
        requestId,
        userId,
        threadId,
        jobId,
        path: pathInfo.path,
        slot: pathInfo.slot ?? undefined,
        durationMs: Date.now() - started,
        meta: { replyLen: assistantReply.length },
      });
    } catch (err) {
      const { userFacingError } = await import("./user-facing.js");
      const msg = userFacingError(err);
      await saveAgentMessage(userId, threadId, "assistant", msg);
      const pathInfo = getLastAgentPath();
      await finishAgentChatJob(jobId, {
        status: "failed",
        path: pathInfo.path,
        slot: pathInfo.slot ?? null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      logEvent({
        level: "error",
        component: "chat",
        event: "chat.job.failed",
        requestId,
        userId,
        threadId,
        jobId,
        path: pathInfo.path,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
    }
  });

  return reply.status(202).send({
    pending: true,
    since_id: userSaved.id,
    request_id: requestId,
    job_id: jobId,
    created_at: userSaved.created_at,
  });
});

app.post<{ Body: { event?: string; threadId?: number; since?: number; requestId?: string; meta?: Record<string, unknown> } }>(
  "/api/client-events",
  async (request) => {
    const userId = requireUserId(request);
    const body = request.body ?? {};
    logEvent({
      component: "frontend",
      event: String(body.event ?? "client.event"),
      requestId: body.requestId ?? request.requestId,
      userId,
      threadId: body.threadId,
      meta: body.meta,
    });
    return { ok: true };
  },
);

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
await registerIntegrationRoutes(app);
await registerBillingRoutes(app);
await registerTeamRoutes(app);
await registerSupportRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`\n🚀 WhatsApp Agent : http://localhost:${config.port}`);
  console.log(`🕐 Fuseau horaire : ${config.timezone} (process.env.TZ=${process.env.TZ})`);
  console.log(`   LLM chat : ${config.llmProvider} (${config.openaiModel}) @ ${config.llmBaseUrl}`);
  if (config.toolLlmConfigured) {
    console.log(
      `   LLM sim  : ${config.toolLlmProvider} (${config.toolLlmModel}) @ ${config.toolLlmBaseUrl} (filet simulation)`
    );
  } else {
    console.warn(
      `   ⚠️ LLM sim  : ANTHROPIC_API_KEY absente — simulations via MiniMax (chat)`
    );
  }
  console.log(`   Ouvrez l'app → Connexions → Evolution API + WhatsApp QR\n`);
  startNotificationPoller(90_000);
  startScheduler(15_000);
  startAutomationEngine(15_000);
  setInterval(() => {
    void processSendQueue(2);
    void processDueSequences();
  }, 15_000);
  setInterval(() => {
    void markLostAgentChatJobs(10).then((n) => {
      if (n > 0) {
        logEvent({
          level: "warn",
          component: "chat",
          event: "chat.job.lost",
          meta: { count: n },
        });
      }
    });
  }, 5 * 60_000);
  // Watchdog sessions WhatsApp — restaure les close silencieux sans QR
  const { watchWhatsAppConnections } = await import("./whatsapp-connection.js");
  const { listActiveUserIds } = await import("./users.js");
  setInterval(() => {
    void watchWhatsAppConnections(listActiveUserIds)
      .then(() => recordWorkerTick("whatsapp_watchdog"))
      .catch((err) =>
        recordWorkerTick("whatsapp_watchdog", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }, 60_000);
  void watchWhatsAppConnections(listActiveUserIds).catch(() => {});

  const { expireDueSubscriptions } = await import("./users.js");
  const { sendDueSubscriptionRenewalReminders } = await import("./subscription-reminders.js");
  setInterval(() => {
    void expireDueSubscriptions().catch(() => {});
    void sendDueSubscriptionRenewalReminders().catch(() => {});
  }, 15 * 60_000);
  void expireDueSubscriptions().catch(() => {});
  void sendDueSubscriptionRenewalReminders().catch(() => {});
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
