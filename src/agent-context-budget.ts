/**
 * Réduction tokens chat agent — compaction historique + configs outils allégées
 * + sélection d'outils par intention. Ne retire aucune capacité métier :
 * les outils hors noyau sont inclus dès qu'ils sont mentionnés / utiles au fil.
 */
import type OpenAI from "openai";
import type { AgentMessage, AutomationConfig } from "./db.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const MAX_MSG_CHARS = 1_800;
const MAX_HISTORY_CHARS = 28_000;

/** Remplace les pavés simu / plan (bruit pour le LLM, utiles seulement à l'UI). */
export function compactAgentMessageContent(content: string): string {
  let text = content ?? "";
  if (!text) return text;

  text = text.replace(
    /```klanvio-sim\b[\s\S]*?```/gi,
    "```klanvio-sim\n[Simulation compactée — affichée sur le téléphone.]\n```"
  );
  text = text.replace(
    /```klanvio-plan\b[\s\S]*?```/gi,
    "```klanvio-plan\n[Plan compacté — détail UI.]\n```"
  );
  // Ancien fence plan éventuel
  text = text.replace(
    /```(?:json)?\s*\{[\s\S]*?"nodes"\s*:\s*\[[\s\S]*?\][\s\S]*?\}[\s\S]*?```/gi,
    "[Plan campagne JSON — détail UI.]"
  );

  // Toi → / Prospect → collé en clair (simu ratée dans le chat)
  if (/^\s*Toi\s*→/m.test(text) && /Prospect\s*→/m.test(text) && text.length > 400) {
    const lines = text.split("\n").filter((l) => /^\s*(Toi|Prospect)\s*→/.test(l));
    if (lines.length >= 4) {
      text = text.replace(
        /(?:^\s*(?:Toi|Prospect)\s*→[^\n]*\n?){4,}/gm,
        `[Fil simulation ${lines.length} tours — déjà sur le téléphone.]\n`
      );
    }
  }

  if (text.length > MAX_MSG_CHARS) {
    text =
      text.slice(0, MAX_MSG_CHARS - 40).trimEnd() +
      "\n…[tronqué pour budget contexte]";
  }
  return text;
}

export function compactAgentHistory(history: AgentMessage[]): AgentMessage[] {
  const compacted = history.map((m) => ({
    ...m,
    content: compactAgentMessageContent(m.content),
  }));

  let total = compacted.reduce((n, m) => n + m.content.length, 0);
  if (total <= MAX_HISTORY_CHARS) return compacted;

  // Garde les plus récents ; résume le reste
  const kept: AgentMessage[] = [];
  let budget = MAX_HISTORY_CHARS;
  for (let i = compacted.length - 1; i >= 0; i--) {
    const m = compacted[i]!;
    const cost = m.content.length + 16;
    if (kept.length > 0 && cost > budget) break;
    kept.unshift(m);
    budget -= cost;
  }
  if (kept.length < compacted.length) {
    kept.unshift({
      id: 0,
      role: "assistant",
      content: `[${compacted.length - kept.length} message(s) plus anciens omis — budget tokens.]`,
      created_at: compacted[0]?.created_at ?? "",
    });
  }
  return kept;
}

