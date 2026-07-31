/**
 * Synchronise mémoire ↔ automatisation ↔ simulation ↔ réponses WhatsApp prospects.
 * Une seule source de vérité « live » : config.livePlaybook + conversationGuide rafraîchie.
 */
import {
  getAgentThread,
  getAutomation,
  resolveThreadIdForAutomation,
  updateAutomationConfig,
  type Automation,
  type AutomationConfig,
} from "./db.js";
import {
  getLinkedCampaignMemory,
  listThreadIdsLinkedToMemory,
  memoryToneLabel,
  memoryToQuietHours,
  parseMemoryHints,
  type CampaignMemory,
} from "./campaign-memory.js";

export type LivePlaybookTurn = {
  speaker: "toi" | "prospect";
  text: string;
  name?: string;
};

export type LivePlaybook = {
  /** Mis à jour à chaque simu / sync mémoire. */
  updatedAt: string;
  /** Figé à la validation UI ou à l'activation. */
  validatedAt?: string;
  turns: LivePlaybookTurn[];
  openerSnapshot?: string;
  guideSnapshot?: string;
  memoryName?: string;
  /** Empreinte courte des instructions mémoire au moment du snapshot. */
  memoryFingerprint?: string;
};

function fingerprint(text: string): string {
  const t = text.trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return `${t.length}:${h.toString(16)}`;
}

/** Construit / fusionne le conversationGuide depuis la mémoire (même logique que create_automation). */
export function bakeConversationGuideFromMemory(
  mem: CampaignMemory,
  existingGuide?: string | null
): string {
  const memoryGuide =
    mem.instructions.trim() ||
    `Style (mémoire « ${mem.name} ») : ton ${memoryToneLabel(mem.tone).toLowerCase()}.`;
  const block = `Mémoire « ${mem.name} » :\n${memoryGuide}`;
  const existing = (existingGuide ?? "").trim();
  if (!existing) return block;

  // Conserve les ajouts manuels après un séparateur ---
  const parts = existing.split(/\n---\n/).map((p) => p.trim()).filter(Boolean);
  const extras = parts.filter(
    (p, i) => i > 0 && !/^Mémoire\s*«/.test(p) && !p.startsWith("Mémoire «")
  );
  if (extras.length) return `${block}\n---\n${extras.join("\n---\n")}`;

  // Guide custom sans préfixe mémoire → mémoire + guide
  if (!/^Mémoire\s*«/.test(existing) && !existing.includes(`Mémoire « ${mem.name} »`)) {
    // Si c'était une vieille mémoire d'un autre nom, remplace ; sinon concatène
    if (/^Mémoire\s*«/.test(existing)) return block;
    return `${block}\n---\n${existing}`;
  }

  return block;
}

export function formatCampaignMemoryForWhatsApp(memory: CampaignMemory): string {
  const body = memory.instructions.trim();
  if (!body) return "";
  return (
    `=== MÉMOIRE CAMPAGNE (à jour — source de vérité) : « ${memory.name} » ===\n` +
    `Applique style, offre, prix, liens, horaires et comportement à la lettre.\n` +
    `INTERDIT d'inventer une autre offre / un autre ton.\n\n` +
    body
  );
}

export function formatLivePlaybookForWhatsApp(playbook: LivePlaybook): string {
  const lines = [
    `=== PLAYBOOK SYNCHRONISÉ (simulation + brief) ===`,
    playbook.validatedAt
      ? `Statut : validé / figé pour les prospects (${playbook.validatedAt.slice(0, 16)}).`
      : `Statut : brouillon simu — suis tout de même le ton et la trajectoire.`,
    playbook.openerSnapshot
      ? `Opener déjà envoyé (ou à envoyer) : « ${playbook.openerSnapshot} »`
      : "",
    playbook.memoryName ? `Mémoire liée : « ${playbook.memoryName} »` : "",
    "",
    `Trajectoire de référence (ne pas recopier mot à mot — rester fidèle au ton, aux angles, aux CTAs) :`,
  ];
  for (const turn of playbook.turns.slice(0, 7)) {
    if (turn.speaker === "toi") {
      lines.push(`- Toi : « ${turn.text} »`);
    } else {
      lines.push(`- ${turn.name || "Prospect"} : « ${turn.text} »`);
    }
  }
  lines.push(
    "",
    `RÈGLE : chaque réponse prospect doit coller à ce playbook + à la mémoire ci-dessus. ` +
      `Pas de dérive fade (« Super. ») ni de pitch hors trajectoire.`
  );
  return lines.filter((l) => l !== undefined).join("\n");
}

