/**
 * Module Groupes WhatsApp — isolé de la prospection et du support.
 *
 * Produit (UI NewAutomationModal + persona) :
 * 1. Envoi / programmation PONCTUELS (admin) → send_whatsapp_message /
 *    schedule_whatsapp_message — PAS de campagne obligatoire.
 * 2. Campagne OPTIONNELLE type=group_broadcast : 1er post + sequence_steps (J+1…).
 *
 * PAS de simulation téléphone (réservé prospection / support).
 * INTERDIT : 5 variantes d'accroche, DM membres, keyword_sales, A.I.D.A. cold.
 */
import type { AgentMessage } from "./db.js";
import type { BriefingAssessment } from "./campaign-briefing.js";
import { isGroupNonPublishAction } from "./group-manage-intent.js";
import { executeTool } from "./tools.js";

export const GROUPS_FIL_SYSTEM_ADDENDUM = `## MODULE GROUPES WHATSAPP (prioritaire sur prospection / support)
- **Ajouter / retirer / admin** : dès que nom du groupe + numéro → manage_group_participants. INTERDIT de demander un texte à poster.
- **Créer un groupe** : create_whatsapp_group (nom + au moins 1 numéro).
- **Lien d'invitation** : group_invite(get_code). **Envoyer le lien à un numéro** : group_invite(send). **Rejoindre** : group_invite(accept). **Quitter** : leave_group.
- **Lire membres** : get_group_members (pas besoin d'être admin).
- « Prospecter le groupe / les membres » → **Nouvelle automatisation → Prospection**. Pas de DM ici. Pas de simulation.
- **Publier** : seulement si l'utilisateur veut envoyer/poster un texto. Alors demande le texte. Admin requis pour l'envoi.
- Diffusion multi-jours : texte + groupes d'abord, puis « je valide » → « active ». PAS de sim.
- **INTERDIT** de demander un ID @g.us.`;

export const GROUPS_PROSPECT_REDIRECT =
  "Ici on **publie dans le groupe** — pas de messages privés, pas de simulation téléphone.\n\n" +
  "Pour **prospecter les membres en DM**, ouvre **Nouvelle automatisation → Prospection**.\n\n" +
  "Pour poster ici : envoie le **texte exact** à publier + le nom du groupe (admin requis pour l'envoi).";

export const GROUPS_NEED_POST_REPLY =
  "OK — ici on **publie dans tes groupes** (pas de simulation).\n\n" +
  "Envoie le **texte exact** à poster, et le nom du groupe.\n\n" +
  "Pour écrire en privé aux membres → **Nouvelle automatisation → Prospection**.";

/** « prospecter mon groupe X » = DM membres, pas un post dans le groupe. */
export function wantsGroupMemberProspecting(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;
  if (!/\bprospect/i.test(t)) return false;
  if (!/\bgroupes?\b/i.test(t) && !/\bmembres?\b/i.test(t)) return false;
  if (/\b(poste[rz]?|publie[rz]?|envoie[rz]?\s+dans\s+le\s+groupe)\b/i.test(t)) {
    return false;
  }
  return true;
}

/** Consigne / brief — pas le texto à coller dans WhatsApp. */
export function isGroupMetaInstruction(t: string): boolean {
  const s = t.trim();
  if (s.length < 8) return true;
  if (/^(oui|non|ok|okay|valide|je\s+valide|d['’]accord)\b/i.test(s)) return true;
  if (/(?:message|annonce|post|texte)\s*[:\-–]/i.test(s)) return false;
  if (/[«"][^»"]{12,}[»"]/.test(s)) return false;
  return /\b(prospecter|prospection|lancer\s+(une\s+)?campagne|je\s+veux\s+(lancer|prospecter|créer|creer)|cr[eé]e[rz]?\s+(une\s+)?(campagne|diffusion|brouillon)|automatisation)\b/i.test(
    s
  );
}

/** Noms de groupes cités par l'utilisateur. */
export function extractGroupNamesFromHistory(history: AgentMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const name = raw.replace(/[»"].*$/, "").trim();
    if (name.length < 2 || name.length > 80) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(name);
  };

  for (const m of history) {
    if (m.role !== "user") continue;
    const hits = [
      ...m.content.matchAll(
        /\b(?:groupe|groupes?|dans)\s+[«"]?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 .'-]{1,60})/gi
      ),
      ...m.content.matchAll(/[«"]([^»"]{2,60})[»"]/g),
    ];
    for (const h of hits) {
      if (h[1]) push(h[1]);
    }
  }
  return found.slice(0, 8);
}

/**
 * Texte à publier : citation « Message : … » / guillemets, sinon dernier long message user
 * qui n'est pas juste une cible de groupe.
 */
export function extractGroupPostMessage(history: AgentMessage[]): string | null {
  // 1) Labels explicites (prioritaires, même si un « dans le groupe X » suit)
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role !== "user") continue;
    const labeled =
      /(?:message|annonce|post|texte)\s*[:\-–]\s*([\s\S]{8,800})/i.exec(m.content) ||
      /[«"]([^»"]{12,800})[»"]/.exec(m.content);
    if (labeled?.[1]) {
      const t = labeled[1].trim();
      if (t.length >= 8) return t.slice(0, 900);
    }
  }

  // 2) Fallback : long message qui n'est pas une consigne de cible
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role !== "user") continue;
    const t = m.content.trim();
    if (
      t.length >= 24 &&
      t.length <= 900 &&
      !isGroupMetaInstruction(t) &&
      !/^(oui|non|ok|valide|je\s+valide|liste|les\s+groupes)/i.test(t) &&
      !/^(\+|00)?\d[\d\s-]{6,}$/.test(t) &&
      !/\b(dans\s+(le\s+|les\s+|mon\s+|mes\s+)?groupes?|groupe\s+[A-Za-zÀ-ÿ])/i.test(t)
    ) {
      return t;
    }
  }
  return null;
}

/** Étapes J+N extraites (ex. « J+1 : … », « dans 2 jours : … »). */
export function extractGroupSequenceSteps(
  history: AgentMessage[]
): Array<{ delayDays: number; message: string }> {
  const steps: Array<{ delayDays: number; message: string }> = [];
  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const re =
      /(?:J\s*\+\s*(\d+)|dans\s+(\d+)\s*jours?|jour\s+(\d+))\s*[:\-–]\s*([^\n]{8,400})/gi;
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(m.content))) {
      const days = Number(hit[1] || hit[2] || hit[3] || 0);
      const message = hit[4]?.trim();
      if (days >= 1 && message) steps.push({ delayDays: days, message: message.slice(0, 500) });
    }
  }
  const byDay = new Map<number, string>();
  for (const s of steps) byDay.set(s.delayDays, s.message);
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([delayDays, message]) => ({ delayDays, message }));
}

