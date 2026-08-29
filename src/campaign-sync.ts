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
  extractUsefulLinkFromText,
  extractPriceFromMemoryInstructions,
  ensureFormalityInGuide,
  type CampaignMemory,
} from "./campaign-memory.js";
import { looksLikePhoneDump } from "./simulation-sanitize.js";

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

export function formatLivePlaybookForWhatsApp(
  playbook: LivePlaybook,
  opts?: { inbound?: boolean }
): string {
  const inbound = opts?.inbound === true;
  const lines = [
    `=== PLAYBOOK SYNCHRONISÉ (guide de pacing — PAS un script à recopier) ===`,
    playbook.validatedAt
      ? `Statut : validé (${playbook.validatedAt.slice(0, 16)}).`
      : `Statut : brouillon simu.`,
    !inbound && playbook.openerSnapshot
      ? `Opener (1er message sortant) : « ${playbook.openerSnapshot} »`
      : "",
    inbound && playbook.openerSnapshot
      ? `Ton de référence (pas un opener à coller) : « ${playbook.openerSnapshot} »`
      : "",
    playbook.memoryName ? `Mémoire liée : « ${playbook.memoryName} »` : "",
    "",
    inbound
      ? `Trajectoire ENTRANT (le client initie) :`
      : `Trajectoire de RÉFÉRENCE (ton / mission / CTAs) :`,
    inbound
      ? `- Accueille / réponds — INTERDIT intro « je vous contacte au sujet de… ».`
      : `- Garde la même mission et le même pacing (Interest → Desire → Action).`,
    `- Adapte les MOTS au message RÉEL du prospect — priorité au fil réel, pas au prochain tour listé.`,
    inbound
      ? `- Si le client dit seulement « salut / ok / hello » : accueil court + question utile produit.`
      : `- Si le prospect dit seulement « salut / ok / hello » alors que TU as initié : INTERDIT bio / nom + « j'accompagne… », INTERDIT « ravi d'échanger ». Enchaîne 1 question liée à la mission.`,
    `- Si le prospect sort du cadre : recadre en 1 phrase vers l'objectif campagne.`,
  ];
  for (const turn of playbook.turns.slice(0, 7)) {
    if (looksLikePhoneDump(turn.text)) continue;
    if (turn.speaker === "toi") {
      lines.push(`- Toi (exemple) : « ${turn.text} »`);
    } else {
      lines.push(`- ${turn.name || "Prospect"} (exemple) : « ${turn.text} »`);
    }
  }
  lines.push(
    "",
    inbound
      ? `RÈGLE : playbook = boussole. Client a initié — pas de cold outreach.`
      : `RÈGLE : playbook = boussole (ton/objectif). Message réel du prospect = priorité. ` +
          `Pas de dérive fade (« Super. »), pas d'offre inventée, pas d'intro inbound si tu as déjà ouvert.`
  );
  return lines.filter((l) => l !== undefined && l !== "").join("\n");
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
  let nextGuide = bakeConversationGuideFromMemory(mem, auto.config.conversationGuide);
  nextGuide = ensureFormalityInGuide(nextGuide, mem.formality || hints.formality);

  const next: AutomationConfig = {
    ...auto.config,
    conversationGuide: nextGuide,
    stickersEnabled:
      auto.config.stickersEnabled === true
        ? true
        : hints.stickersEnabled || mem.stickersEnabled,
  };

  // Seed prix / lien si absents (mémoire = source de vérité)
  if (!next.closingLink?.trim()) {
    const fromMem = extractUsefulLinkFromText(mem.instructions);
    if (fromMem) next.closingLink = fromMem;
  }
  if (!next.price?.trim()) {
    const fromMem = extractPriceFromMemoryInstructions(mem.instructions);
    if (fromMem) next.price = fromMem;
  }

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
  opts: { markValidated?: boolean; syncOpener?: boolean } = {}
): Promise<Automation | null> {
  const thread = await getAgentThread(userId, threadId);
  const automationId = thread?.automation_id;
  const safeTurns = turns.filter((t) => !looksLikePhoneDump(t.text)).slice(0, 7);
  if (!automationId || safeTurns.length < 2) return null;

  const auto = await getAutomation(userId, automationId);
  if (!auto) return null;

  const mem = await getLinkedCampaignMemory(userId, threadId);
  const now = new Date().toISOString();
  const prev = auto.config.livePlaybook;
  const firstToi = safeTurns.find((t) => t.speaker === "toi")?.text?.trim() || "";
  const syncOpener = opts.syncOpener !== false;

  const playbook: LivePlaybook = {
    updatedAt: now,
    validatedAt: opts.markValidated ? now : prev?.validatedAt,
    turns: safeTurns,
    openerSnapshot:
      (syncOpener && firstToi
        ? firstToi
        : auto.config.initialMessage || prev?.openerSnapshot || firstToi) || undefined,
    guideSnapshot: auto.config.conversationGuide || prev?.guideSnapshot,
    memoryName: mem?.name || prev?.memoryName,
    memoryFingerprint: mem ? fingerprint(mem.instructions) : prev?.memoryFingerprint,
  };

  // Ancre le 1er message campagne sur la simu (source de vérité live).
  const nextInitial =
    syncOpener && firstToi
      ? firstToi
      : auto.config.initialMessage;

  // Section fidélité dans le guide — remplace une précédente section Klanvio playbook.
  const fidelityBlock =
    `=== CADRE PLAYBOOK (ne pas dériver) ===\n` +
    `Les réponses WhatsApp aux prospects DOIVENT rester dans la trajectoire validée en simulation :\n` +
    `même ton, mêmes angles, mêmes CTAs, même pacing AIDA.\n` +
    `INTERDIT : inventer une autre offre, coller une liste de numéros, un style fade hors trajectoire.\n` +
    `En cas de doute : coller au playbook + à la mémoire, pas improviser.`;

  const existingGuide = (auto.config.conversationGuide || "").trim();
  const stripped = existingGuide
    .replace(/\n*=== CADRE PLAYBOOK[\s\S]*?(?=\n===|\n---|$)/g, "")
    .trim();
  const nextGuide = stripped ? `${stripped}\n\n${fidelityBlock}` : fidelityBlock;

  return updateAutomationConfig(userId, automationId, {
    ...auto.config,
    initialMessage: nextInitial || auto.config.initialMessage,
    conversationGuide: nextGuide,
    livePlaybook: {
      ...playbook,
      guideSnapshot: nextGuide,
      openerSnapshot: nextInitial || playbook.openerSnapshot,
    },
    ...(opts.markValidated ? { simulationValidatedAt: now } : {}),
  });
}