/** Config campagne pour le LLM : faits utiles, sans guide/playbook complets (déjà en mémoire système). */
export function slimAutomationConfigForLlm(
  config: AutomationConfig | null | undefined
): Record<string, unknown> | null {
  if (!config) return null;
  const variants = (config.abVariants ?? [])
    .map((v) => String(v.message ?? "").trim())
    .filter(Boolean);
  return {
    initialMessage: config.initialMessage ?? null,
    productName: config.productName ?? null,
    price: config.price ?? null,
    closingLink: config.closingLink ?? null,
    closingGoal: config.closingGoal ?? null,
    triggerPhrases: config.triggerPhrases ?? config.keywords ?? null,
    inboundCatchAll: config.inboundCatchAll ?? false,
    stickersEnabled: config.stickersEnabled ?? false,
    quietHoursStart: config.quietHoursStart ?? null,
    quietHoursEnd: config.quietHoursEnd ?? null,
    handoffKeywords: config.handoffKeywords ?? null,
    thirdPartyNotification: Boolean(config.thirdPartyNotification),
    personalizeMessages: config.personalizeMessages ?? null,
    abVariantsCount: variants.length,
    abVariantsPreview: variants.map((m, i) => `${i + 1}. ${m.slice(0, 72)}${m.length > 72 ? "…" : ""}`),
    conversationGuideChars: config.conversationGuide?.length ?? 0,
    conversationGuideNote:
      "Guide complet = mémoire active (système). Ne pas redemander / recopier ici.",
    livePlaybookTurns: config.livePlaybook?.turns?.length ?? 0,
    openerSnapshot: config.livePlaybook?.openerSnapshot?.slice(0, 120) ?? null,
    relanceCount: config.relance?.messages?.length ?? 0,
    enableAutoReply: config.enableAutoReply ?? null,
  };
}

/**
 * Allège le JSON renvoyé par les tools avant de le réinjecter dans la boucle LLM.
 * L'UI / early-return peuvent encore utiliser le payload brut côté executeTool.
 */
export function slimToolResultForLlm(toolName: string, rawJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    if (rawJson.length > 4_000) {
      return rawJson.slice(0, 4_000) + "…[tronqué]";
    }
    return rawJson;
  }
  if (!parsed || typeof parsed !== "object") return rawJson;
  const obj = parsed as Record<string, unknown>;

  if ("config" in obj && obj.config && typeof obj.config === "object") {
    obj.config = slimAutomationConfigForLlm(obj.config as AutomationConfig);
  }
  if (typeof obj.planDisplay === "string") {
    obj.planDisplay = "[plan affiché à l'utilisateur — omis du contexte LLM]";
  }
  if (typeof obj.display === "string" && /klanvio-sim|Toi\s*→/i.test(obj.display)) {
    obj.display =
      "```klanvio-sim\n[Simulation compactée — affichée sur le téléphone.]\n```";
  }
  if ("_uiDisplay" in obj) {
    delete obj._uiDisplay;
  }
  if (obj.plan && typeof obj.plan === "object") {
    const plan = obj.plan as Record<string, unknown>;
    obj.plan = {
      title: plan.title,
      automationId: plan.automationId,
      type: plan.type,
      openerText:
        typeof plan.openerText === "string"
          ? plan.openerText.slice(0, 160)
          : plan.openerText,
      nodeCount: Array.isArray(plan.nodes) ? plan.nodes.length : undefined,
    };
  }

  // get_group_members : aperçu seulement (create_automation group_prospect utilise le nom/id)
  if (toolName === "get_group_members" && Array.isArray(obj.members)) {
    const members = obj.members as Array<{
      display?: string;
      name?: string | null;
      isAdmin?: boolean;
      id?: string;
    }>;
    const total =
      typeof obj.size === "number"
        ? obj.size
        : typeof obj.shown === "number"
          ? Math.max(Number(obj.shown), members.length)
          : members.length;
    const admins = members.filter((m) => m.isAdmin);
    const preview = members.slice(0, 20).map((m) => ({
      display: m.display ?? m.id ?? "?",
      name: m.name ?? null,
      isAdmin: Boolean(m.isAdmin),
    }));
    delete obj.members;
    obj.display =
      `Groupe « ${String(obj.name ?? "?")} » — ${total} membres` +
      (admins.length ? ` (${admins.length} admin)` : "") +
      `. Aperçu ${preview.length}/${total} (reste omis pour budget tokens). ` +
      `Pour prospecter : create_automation(type=group_prospect, group_id=nom du groupe).`;
    obj.totalMembers = total;
    obj.adminCount = admins.length;
    obj.adminsPreview = admins.slice(0, 8).map((m) => ({
      display: m.display ?? m.id,
      name: m.name ?? null,
    }));
    obj.membersPreview = preview;
    obj.membersOmitted = Math.max(0, total - preview.length);
    obj.hint =
      "Ne recopie PAS tous les numéros. Confirme le total + le nom du groupe. " +
      "create_automation group_prospect avec group_id = nom/id du groupe.";
  }

  // get_automation_report : targets/logs déjà bornés ; config slimée ci-dessus
  if (toolName === "get_automation_report" && Array.isArray(obj.recentLogs)) {
    obj.recentLogs = obj.recentLogs.slice(0, 8);
  }

  const out = JSON.stringify(obj);
  if (out.length > 6_000) {
    return out.slice(0, 6_000) + "…\"}";
  }
  return out;
}