export function userWantsGroupsCampaign(history: AgentMessage[], userMessage: string): boolean {
  const blob = [...history.slice(-12).map((h) => h.content), userMessage].join("\n");
  return /\b(campagne|diffusion|multi[- ]?jours?|sequence|j\s*\+\s*\d|rappel|relance\s+(dans|j\+)|programme[rz]?\s+(une\s+)?(s[eé]rie|campagne))\b/i.test(
    blob
  );
}

/**
 * Nudges Groupes — jamais opener / 5 variantes / support / simulation.
 */
export function buildGroupsBriefingNudge(
  assessment: BriefingAssessment,
  history: AgentMessage[],
  userMessage: string
): string | null {
  if (!assessment.inCampaignFlow) return null;

  if (isGroupNonPublishAction(userMessage)) {
    return (
      "Action membres / invitation / quitter — PAS une publication. " +
      "Exécute manage_group_participants / group_invite / leave_group. " +
      "INTERDIT : « quel texte poster », J+1, je valide, simulation, opener."
    );
  }

  if (wantsGroupMemberProspecting(userMessage)) {
    return (
      "L'utilisateur veut DM les membres (« prospecter le groupe »). " +
      "Dis-lui clairement : ce fil = publier DANS le groupe (pas de sim). " +
      "Pour prospecter en privé → Nouvelle automatisation → Prospection. " +
      "INTERDIT : J+1, je valide, opener, create_automation."
    );
  }

  const wantsCampaign = userWantsGroupsCampaign(history, userMessage);
  const post = extractGroupPostMessage(history);
  const groups = extractGroupNamesFromHistory(history);
  const steps = extractGroupSequenceSteps(history);

  if (!wantsCampaign) {
    if (!post) {
      return (
        "Fil GROUPES : pose UNE question — « Quel **texte** tu veux poster dans le(s) groupe(s) ? » " +
        "INTERDIT : simulation, J+1, 5 variantes, « opener »."
      );
    }
    if (!groups.length) {
      return (
        "Tu as le message. Pose UNE question — « Dans **quel(s) groupe(s)** (où tu es admin) ? » " +
        "Tu peux proposer list_whatsapp_groups (sans admin_only). " +
        "Ensuite : send_whatsapp_message ou schedule_whatsapp_message — admin requis pour l'envoi. " +
        "Pas de create_automation sauf s'il demande une série multi-jours. " +
        "INTERDIT : simulation."
      );
    }
    return (
      "GROUPES — envoi ponctuel prêt. " +
      "**Exécute** send_whatsapp_message (ou schedule_…) vers le(s) groupe(s). " +
      "Si l'utilisateur veut une **série** J+1 / J+3 → demande confirmation puis « je valide » pour group_broadcast. " +
      "INTERDIT : 5 accroches, contact_prospect, keyword_sales, simulation téléphone."
    );
  }

  if (!post) {
    return (
      "Il veut une diffusion mais il n'a pas encore donné le texto. " +
      "Pose UNE question — « Quel **texte** poster dans le groupe ? » " +
      "INTERDIT : J+1, je valide, simulation, opener."
    );
  }
  if (!groups.length) {
    return (
      "Tu as le 1er message. Pose UNE question — « Dans quels groupes admin publier ? » (list_whatsapp_groups admin_only=true OK)."
    );
  }
  if (!steps.length) {
    return (
      "Groupes + message OK. Pose UNE question optionnelle — « Tu veux des posts suivants (ex. J+1, J+3) ? Donne les textes, ou dis non pour un seul post. » " +
      "Puis si prêt : demande **« je valide »** pour créer le brouillon group_broadcast (pas de sim)."
    );
  }
  return (
    "Diffusion GROUPES prête (message + groupes + suite). " +
    "Demande **« je valide »** / **« crée le brouillon »** — le serveur crée type=group_broadcast. " +
    "Ensuite **« active »** pour lancer. INTERDIT : simulation téléphone, 5 variantes, DM membres, support."
  );
}