/** Convertit un historique preview (you/prospect) en tours playbook. */
export function previewHistoryToPlaybookTurns(
  history: Array<{ role: "you" | "prospect"; text: string }>
): LivePlaybookTurn[] {
  const out: LivePlaybookTurn[] = [];
  for (const h of history) {
    const text = String(h.text ?? "").trim();
    if (!text) continue;
    if (h.role === "you") out.push({ speaker: "toi", text });
    else out.push({ speaker: "prospect", name: "Prospect", text });
    if (out.length >= 7) break;
  }
  return out;
}

/**
 * Après update_automation_config : aligne snapshots + 1er tour toi ;
 * invalide la validation si le cadre a changé (force une re-simu propre).
 */
export async function patchPlaybookAfterConfigEdit(
  userId: number,
  automationId: number,
  changed: { opener?: boolean; guide?: boolean }
): Promise<void> {
  const auto = await getAutomation(userId, automationId);
  if (!auto?.config.livePlaybook?.turns?.length) return;

  const pb = auto.config.livePlaybook;
  const turns = [...pb.turns];
  if (changed.opener && auto.config.initialMessage?.trim()) {
    const idx = turns.findIndex((t) => t.speaker === "toi");
    if (idx >= 0) {
      turns[idx] = { ...turns[idx]!, text: auto.config.initialMessage.trim() };
    }
  }

  const now = new Date().toISOString();
  await updateAutomationConfig(userId, automationId, {
    ...auto.config,
    livePlaybook: {
      ...pb,
      turns,
      updatedAt: now,
      // Cadre modifié → plus considéré comme « figé » jusqu'à re-validation
      validatedAt: changed.opener || changed.guide ? undefined : pb.validatedAt,
      openerSnapshot: auto.config.initialMessage || pb.openerSnapshot,
      guideSnapshot: auto.config.conversationGuide || pb.guideSnapshot,
    },
    ...(changed.opener || changed.guide
      ? { simulationValidatedAt: undefined }
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