/** Noyau minimal campagne / brief — ~18 outils (pas les ~40 send/admin). */
const PROSPECT_LEAN_TOOL_NAMES = new Set([
  "check_whatsapp_connection",
  "list_whatsapp_groups",
  "get_group_members",
  "get_group_info",
  "list_personal_contacts",
  "list_contacts",
  "list_prospected_contacts",
  "get_outreach_status",
  "save_business_profile",
  "get_business_profile",
  "list_campaign_memories",
  "set_campaign_memory",
  "create_automation",
  "activate_automation",
  "update_automation_config",
  "delete_automation",
  "list_automations",
  "get_automation_report",
  "set_automation_status",
  "show_automation_plan",
  "show_campaign_simulation",
  "list_typeform_forms",
  "list_typeform_responses",
  "list_connected_sheets",
  "read_google_sheet",
]);

const CORE_TOOL_NAMES = new Set([
  ...PROSPECT_LEAN_TOOL_NAMES,
  "list_whatsapp_channels",
  "send_whatsapp_message",
  "schedule_whatsapp_message",
  "message_all_group_members",
  "save_contact",
  "set_auto_reply",
  "block_contact",
  "unblock_contact",
  "check_whatsapp_number",
  "get_contact_conversation",
  "get_daily_bilan",
  "mark_chat_read",
  "search_messages",
]);

const SEND_TOOL_NAMES = new Set([
  "send_whatsapp_message",
  "schedule_whatsapp_message",
  "message_all_group_members",
  "send_whatsapp_media",
  "send_whatsapp_voice",
  "send_whatsapp_sticker",
  "send_whatsapp_status",
  "send_whatsapp_reaction",
  "send_location",
  "send_contact",
  "send_whatsapp_poll",
  "send_whatsapp_list",
  "send_channel_message",
  "send_presence",
]);

const MEDIA_TOOL_NAMES = new Set([
  "send_whatsapp_media",
  "send_whatsapp_voice",
  "send_whatsapp_sticker",
  "send_whatsapp_status",
  "send_whatsapp_reaction",
  "send_location",
  "send_contact",
  "send_whatsapp_poll",
  "send_whatsapp_list",
  "get_message_media",
]);

const GROUP_ADMIN_TOOL_NAMES = new Set([
  "create_whatsapp_group",
  "update_group",
  "manage_group_participants",
  "group_invite",
  "leave_group",
  "create_group_rule",
]);

const PROFILE_PRIVACY_TOOL_NAMES = new Set([
  "update_my_profile",
  "get_privacy_settings",
  "update_privacy_settings",
  "get_contact_profile",
  "get_contact_profile_picture",
  "get_contact_business_profile",
  "get_contact_presence",
  "send_presence",
  "edit_message",
  "delete_message",
  "mark_chat_unread",
  "archive_chat",
  "send_channel_message",
]);

function toolNameOf(t: OpenAI.Chat.Completions.ChatCompletionTool): string | null {
  if (t.type !== "function") return null;
  return t.function.name;
}

/**
 * Plafond de tours LLM+outils selon l'intention.
 * Listes / actions simples → 3–4 ; brief campagne → 6 ; défaut 8 (plus 12).
 */