export function shouldDeterministicGroupsDraft(
  userMessage: string,
  history: AgentMessage[]
): boolean {
  const t = userMessage.trim();
  if (!t || t.length > 140) return false;
  if (isGroupNonPublishAction(t)) return false;
  if (/\b(contacts?|membres?|participants?)\b/i.test(t)) return false;
  if (!userWantsGroupsCampaign(history, userMessage) && !extractGroupPostMessage(history)) {
    return false;
  }
  if (!extractGroupPostMessage(history) || !extractGroupNamesFromHistory(history).length) {
    return false;
  }
  if (
    /^(oui|ouais|ok|okay|d['’]accord|dac|parfait|valide|je\s+valide|c['’]est\s+bon|vas[- ]?y|go)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return /\b(cr[eé]e|cr[eé]er|brouillon|valide|diffusion|lance\s+le\s+brouillon)\b/i.test(t);
}

function parseToolJson(raw: string): {
  ok: boolean;
  error?: string;
  message?: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      success?: boolean;
      error?: string;
      message?: string;
      automationId?: number;
      id?: number;
    };
    if (parsed.error) return { ok: false, error: parsed.error };
    return {
      ok: Boolean(parsed.success || parsed.automationId || parsed.id || parsed.message),
      message: parsed.message,
    };
  } catch {
    return { ok: /success|brouillon|enregistr/i.test(raw), message: raw.slice(0, 400) };
  }
}

/**
 * Brouillon group_broadcast uniquement (pas de simulation).
 */
export async function runDeterministicGroupsDraft(opts: {
  userId: number;
  threadId: number;
  history: AgentMessage[];
  threadTitle?: string | null;
  existingAutomationId?: number | null;
}): Promise<string | null> {
  const { userId, threadId, history, threadTitle, existingAutomationId } = opts;

  const post = extractGroupPostMessage(history);
  const groups = extractGroupNamesFromHistory(history);
  const steps = extractGroupSequenceSteps(history);

  if (!post) {
    return "Il me manque le **texte à publier**. Envoie le message, puis redis « je valide ».";
  }
  if (!groups.length) {
    return (
      "Il me manque le(s) **groupe(s)** (où tu es admin). Donne le nom, puis redis « je valide »."
    );
  }

  const draftArgs: Record<string, unknown> = {
    name: threadTitle?.trim() || "Diffusion groupes",
    type: "group_broadcast",
    status: "draft",
    initial_message: post,
    group_ids: groups,
    personalize_messages: false,
    stickers_enabled: false,
    ...(steps.length ? { sequence_steps: steps } : {}),
    ...(existingAutomationId ? { automation_id: existingAutomationId } : {}),
  };

  const draftRaw = await executeTool(userId, threadId, "create_automation", draftArgs);
  const draft = parseToolJson(draftRaw);
  if (!draft.ok) {
    console.warn("[groups] draft error:", draft.error || draftRaw.slice(0, 240));
    return (
      draft.error ||
      "Impossible d'enregistrer la diffusion groupes. Vérifie que tu es admin des groupes cités, puis réessaie."
    );
  }

  const stepsNote = steps.length
    ? ` + ${steps.length} post(s) suivant(s) (J+${steps.map((s) => s.delayDays).join(", J+")}).`
    : ".";
  return (
    `Parfait — brouillon **diffusion groupes** enregistré (${groups.slice(0, 3).join(", ")})${stepsNote} ` +
    "Dis **« active »** pour lancer les publications (pas de simulation sur ce fil)."
  );
}

/** @deprecated alias — pas de sim ; garde le nom exporté attendu par l'agent. */
export async function runDeterministicGroupsDraftAndSim(opts: {
  userId: number;
  threadId: number;
  client?: unknown;
  businessContext?: string;
  history: AgentMessage[];
  userMessage?: string;
  threadTitle?: string | null;
  existingAutomationId?: number | null;
}): Promise<string | null> {
  return runDeterministicGroupsDraft({
    userId: opts.userId,
    threadId: opts.threadId,
    history: opts.history,
    threadTitle: opts.threadTitle,
    existingAutomationId: opts.existingAutomationId,
  });
}