/** Applique mémoire → conversationGuide (+ hints) sur une automatisation. */
export async function syncAutomationConfigFromMemory(
  userId: number,
  automationId: number,
  mem: CampaignMemory,
  opts: { refreshPlaybookGuide?: boolean } = {}
): Promise<Automation | null> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return null;

  const hints = parseMemoryHints(mem.instructions);
  const quiet = memoryToQuietHours(mem);
  const nextGuide = bakeConversationGuideFromMemory(mem, auto.config.conversationGuide);

  const next: AutomationConfig = {
    ...auto.config,
    conversationGuide: nextGuide,
    stickersEnabled:
      auto.config.stickersEnabled === true
        ? true
        : hints.stickersEnabled || mem.stickersEnabled,
  };

  // Ne pas écraser des quiet hours déjà customisées sauf si absentes
  if (auto.config.quietHoursStart == null && auto.config.quietHoursEnd == null) {
    next.quietHoursStart = quiet.quietHoursStart;
    next.quietHoursEnd = quiet.quietHoursEnd;
  }

  if (opts.refreshPlaybookGuide !== false && auto.config.livePlaybook) {
    next.livePlaybook = {
      ...auto.config.livePlaybook,
      updatedAt: new Date().toISOString(),
      guideSnapshot: nextGuide,
      memoryName: mem.name,
      memoryFingerprint: fingerprint(mem.instructions),
      openerSnapshot:
        auto.config.livePlaybook.openerSnapshot || auto.config.initialMessage,
    };
  }

  return updateAutomationConfig(userId, automationId, next);
}

/** Sync mémoire → automatisation du fil (si une campagne est liée). */
export async function syncThreadAutomationFromMemory(
  userId: number,
  threadId: number
): Promise<{ automationId: number | null; synced: boolean }> {
  const thread = await getAgentThread(userId, threadId);
  const automationId = thread?.automation_id ?? null;
  if (!automationId) return { automationId: null, synced: false };

  const mem = await getLinkedCampaignMemory(userId, threadId);
  if (!mem) return { automationId, synced: false };

  await syncAutomationConfigFromMemory(userId, automationId, mem);
  return { automationId, synced: true };
}

/** Après édition d'une mémoire : sync toutes les automatisations des fils liés. */
export async function syncAutomationsLinkedToMemory(
  userId: number,
  memoryId: number
): Promise<number[]> {
  const threadIds = await listThreadIdsLinkedToMemory(userId, memoryId);
  const synced: number[] = [];
  for (const threadId of threadIds) {
    const r = await syncThreadAutomationFromMemory(userId, threadId);
    if (r.synced && r.automationId != null) synced.push(r.automationId);
  }
  return synced;
}

/** Persiste les tours de simulation comme playbook live sur la campagne du fil. */
export async function persistLivePlaybookForThread(
  userId: number,
  threadId: number,
  turns: LivePlaybookTurn[],
  opts: { markValidated?: boolean } = {}
): Promise<Automation | null> {
  const thread = await getAgentThread(userId, threadId);
  const automationId = thread?.automation_id;
  if (!automationId || turns.length < 2) return null;

  const auto = await getAutomation(userId, automationId);
  if (!auto) return null;

  const mem = await getLinkedCampaignMemory(userId, threadId);
  const now = new Date().toISOString();
  const prev = auto.config.livePlaybook;

  const playbook: LivePlaybook = {
    updatedAt: now,
    validatedAt: opts.markValidated
      ? now
      : prev?.validatedAt,
    turns: turns.slice(0, 7),
    openerSnapshot:
      auto.config.initialMessage ||
      turns.find((t) => t.speaker === "toi")?.text ||
      prev?.openerSnapshot,
    guideSnapshot: auto.config.conversationGuide || prev?.guideSnapshot,
    memoryName: mem?.name || prev?.memoryName,
    memoryFingerprint: mem ? fingerprint(mem.instructions) : prev?.memoryFingerprint,
  };

  return updateAutomationConfig(userId, automationId, {
    ...auto.config,
    livePlaybook: playbook,
    ...(opts.markValidated
      ? { simulationValidatedAt: now }
      : {}),
  });
}

/** Figé le playbook existant (validation / activation) + re-sync mémoire. */
export async function freezeLivePlaybookForAutomation(
  userId: number,
  automationId: number
): Promise<AutomationConfig> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) throw new Error("Automatisation introuvable.");

  const threadId = await resolveThreadIdForAutomation(userId, automationId);
  let mem: CampaignMemory | null = null;
  if (threadId != null) {
    mem = await getLinkedCampaignMemory(userId, threadId);
    if (mem) {
      await syncAutomationConfigFromMemory(userId, automationId, mem, {
        refreshPlaybookGuide: true,
      });
    }
  }

  const fresh = (await getAutomation(userId, automationId)) ?? auto;
  const now = new Date().toISOString();
  const prev = fresh.config.livePlaybook;
  const opener =
    fresh.config.initialMessage ||
    prev?.openerSnapshot ||
    prev?.turns?.find((t) => t.speaker === "toi")?.text;

  const playbook: LivePlaybook = {
    updatedAt: now,
    validatedAt: now,
    turns: prev?.turns?.length ? prev.turns : [],
    openerSnapshot: opener,
    guideSnapshot: fresh.config.conversationGuide || prev?.guideSnapshot,
    memoryName: mem?.name || prev?.memoryName,
    memoryFingerprint: mem
      ? fingerprint(mem.instructions)
      : prev?.memoryFingerprint,
  };

  const next: AutomationConfig = {
    ...fresh.config,
    livePlaybook: playbook,
    simulationValidatedAt: fresh.config.simulationValidatedAt || now,
  };
  await updateAutomationConfig(userId, automationId, next);
  return next;
}

/** Mémoire liée à une automatisation (via son fil). */
export async function getLinkedMemoryForAutomation(
  userId: number,
  automationId: number
): Promise<CampaignMemory | null> {
  const threadId = await resolveThreadIdForAutomation(userId, automationId);
  if (threadId == null) return null;
  return getLinkedCampaignMemory(userId, threadId);
}