export function resolveMaxToolRounds(opts: {
  userMessage: string;
  forceSim?: boolean;
  turnMode?: string;
}): number {
  if (opts.forceSim) return 4;
  if (opts.turnMode === "activation_confirm" || opts.turnMode === "silent_tweak") return 4;
  if (opts.turnMode === "decline_sim") return 2;

  const t = opts.userMessage.trim().toLowerCase();
  if (!t) return 6;

  const isListOnly =
    /\b(liste|lister|montre|afficher|voir|bilan|statut|combien)\b/i.test(t) &&
    !/\b(prospect|campagne|crée|creer|activ|simul|automatis)/i.test(t);
  if (isListOnly) return 3;

  if (
    /\b(envoie|envoyer|programme|schedule|message)\b/i.test(t) &&
    !/\b(prospect|campagne|automatis|simul)/i.test(t)
  ) {
    return 4;
  }

  if (/\b(prospect|campagne|brief|accroche|variante|automatis|simul)/i.test(t)) {
    return 6;
  }

  return 8;
}

/**
 * Sous-ensemble d'outils pour le tour — le noyau campagne/WhatsApp reste toujours là.
 * Les outils rares (média, admin groupe, privacy) s'ajoutent si le fil / message les évoque.
 */
export function selectToolsForAgentTurn(opts: {
  purpose: string | null | undefined;
  userMessage: string;
  recentHistory: AgentMessage[];
}): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const blob = [
    opts.userMessage,
    ...opts.recentHistory.slice(-8).map((m) => m.content),
  ]
    .join("\n")
    .toLowerCase();

  const wantsProspectLean =
    opts.purpose === "prospection" ||
    opts.purpose === "support" ||
    /\b(prospect|campagne|accroche|variante|brief|automatisation|simul|closing|support)/i.test(
      blob
    );

  const needed = new Set(wantsProspectLean ? PROSPECT_LEAN_TOOL_NAMES : CORE_TOOL_NAMES);

  if (
    /\b(envoie|envoyer|programme|schedule|poste|publie|message[_ ]all)\b/i.test(blob) ||
    opts.purpose === "groupes"
  ) {
    for (const n of SEND_TOOL_NAMES) {
      if (CORE_TOOL_NAMES.has(n) || MEDIA_TOOL_NAMES.has(n)) needed.add(n);
    }
    needed.add("send_whatsapp_message");
    needed.add("schedule_whatsapp_message");
    needed.add("message_all_group_members");
  }

  // Admin groupe : purpose groupes OU action admin explicite (pas le seul mot « groupe »)
  if (
    opts.purpose === "groupes" ||
    /\b(crée(r)?\s+(un\s+)?groupe|invitation|quitter\s+le\s+groupe|promouvoi|rétrograd|ajoute\s+au\s+groupe|retire\s+du\s+groupe|admin\s+du\s+groupe)\b/i.test(
      blob
    )
  ) {
    for (const n of GROUP_ADMIN_TOOL_NAMES) needed.add(n);
  }

  if (
    /\b(sticker|média|media|image|photo|vid[eé]o|document|pdf|vocal|voix|audio|sondage|poll|localisation|gps|carte contact|vcard|statut|status whatsapp|r[eé]agir|r[eé]action)\b/i.test(
      blob
    )
  ) {
    for (const n of MEDIA_TOOL_NAMES) needed.add(n);
  }

  if (
    /\b(confidentialit[eé]|privacy|photo de profil|mon profil|pr[eé]sence|en train d.?[eé]crire|modifier (le )?message|supprimer (le )?message|archiver|non lu|cha[iî]ne)\b/i.test(
      blob
    )
  ) {
    for (const n of PROFILE_PRIVACY_TOOL_NAMES) needed.add(n);
  }

  for (const t of TOOL_DEFINITIONS) {
    const name = toolNameOf(t);
    if (!name || needed.has(name)) continue;
    if (blob.includes(name.toLowerCase())) needed.add(name);
  }

  const selected = TOOL_DEFINITIONS.filter((t) => {
    const name = toolNameOf(t);
    return name != null && needed.has(name);
  });

  if (selected.length > 0) return selected;
  return TOOL_DEFINITIONS.filter((t) => {
    const name = toolNameOf(t);
    return name != null && PROSPECT_LEAN_TOOL_NAMES.has(name);
  });
}
