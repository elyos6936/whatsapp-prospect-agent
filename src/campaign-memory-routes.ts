import type { FastifyInstance } from "fastify";
import { requireUserId } from "./auth.js";
import {
  CAMPAIGN_MEMORY_MAX,
  createCampaignMemory,
  deleteCampaignMemory,
  getCampaignMemory,
  getPresentationPrefill,
  listCampaignMemories,
  setDefaultCampaignMemory,
  updateCampaignMemory,
  type CampaignMemoryInput,
} from "./campaign-memory.js";

function bodyToInput(body: Record<string, unknown> | null | undefined): CampaignMemoryInput {
  const b = body ?? {};
  return {
    name: String(b.name ?? "").trim(),
    ownerName: b.ownerName != null ? String(b.ownerName) : undefined,
    introFormula: b.introFormula != null ? String(b.introFormula) : undefined,
    tone: b.tone as CampaignMemoryInput["tone"],
    toneNote: b.toneNote != null ? String(b.toneNote) : undefined,
    formality: b.formality as CampaignMemoryInput["formality"],
    stickersEnabled: b.stickersEnabled != null ? Boolean(b.stickersEnabled) : undefined,
    emojiLevel: b.emojiLevel as CampaignMemoryInput["emojiLevel"],
    sendWindowStart: b.sendWindowStart != null ? Number(b.sendWindowStart) : undefined,
    sendWindowEnd: b.sendWindowEnd != null ? Number(b.sendWindowEnd) : undefined,
    isDefault: b.isDefault != null ? Boolean(b.isDefault) : undefined,
  };
}

function toJson(m: Awaited<ReturnType<typeof getCampaignMemory>>) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    ownerName: m.ownerName,
    introFormula: m.introFormula,
    tone: m.tone,
    toneNote: m.toneNote,
    formality: m.formality,
    stickersEnabled: m.stickersEnabled,
    emojiLevel: m.emojiLevel,
    sendWindowStart: m.sendWindowStart,
    sendWindowEnd: m.sendWindowEnd,
    isDefault: m.isDefault,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export async function registerCampaignMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/campaign-memories", async (request) => {
    const userId = requireUserId(request);
    const memories = await listCampaignMemories(userId);
    const prefill = await getPresentationPrefill(userId);
    return {
      memories: memories.map(toJson),
      max: CAMPAIGN_MEMORY_MAX,
      prefill,
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/api/campaign-memories", async (request, reply) => {
    const userId = requireUserId(request);
    const input = bodyToInput(request.body);
    if (!input.name || input.name.length < 2) {
      return reply.status(400).send({ error: "Donne un nom à la mémoire (min. 2 caractères)." });
    }
    try {
      const mem = await createCampaignMemory(userId, input);
      return { ok: true, memory: toJson(mem) };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Impossible de créer la mémoire.",
      });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/campaign-memories/:id",
    async (request, reply) => {
      const userId = requireUserId(request);
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const input = bodyToInput(request.body);
      const mem = await updateCampaignMemory(userId, id, input);
      if (!mem) return reply.status(404).send({ error: "Mémoire introuvable." });
      return { ok: true, memory: toJson(mem) };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/campaign-memories/:id/default",
    async (request, reply) => {
      const userId = requireUserId(request);
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const mem = await setDefaultCampaignMemory(userId, id);
      if (!mem) return reply.status(404).send({ error: "Mémoire introuvable." });
      return { ok: true, memory: toJson(mem) };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/campaign-memories/:id",
    async (request, reply) => {
      const userId = requireUserId(request);
      const id = Number(request.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: "ID invalide." });
      const ok = await deleteCampaignMemory(userId, id);
      if (!ok) return reply.status(404).send({ error: "Mémoire introuvable." });
      return { ok: true };
    }
  );
}
