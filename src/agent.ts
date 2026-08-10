import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import {
  getAppSettings,
  getAgentThread,
  getAutomation,
  getOutreachQuotaSnapshot,
  getRecentAgentMessages,
  listAutomations,
  tryConsumeTrialGroupExtract,
  type AgentMessage,
  type AppSettings,
} from "./db.js";
import { testEvolutionConnection, listWhatsAppGroups, listPersonalContacts, chatIdToDisplay, findGroupByNameOrId, getGroupMembers } from "./evolutionapi.js";
import { executeTool } from "./tools.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import {
  createLlmClient,
  llmProviderLabel,
  toAssistantHistoryMessage,
  extractAssistantContent,
  createLlmClientForRole,
  llmExtrasForProvider,
  recommendedMaxTokensForProvider,
  resolveLlmRoleModel,
  resolveLlmRoleProvider,
  sanitizeAssistantToolCalls,
  sanitizeToolCallArgumentsJson,
} from "./llm.js";
import {
  runDeterministicActivation,
  runDeterministicDraftAndSim,
  runDeterministicSupportDraftAndSim,
  runDeterministicGroupsDraft,
  runDeterministicSimulation,
  shouldDeterministicActivate,
  shouldDeterministicSimulate,
  shouldDeterministicSupportDraft,
  shouldDeterministicGroupsDraft,
  POWER_CAMPAIGN_TOOLS,
} from "./deterministic-campaign.js";
import { SUPPORT_FIL_SYSTEM_ADDENDUM } from "./support-flow.js";
import { GROUPS_FIL_SYSTEM_ADDENDUM } from "./groups-flow.js";
import {
  assessCampaignBriefing,
  buildBriefingNudge,
  hasNumberedOpenerList,
  buildMissingMemoryNudge,
  buildThreadCampaignBlockNudge,
  isShortCampaignValidation,
} from "./campaign-briefing.js";
import {
  hasSimulationThread,
  isActivationNegation,
  recentHistoryHasSimulation,
  resolveSimulationTurnMode,
  shouldBlockDuplicateSimulation,
} from "./simulation-gate.js";
import {
  formatVerticalContactList,
  formatVerticalGroupList,
  formatVerticalMemberList,
  userFacingError,
} from "./user-facing.js";
import {
  formatMemoryForAgent,
  getLinkedCampaignMemory,
} from "./campaign-memory.js";
import {
  detectQuickGroupMembersIntent,
  detectQuickListIntent,
  isGroupActionNotCatalogRequest,
  wantsExplicitGroupCatalog,
} from "./group-list-intent.js";
import {
  compactAgentHistory,
  selectToolsForAgentTurn,
  slimToolResultForLlm,
} from "./agent-context-budget.js";
import {
  containsDsmlToolMarkup,
  DSML_RETRY_NUDGE,
  parseDsmlToolCalls,
  stripDsmlMarkup,
  userSafeAssistantText,
} from "./dsml-tool-calls.js";

/** Tours LLM+outils par message utilisateur. 5 était trop bas (Sheet → vérifs → envois). */
const MAX_TOOL_ROUNDS = 12;
/** 18 + compaction : assez de fil conducteur sans pavés simu/plan. */
const CHAT_HISTORY_LIMIT = 18;

const MEMORY_REQUIRED_REPLY =
  "Avant de continuer, connecte une **mémoire** à cette automatisation.\n\n" +
  "👉 Clique sur le bouton **Mémoire** (à côté du micro ou en haut du chat), " +
  "choisis ou crée une mémoire avec tes instructions, puis renvoie ton message.\n\n" +
  "Sans mémoire liée à ce fil, je ne peux ni briefer ni lancer de campagne.";
const CHAT_MAX_TOKENS = 1100;

/**
 * Détecte une réponse « amorce vide » : le modèle annonce un contenu
 * (phrase se terminant par «\u00A0:\u00A0») puis s'arrête sans le fournir.
 */
function isDanglingAnnouncement(text: string): boolean {
  const t = text.replace(/\s+$/u, "");
  return /[:：]$/u.test(t);
}

/** L'utilisateur a explicitement demandé la liste du carnet WhatsApp. */
function userExplicitlyAskedContactBook(msg: string): boolean {
  const t = msg.trim().toLowerCase();
  if (!t) return false;
  // Numéros précis à prospecter → jamais le carnet
  if (/\+?\d[\d\s.\-]{7,}\d/.test(t) && /\bprospect/i.test(t)) return false;
  if (/\bprospect(er|e|e[sz])?\b/i.test(t) && !/\b(liste|carnet|tous mes contacts)\b/i.test(t)) {
    return false;
  }
  return (
    /\b(contacts?|carnet)\b/i.test(t) &&
    /\b(liste|lister|montre|afficher|voir|extraire|tous|mes|carnet)\b/i.test(t) &&
    !/\b(du|de|dans)\s+(?:le\s+)?groupe\b/i.test(t)
  );
}

const ACTIVATION_AFTER_SIMULATION_NUDGE =
  "L'utilisateur a VALIDÉ la simulation (contenu OK). INTERDIT de rappeler show_campaign_simulation. " +
  "INTERDIT d'appeler activate_automation tout de suite. " +
  "Étape suivante : dans CE chat, demande clairement s’il veut **activer maintenant** " +
  "ou s’il a encore des **modifications** (accroche, ton, relances…). " +
  "N'appelle activate_automation QUE si l'utilisateur répond clairement oui / lance / active / vas-y. " +
  "S’il veut des modifs → update_automation_config, **confirme d'abord** ce qui a changé (valeur concrète), " +
  "puis propose doucement « refais la simulation » ou « c'est bon » pour activer — INTERDIT de régénérer une simulation tout seul. " +
  "Il peut aussi cliquer **Lancer** dans l'en-tête. Activer = simulation déjà validée.";

const CONFIRM_ACTIVATE_NOW_NUDGE =
  "L'utilisateur CONFIRME l'activation (après ta question activer / autres modifs). " +
  "Appelle MAINTENANT activate_automation. INTERDIT de reposer la question. INTERDIT de re-simuler. " +
  "INTERDIT de redemander de Valider la simulation — l’activation suffit.";

const FORCE_SIMULATION_NUDGE =
  "L'utilisateur a ACCEPTÉ / demandé une simulation. Tu DOIS appeler l'outil show_campaign_simulation MAINTENANT " +
  "avec exactement 6 ou 7 tours (speaker toi/prospect, textes réels SANS crochets). " +
  "Le 1er tour « toi » = l'accroche validée (initial_message) — même texte / style qu'il a validé " +
  "(Attention recommandé ; si risque accepté, garde SON format même avec prix/lien). " +
  "Les tours suivants : même mission / pacing (pousser l'intérêt, pas de « Ah super » / « Super. » vide), vouvoiement, sans prénom du prospect à tout va. " +
  "Identité = prénom + pourquoi ; sur oui/ok = question ou détail nouveau (pas pitch immédiat sauf si déjà dans l'opener validé). " +
  "La simulation s'affiche UNIQUEMENT sur le **téléphone à droite** — INTERDIT de recopier le fil Toi → / Prospect → dans ta réponse chat. " +
  "Après l'outil : confirme en 1–2 phrases courtes (le footer de l'outil guide déjà le feedback). " +
  "INTERDIT d'annoncer sans outil. INTERDIT de dépasser 7 messages. " +
  "INTERDIT ABSOLU d'appeler send_whatsapp_message / send_whatsapp_* / schedule_* / message_all_* : " +
  "aucun envoi WhatsApp réel.";

const DECLINE_SIMULATION_NUDGE =
  "L'utilisateur REFUSE la simulation (non / pas maintenant / sans simu…). " +
  "INTERDIT d'appeler show_campaign_simulation. INTERDIT d'insister. " +
  "Accepte en 1–2 phrases. Pour activer SANS sim, il DOIT écrire clairement « lance sans simulation » " +
  "(ou « active sans simu ») — INTERDIT d'activer sur un simple « lance » / « active » sans cette phrase. " +
  "Sinon propose « simule » plus tard. N'appelle PAS activate_automation sauf phrase explicite sans simulation.";

/** Après une simu déjà là : modifs / questions = pas de nouveau fil ni de fenêtre. */
const SILENT_TWEAK_AFTER_SIM_NUDGE =
  "Une simulation a DÉJÀ été montrée. L'utilisateur demande une modification ou pose une question. " +
  "INTERDIT d'écrire un fil Toi → / Prospect → dans le chat. " +
  "INTERDIT de coller un planDisplay / fence de plan dans ta réponse. " +
  "Si modif (fenêtre horaire, ton, accroche, prix, relances, vouvoiement…) → appelle **d'abord** update_automation_config. " +
  "Fenêtre d'activité « 6h–15h » → send_window_start=6, send_window_end=15 (pas quiet_hours à l'envers). " +
  "Confirme la modif **uniquement** si l'outil renvoie success:true — cite configSummary.sendWindow / la valeur renvoyée. " +
  "INTERDIT de dire « Fenêtre changée » / « c'est bon » si l'outil a échoué ou n'a pas été appelé. " +
  "Si c'est seulement « c'est fait ? » → vérifie via get_automation / configSummary, puis OUI ou NON + détail. " +
  "**INTERDIT** de répondre uniquement par « Veux-tu activer la campagne maintenant ? » sans confirmer la modif. " +
  "Ensuite seulement, une proposition **douce et optionnelle** : « Tu peux refaire la simulation, ou dire c'est bon. » " +
  "INTERDIT d'appeler show_campaign_simulation sauf demande explicite (« refais la simulation », « reteste »). " +
  "Si question seule (sans demande de modif) → réponds clairement, sans outil de simulation.";

/** Outils d'envoi réel — bloqués pendant une demande de simulation. */
const OUTBOUND_SEND_TOOLS = new Set([
  "send_whatsapp_message",
  "send_whatsapp_media",
  "send_whatsapp_voice",
  "send_whatsapp_sticker",
  "send_whatsapp_poll",
  "send_whatsapp_list",
  "send_whatsapp_status",
  "send_whatsapp_reaction",
  "send_location",
  "send_contact",
  "send_channel_message",
  "schedule_whatsapp_message",
  "message_all_group_members",
]);

/**
 * Détecte une annonce de simulation / aperçu de conversation SANS le fil.
 * Couvre aussi « Voici comment la conversation pourrait se dérouler… : » (bug récurrent).
 */
function isBrokenSimulationPreview(text: string): boolean {
  const t = text.trim();
  const announces =
    /\b(simulation|simuler|d[ée]rouler|ressemblerait|fil de discussion|voici comment|avec cette approche|commen[çc]ons|d[ée]marr\w*|lan[çc]ons|d[ée]butons)\b/i.test(
      t
    ) || /\bconversation\b.{0,40}\b(d[ée]rouler|ressembl)/i.test(t);
  if (!announces) return false;
  if (hasSimulationThread(t)) return false;
  if (isDanglingAnnouncement(t)) return true;
  return t.length < 450;
}

/** Client chat principal = MiniMax (dialogue + boucle outils agent). */
async function getChatLlmClient(userId: number): Promise<OpenAI> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) {
    throw new Error(
      `Clé ${llmProviderLabel()} manquante. Définissez MINIMAX_API_KEY sur le serveur.`
    );
  }
  return createLlmClient(key);
}

/**
 * Client Claude = génération de simulation uniquement (filet, comme DeepSeek avant).
 * Fallback MiniMax si ANTHROPIC_API_KEY absente.
 */
async function getSimLlmClient(userId: number): Promise<OpenAI> {
  if (config.toolLlmConfigured && config.toolLlmApiKey) {
    return createLlmClientForRole("tools", config.toolLlmApiKey);
  }
  console.warn("[agent] ANTHROPIC_API_KEY absente — simulation via MiniMax (chat)");
  return getChatLlmClient(userId);
}

async function buildBusinessContext(
  userId: number,
  settings: AppSettings,
  connection: { connected: boolean; state: string; message: string },
  threadId: number
): Promise<string> {
  const lines: string[] = [];
  lines.push(
    `## État WhatsApp\n${
      connection.connected
        ? "WhatsApp est connecté — les outils d'envoi sont disponibles."
        : `WhatsApp NON connecté (état : ${connection.state}). ${connection.message} Les outils qui envoient des messages échoueront tant que la connexion n'est pas établie — invite l'utilisateur à reconnecter WhatsApp via Paramètres (popup QR).`
    }`
  );
  lines.push(
    `## Profil business (indice optionnel — PAS source de vérité campagne)\n` +
      `Nom : ${settings.business_owner_name || "(non configuré — ne pas inventer)"}\n` +
      `Offre enregistrée (peut être obsolète) : ${settings.business_offer || "(non configuré)"}\n` +
      `Tarif : ${settings.business_price || "(non communiqué)"}\n` +
      `Nouvelle campagne → question ouverte sur l'offre actuelle. Utilise offre/prix ici SEULEMENT si confirmés dans CE chat. Mémoire active = priorité.`
  );

  try {
    const quota = await getOutreachQuotaSnapshot(userId);
    lines.push(
      `## Niveau & plafonds Klanvio (SOURCE DE VÉRITÉ — ne jamais inventer d'autres chiffres)\n` +
        `${quota.summaryForAgent}\n\n` +
        `Si l'utilisateur demande « combien de messages max », « mon niveau », « mon quota » → ` +
        `réponds avec CES chiffres (ou rappelle get_outreach_status). ` +
        `Distingue clairement : (1) niveau lifetime, (2) nouveaux fils / jour, (3) messages illimités dans un fil déjà ouvert. ` +
        `Pour une campagne, \`max_per_day\` ne doit pas dépasser le restant de nouveaux fils sortants du jour.`
    );
  } catch {
    /* ignore */
  }

  try {
    const thread = await getAgentThread(userId, threadId);
    if (thread?.purpose === "support") {
      lines.push(
        `## TYPE DE FIL — SUPPORT CLIENT (OBLIGATOIRE)\n` +
          `Ce fil a été créé en mode **Support client**. Le client écrit en premier.\n` +
          `- create_automation UNIQUEMENT avec type=\`keyword_sales\` et mode=\`inbound_closing\`.\n` +
          `- **Deux sous-modes** :\n` +
          `  1. Phrases déclencheurs : \`trigger_phrases\` non vides, \`inbound_catch_all\` omis/false.\n` +
          `  2. Compte WhatsApp entier : si l'utilisateur veut gérer **tous** ses messages → \`inbound_catch_all=true\` + \`trigger_phrases=[]\`.\n` +
          `- INTERDIT de refuser le mode « tous les messages » : c'est une capacité officielle.\n` +
          `- INTERDIT : contact_prospect, group_prospect, premier message de contact sortant, 5 variantes d'accroche.\n` +
          `- Questions utiles : produit/activité, portée (déclencheurs OU tout le compte), infos à donner, objectif, présentation, stickers, notif tiers, handoff.\n` +
          `- INTERDIT de demander délais entre messages, vagues de 50, gap entre vagues ou plage anti-blocage — défauts système automatiques.\n` +
          `- Commence le brief par une question ouverte sur le produit / ce que tu dois répondre — PAS « quel premier message envoyer ».\n` +
          `- Quand le brief est prêt : demande **« je valide »** / **« crée le brouillon »** (le serveur crée le brouillon + sim inbound). ` +
          `N'invente pas d'args MiniMax pour create_automation.\n` +
          `- **INTERDIT ABSOLU** de prétendre « basculer » ce fil en Prospection. Le purpose est fixé. ` +
          `Si l'utilisateur veut prospecter (groupes / contacts) → dis-lui clairement d'ouvrir **Nouvelle automatisation** ` +
          `dans la barre latérale et de choisir **Prospection**.`
      );
      lines.push(SUPPORT_FIL_SYSTEM_ADDENDUM);
    } else if (thread?.purpose === "prospection") {
      lines.push(
        `## TYPE DE FIL — PROSPECTION (OBLIGATOIRE)\n` +
          `Ce fil a été créé en mode **Prospection**. Vous contactez les prospects en premier.\n` +
          `- create_automation UNIQUEMENT avec type=\`contact_prospect\` ou \`group_prospect\` (mode \`outbound_prospect\`).\n` +
          `- INTERDIT : keyword_sales / inbound_closing / questions « phrase déclencheur » comme flux principal.\n` +
          `- Suivre le brief sortant : offre, cible, planning, premier message souhaité, **UNE accroche** à valider, puis **5 variantes** (rotation).\n` +
          `- INTERDIT de demander notif tiers / mots-clés handoff (remboursement, plainte…) — réservé au **Support**.\n` +
          `- **INTERDIT ABSOLU** de prétendre « basculer » ce fil en Support. Pour du support entrant → ` +
          `**Nouvelle automatisation** → **Support client**.`
      );
    } else if (thread?.purpose === "groupes") {
      lines.push(
        `## TYPE DE FIL — GROUPES WHATSAPP (OBLIGATOIRE)\n` +
          `Ce fil gère les **groupes** où le compte est **administrateur** (publier, programmer, membres).\n` +
          `- **INTERDIT** de demander un ID @g.us — toujours le **nom** du groupe.\n` +
          `- Ajouter/retirer : \`manage_group_participants(group_id=nom, action, participants)\` dès que nom + numéro sont connus.\n` +
          `- Si le nom manque → UNE question « Dans quel groupe ? » (pas « donne l'ID »).\n` +
          `- Envoi immédiat : \`send_whatsapp_message\` (recipient = nom du groupe). **Ne passe PAS** par save_contact / prospects / get_group_members.\n` +
          `- Programmation : \`schedule_whatsapp_message\` (delay_minutes OU send_at_local) vers le groupe — même si plusieurs horaires, appelle l'outil plusieurs fois.\n` +
          `- INTERDIT d'appeler get_group_members quand l'utilisateur demande d'envoyer/programmer un message dans le groupe.\n` +
          `- Campagne multi-jours (optionnelle) : create_automation type=\`group_broadcast\` — demande **« je valide »** (serveur crée le brouillon).\n` +
          `- list_whatsapp_groups avec admin_only=true — pour lister ou lever une ambiguïté de nom.\n` +
          `- Si l'outil renvoie une erreur « pas administrateur » → refuse clairement, ne contourne pas.\n` +
          `- INTERDIT : contact_prospect, group_prospect (DM membres), keyword_sales / inbound, save_contact sur un @g.us.\n` +
          `- INTERDIT : 5 variantes d'accroche, A.I.D.A. cold, questions stickers/handoff support.\n` +
          `- Stats = messages envoyés vs restants (une cible = un groupe).\n` +
          `- Pour prospecter des membres en DM ou du support → **Nouvelle automatisation** avec le bon type.`
      );
      lines.push(GROUPS_FIL_SYSTEM_ADDENDUM);
    }

    // Liste compte (noms) — pour orienter, PAS pour modifier depuis un autre fil
    try {
      const allAutos = await listAutomations(userId, { limit: 30 });
      if (allAutos.length > 0) {
        const typeLabel: Record<string, string> = {
          group_prospect: "prospection groupe",
          contact_prospect: "prospection contacts",
          keyword_sales: "support / closing entrant",
          custom_followup: "suivi",
          group_broadcast: "diffusion groupes",
        };
        const linesAuto = allAutos.slice(0, 12).map((a) => {
          const linkedHere = thread?.automation_id === a.id ? " ← CE FIL" : "";
          return `- « ${a.name} » [${a.status}] ${typeLabel[a.type] ?? a.type}${linkedHere}`;
        });
        const more =
          allAutos.length > 12 ? `\n(+${allAutos.length - 12} autres — list_automations si besoin)` : "";
        lines.push(
          `## Campagnes (compte)\n` +
            `${linesAuto.join("\n")}${more}\n` +
            `Modifier/activer = seulement « CE FIL ». Autre fil → barre latérale. Pas d'id numérique à l'utilisateur.`
        );
      } else {
        lines.push(
          `## Campagnes existantes (compte)\nAucune campagne sur ce compte pour l'instant.`
        );
      }
    } catch {
      /* ignore */
    }

    if (thread?.description?.trim()) {
      lines.push(
        `## Objectif de cette automatisation\n${thread.description.trim()}\n\n` +
          `Utilise cette description comme fil conducteur pour le briefing et la simulation.`
      );
    }
    if (thread?.automation_id) {
      const auto = await getAutomation(userId, thread.automation_id);
      if (auto) {
        lines.push(
          `## Campagne de ce fil (unique)\n` +
            `« ${auto.name} » [${auto.status}] type=${auto.type}\n\n` +
            `Ce fil ne gère qu'UNE automatisation. Pour une nouvelle campagne → l'utilisateur doit cliquer « Nouvelle automatisation » dans la barre latérale.\n` +
            `Modifications → update_automation_config (ne cite JAMAIS d'identifiant numérique de campagne à l'utilisateur).\n` +
            `« Lancer / activer » → activate_automation sur CETTE campagne.`
        );
        if (auto.config.initialMessage?.trim()) {
          const variants = (auto.config.abVariants ?? [])
            .map((v) => ({ id: v.id, message: v.message?.trim() || "" }))
            .filter((v) => v.message)
            .slice(0, 5);
          lines.push(
            `## Accroches validées (1er message)\n` +
              `initial_message (variante de référence / simu) :\n« ${auto.config.initialMessage.trim()} »\n` +
              (variants.length === 5
                ? `ab_variants (les 5 — rotation à l'envoi, ne pas en supprimer) :\n` +
                  variants.map((v, i) => `${i + 1}. [${v.id}] « ${v.message} »`).join("\n") +
                  `\nSi l'utilisateur change l'accroche de référence : update avec initial_message=nouvelle ET ab_variants=les 5 textes (éventuellement régénérés).`
                : variants.length
                  ? `⚠ Seulement ${variants.length}/5 variantes en config — corrige via update_automation_config avec les 5 textes complets.`
                  : `⚠ Aucune ab_variants — OBLIGATOIRE d'enregistrer les 5 accroches proposées (pas seulement initial_message).`)
          );
        }
      }
    } else {
      lines.push(
        `## Fil vide\n` +
          `Aucune campagne liée à ce fil.\n` +
          `- « Lancer une campagne » / « nouvelle » → briefing puis create_automation (type compatible avec le purpose du fil).\n` +
          `- « Une existante » / « modifier » → si des campagnes apparaissent ci-dessus : liste-les par **nom**, ` +
          `explique qu'elles vivent dans **leur fil** de la barre latérale, et invite à ouvrir le bon fil. ` +
          `Ne propose PAS de les modifier ici. Ne dis PAS « donne-moi son numéro ».\n` +
          `- **INTERDIT** de prétendre changer le mode Support ↔ Prospection de ce fil.`
      );
    }
  } catch {
    /* ignore */
  }

  try {
    const memory = await getLinkedCampaignMemory(userId, threadId);
    if (memory) {
      lines.push(formatMemoryForAgent(memory));
    } else {
      lines.push(
        `## Mémoire campagne — NON CONNECTÉE\n` +
          `Aucune mémoire n'est liée à CE fil. Ne continue PAS le brief produit et n'appelle PAS create_automation.\n` +
          `Demande à l'utilisateur de cliquer sur le bouton **Mémoire** en haut du chat pour choisir ou créer une mémoire avant de continuer.`
      );
    }
  } catch {
    /* ignore */
  }

  return lines.join("\n\n");
}

function toOpenAiMessages(history: AgentMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export async function chatWithAgent(userId: number, userMessage: string, threadId: number): Promise<string> {
  const connection = await testEvolutionConnection(userId);
  if (!connection.connected) {
    return (
      "⚠️ **WhatsApp n'est pas connecté.**\n\n" +
      "Je ne peux effectuer **aucune action** tant que votre numéro WhatsApp n'est pas relié à Klanvio.\n\n" +
      "👉 Allez dans **Réglages → Connexion WhatsApp**, scannez le QR code avec votre téléphone " +
      "(WhatsApp → Appareils connectés), puis revenez me parler.\n\n" +
      `État actuel : ${connection.message || connection.state}`
    );
  }

  // Chemin rapide : extraction membres d'un groupe nommé
  const membersQuick = detectQuickGroupMembersIntent(userMessage);
  if (membersQuick) {
    try {
      const found = await findGroupByNameOrId(userId, membersQuick.groupQuery);
      if (!found) {
        return (
          `Groupe introuvable : « ${membersQuick.groupQuery} ».\n\n` +
          `Vérifiez le nom exact (copier-coller depuis WhatsApp) ou demandez « liste mes groupes ».`
        );
      }
      const trialGate = await tryConsumeTrialGroupExtract(userId, found.id);
      if (!trialGate.ok) {
        return trialGate.reason;
      }
      const data = await getGroupMembers(userId, found.id);
      const allMembers = data.participants.map((p) => ({
        display: chatIdToDisplay(p.id),
        name: p.name ?? null,
        isAdmin: p.isAdmin ?? false,
      }));
      const limit = membersQuick.limit;
      const members =
        limit != null && limit > 0 ? allMembers.slice(0, limit) : allMembers;
      return formatVerticalMemberList(data.subject || found.name, members, {
        total: allMembers.length,
      });
    } catch (err) {
      return userFacingError(err);
    }
  }

  // Chemin rapide : listes groupes / contacts (évite timeouts LLM+outils sur gros comptes)
  const quick = detectQuickListIntent(userMessage);
  if (quick?.kind === "groups") {
    try {
      const groups = await listWhatsAppGroups(userId);
      const sliced = quick.limit != null ? groups.slice(0, quick.limit) : groups;
      if (!sliced.length) {
        return "Aucun groupe WhatsApp trouvé sur ce compte pour le moment.";
      }
      return formatVerticalGroupList(sliced.map((g) => ({ name: g.name, id: g.id })));
    } catch (err) {
      return userFacingError(err);
    }
  }
  if (quick?.kind === "contacts") {
    try {
      const contacts = await listPersonalContacts(userId, quick.limit ?? 50);
      const mapped = contacts.map((c) => ({
        name: c.name,
        phone: c.id,
        display: chatIdToDisplay(c.id),
      }));
      return formatVerticalContactList(mapped, "contacts WhatsApp");
    } catch (err) {
      return userFacingError(err);
    }
  }

  // Garde-fou serveur : sans mémoire liée, pas de brief / proposition LLM
  const linkedMemoryEarly = await getLinkedCampaignMemory(userId, threadId).catch(() => null);
  if (!linkedMemoryEarly) {
    return MEMORY_REQUIRED_REPLY;
  }

  const client = await getChatLlmClient(userId);
  const [settings, historyRaw, thread] = await Promise.all([
    getAppSettings(userId),
    getRecentAgentMessages(userId, threadId, CHAT_HISTORY_LIMIT),
    getAgentThread(userId, threadId),
  ]);
  const history = compactAgentHistory(historyRaw);

  const businessContext = await buildBusinessContext(userId, settings, connection, threadId);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: businessContext },
    ...toOpenAiMessages(history),
  ];

  const last = history[history.length - 1];
  if (!last || last.role !== "user" || last.content !== userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  const threadBlock = buildThreadCampaignBlockNudge(thread?.automation_id ?? null, userMessage);
  if (threadBlock) {
    messages.push({ role: "system", content: threadBlock });
  }

  const linkedMemory = await getLinkedCampaignMemory(userId, threadId).catch(() => null);
  const memoryNudge = buildMissingMemoryNudge(
    linkedMemory != null,
    userMessage,
    history,
    thread?.purpose ?? null
  );
  if (memoryNudge) {
    messages.push({ role: "system", content: memoryNudge });
  }

  // Rappel court : fidélité mémoire (détail déjà dans businessContext)
  if (linkedMemory) {
    messages.push({
      role: "system",
      content:
        `Mémoire « ${linkedMemory.name} » = source de vérité (rechargée ce tour). ` +
        `Exécute exactement la demande utilisateur ; une question max si info critique manquante.`,
    });
  }

  const activeMemory = linkedMemory;
  const briefing = assessCampaignBriefing(
    history,
    userMessage,
    thread?.purpose ?? null,
    activeMemory
  );
  const hasSimAlready = recentHistoryHasSimulation(history);
  const turnMode = resolveSimulationTurnMode(history, userMessage);
  const forceSim = turnMode === "force_sim";
  const silentTweakAfterSim = turnMode === "silent_tweak";

  const toolsForTurn = selectToolsForAgentTurn({
    purpose: thread?.purpose,
    userMessage,
    recentHistory: history,
  }).filter(
    (t) =>
      t.type !== "function" ||
      !POWER_CAMPAIGN_TOOLS.has(String(t.function?.name ?? ""))
  );

  // ── Routeur déterministe (pas de boucle LLM) ─────────────────────────────
  // Négation explicite (« n'active pas ») — jamais d'activation
  if (isActivationNegation(userMessage) && /\b(active|activer|lance|lancer|campagne|automatisation)\b/i.test(userMessage)) {
    return (
      "D'accord — **je n'active pas**. " +
      "Quand tu seras prêt : « active » après la simulation, ou clairement « lance sans simulation »."
    );
  }

  const bareValidation =
    isShortCampaignValidation(userMessage) &&
    !/\b(lance|lancer|active|activer|démarre|demarre)\b/i.test(userMessage);

  // Support : brouillon + sim déterministes (pas MiniMax)
  if (
    briefing.isInboundClosing &&
    shouldDeterministicSupportDraft(userMessage, {
      readyForDraft: briefing.readyForDraft,
      stickersOk: briefing.stickersQuestionAsked,
      thirdPartyOk: briefing.thirdPartyQuestionAsked,
      handoffOk: briefing.handoffKeywordsQuestionAsked,
    }) &&
    !hasSimAlready &&
    !shouldDeterministicActivate(history, userMessage)
  ) {
    try {
      const drafted = await runDeterministicSupportDraftAndSim({
        userId,
        threadId,
        client: await getSimLlmClient(userId),
        businessContext,
        history,
        userMessage,
        threadTitle: thread?.title,
        existingAutomationId: thread?.automation_id ?? null,
        inboundCatchAll: briefing.inboundCatchAll,
      });
      if (drafted) return drafted;
    } catch (err) {
      console.warn("[agent] support draft/sim failed:", err);
    }
  }

  // Groupes : brouillon group_broadcast (pas de sim)
  if (
    briefing.isGroupsFlow &&
    shouldDeterministicGroupsDraft(userMessage, history) &&
    !shouldDeterministicActivate(history, userMessage)
  ) {
    try {
      const drafted = await runDeterministicGroupsDraft({
        userId,
        threadId,
        history,
        threadTitle: thread?.title,
        existingAutomationId: thread?.automation_id ?? null,
      });
      if (drafted) return drafted;
    } catch (err) {
      console.warn("[agent] groups draft failed:", err);
    }
  }

  // « oui » après les 5 variantes → brouillon + sim AVANT toute tentative d'activation
  // (évite le faux positif : guillemets + « simulation » + « je lance » → activate sans campagne)
  if (
    !briefing.isInboundClosing &&
    !briefing.isGroupsFlow &&
    briefing.openerVariantsProposed &&
    isShortCampaignValidation(userMessage) &&
    !hasSimAlready
  ) {
    try {
      const drafted = await runDeterministicDraftAndSim({
        userId,
        threadId,
        client: await getSimLlmClient(userId),
        businessContext,
        history,
        userMessage,
        purpose: thread?.purpose,
        threadTitle: thread?.title,
        existingAutomationId: thread?.automation_id ?? null,
      });
      if (drafted) return drafted;
    } catch (err) {
      console.warn("[agent] fast path variants→draft/sim:", err);
    }
  }

  // Activation : « lancer » / « active » / oui après vraie question d'activation
  if (
    shouldDeterministicActivate(history, userMessage) &&
    !(bareValidation && !hasSimAlready)
  ) {
    try {
      const activated = await runDeterministicActivation({
        userId,
        threadId,
        history,
        userMessage,
      });
      if (activated) return activated;
    } catch (err) {
      console.warn("[agent] deterministic activate failed:", err);
    }
  }

  // Simulation déterministe (Claude) — pas MiniMax — PAS pour Groupes
  if (
    !briefing.isGroupsFlow &&
    thread?.purpose !== "groupes" &&
    (shouldDeterministicSimulate(history, userMessage) || forceSim)
  ) {
    try {
      const sim = await runDeterministicSimulation({
        userId,
        threadId,
        client: await getSimLlmClient(userId),
        businessContext,
        history,
        userMessage,
      });
      if (sim?.trim() && /```klanvio-sim\b/i.test(sim)) return sim;
      if (sim?.trim()) {
        console.warn("[agent] simulation sans fence klanvio-sim — rejetée");
      }
    } catch (err) {
      console.warn("[agent] deterministic simulation failed:", err);
    }
    return (
      "Je n'ai pas pu générer la simulation pour le moment. " +
      "Réessaie avec « simule » — le fil s'affichera sur le téléphone à droite."
    );
  }

  if (
    (briefing.isGroupsFlow || thread?.purpose === "groupes") &&
    (forceSim || shouldDeterministicSimulate(history, userMessage))
  ) {
    return (
      "Sur le fil **Groupes**, pas de simulation téléphone. " +
      "Envoi ponctuel → je publie / programme. Diffusion → « je valide » puis **« active »**."
    );
  }

  // Simulation LLM fallback déjà tentée via runDeterministicSimulation plus haut.
  // Ne plus pousser FORCE_SIMULATION_NUDGE (le LLM inventait le footer sans fence).

  if (turnMode === "decline_sim") {
    messages.push({ role: "system", content: DECLINE_SIMULATION_NUDGE });
  } else if (silentTweakAfterSim) {
    messages.push({ role: "system", content: SILENT_TWEAK_AFTER_SIM_NUDGE });
  } else if (turnMode === "activation_confirm") {
    messages.push({ role: "system", content: CONFIRM_ACTIVATE_NOW_NUDGE });
  } else if (turnMode === "activation_nudge") {
    messages.push({ role: "system", content: ACTIVATION_AFTER_SIMULATION_NUDGE });
  } else if (!recentHistoryHasSimulation(history)) {
    const nudge = buildBriefingNudge(briefing, history, userMessage);
    if (nudge) messages.push({ role: "system", content: nudge });
  }

  let rounds = 0;
  let simFixAttempts = 0;
  let forcedSimUsed = false;
  let dsmlEmptyRetries = 0;
  let emptyReplyRetries = 0;
  const MAX_DSML_EMPTY_RETRIES = 2;
  const MAX_EMPTY_REPLY_RETRIES = 2;

  // Boucle dialogue MiniMax uniquement — brouillon / sim / activate = chemins déterministes.
  const toolClient = client;
  const toolModel = resolveLlmRoleModel("chat");
  const toolProvider = resolveLlmRoleProvider("chat");

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await callOpenAiWithRetry(() =>
        toolClient.chat.completions.create({
          model: toolModel,
        messages,
          tools: toolsForTurn,
        tool_choice: "auto",
          temperature: toolProvider === "minimax" ? 1 : 0.7,
          max_tokens: recommendedMaxTokensForProvider(
            toolProvider,
            toolModel,
            CHAT_MAX_TOKENS,
            { thinkingEnabled: false }
          ),
          ...llmExtrasForProvider(toolProvider, toolModel, { enableThinking: false }),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
      );
    } catch (err) {
      throw new Error(userFacingError(err));
    }

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("Je n'ai pas reçu de réponse. Réessayez dans un instant.");
    }

    const assistantMsg = sanitizeAssistantToolCalls(choice.message);

    // Fuite outils en DSML dans content (DeepSeek / MiniMax) au lieu de tool_calls.
    const rawContentForDsml =
      typeof assistantMsg.content === "string"
        ? assistantMsg.content
        : extractAssistantContent(assistantMsg);
    if (
      (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) &&
      containsDsmlToolMarkup(rawContentForDsml)
    ) {
      const recovered = parseDsmlToolCalls(rawContentForDsml);
      const usable = recovered.toolCalls.filter((t) => {
        const args = t.function.arguments?.trim() || "{}";
        // create_automation / update sans args = fuite vide → mieux retenter
        if (
          (t.function.name === "create_automation" ||
            t.function.name === "update_automation" ||
            t.function.name === "show_campaign_simulation") &&
          (args === "{}" || args === "")
        ) {
          return false;
        }
        return true;
      });
      if (usable.length > 0) {
        assistantMsg.tool_calls = usable as typeof assistantMsg.tool_calls;
        assistantMsg.content = recovered.contentWithoutDsml.trim() || null;
        console.warn(
          `[agent] DSML récupéré → ${usable.map((t) => t.function.name).join(", ")}`
        );
      } else if (dsmlEmptyRetries < MAX_DSML_EMPTY_RETRIES && rounds < MAX_TOOL_ROUNDS) {
        dsmlEmptyRetries++;
        console.warn(
          `[agent] DSML sans args utilisables — retry ${dsmlEmptyRetries}/${MAX_DSML_EMPTY_RETRIES}`
        );
        messages.push({ role: "system", content: DSML_RETRY_NUDGE });
        continue;
      } else {
        return "Je n'ai pas pu appeler l'outil correctement. Réessaie en une phrase (ex. « crée le brouillon » ou « simule »).";
      }
    } else if (containsDsmlToolMarkup(rawContentForDsml)) {
      const cleaned = stripDsmlMarkup(rawContentForDsml).trim();
      assistantMsg.content = cleaned || null;
    }

    if (assistantMsg.tool_calls?.length) {
      messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));

      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.type !== "function") continue;

        // MiniMax ne doit jamais exécuter brouillon / sim / activation avec ses args.
        if (POWER_CAMPAIGN_TOOLS.has(toolCall.function.name)) {
          if (toolCall.function.name === "activate_automation") {
            const activated = await runDeterministicActivation({
              userId,
              threadId,
              history,
              userMessage,
            });
            if (activated) return activated;
          }
          if (toolCall.function.name === "show_campaign_simulation") {
            if (briefing.isGroupsFlow || thread?.purpose === "groupes") {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error:
                    "Pas de simulation sur le fil Groupes. " +
                    "Publie/programme (send/schedule) ou active la diffusion group_broadcast.",
                }),
              });
              continue;
            }
            forcedSimUsed = true;
            const sim = await runDeterministicSimulation({
              userId,
              threadId,
              client: await getSimLlmClient(userId),
              businessContext,
              history,
              userMessage,
            });
            if (sim?.trim() && /```klanvio-sim\b/i.test(sim)) return sim;
          }
          if (toolCall.function.name === "create_automation") {
            if (briefing.isInboundClosing) {
              const drafted = await runDeterministicSupportDraftAndSim({
                userId,
                threadId,
                client: await getSimLlmClient(userId),
                businessContext,
                history,
                userMessage,
                threadTitle: thread?.title,
                existingAutomationId: thread?.automation_id ?? null,
                inboundCatchAll: briefing.inboundCatchAll,
              });
              if (drafted) return drafted;
            } else if (briefing.isGroupsFlow || thread?.purpose === "groupes") {
              const drafted = await runDeterministicGroupsDraft({
                userId,
                threadId,
                history,
                threadTitle: thread?.title,
                existingAutomationId: thread?.automation_id ?? null,
              });
              if (drafted) return drafted;
            } else {
              const drafted = await runDeterministicDraftAndSim({
                userId,
                threadId,
                client: await getSimLlmClient(userId),
                businessContext,
                history,
                userMessage,
                purpose: thread?.purpose,
                threadTitle: thread?.title,
                existingAutomationId: thread?.automation_id ?? null,
              });
              if (drafted) return drafted;
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error:
                "Cet outil est géré côté serveur (pas MiniMax). " +
                "Dis à l'utilisateur de répondre « oui » / « simule » / « active » — le système s'en charge.",
            }),
          });
          continue;
        }

        if (toolCall.function.name === "show_campaign_simulation") {
          forcedSimUsed = true;
        }

        if (turnMode === "decline_sim" && toolCall.function.name === "show_campaign_simulation") {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error:
                "L'utilisateur a refusé la simulation. INTERDIT de la lancer. " +
                "Accepte. Pour activer sans sim il doit écrire « lance sans simulation ». " +
                "Sinon propose de simuler plus tard.",
            }),
          });
          continue;
        }

        // INTERDIT d'extraire le carnet WhatsApp sauf demande explicite
        if (
          (toolCall.function.name === "list_personal_contacts" ||
            toolCall.function.name === "list_contacts") &&
          !userExplicitlyAskedContactBook(userMessage)
        ) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error:
                "INTERDIT d'extraire les contacts du téléphone / carnet WhatsApp. " +
                "L'utilisateur n'a pas demandé la liste du carnet. " +
                "Utilise UNIQUEMENT les numéros / noms qu'il a donnés (create_automation contact_prospect avec contacts=[…]).",
            }),
          });
          continue;
        }

        // Simulation demandée : bloquer tout envoi WhatsApp réel (même tour ou suivant)
        if (forceSim && OUTBOUND_SEND_TOOLS.has(toolCall.function.name)) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error:
                "Simulation en cours : INTERDIT d'envoyer sur WhatsApp. " +
                "Appelle UNIQUEMENT show_campaign_simulation (aperçu téléphone à droite, 0 envoi réel).",
            }),
          });
          if (!forcedSimUsed) {
            messages.push({ role: "system", content: FORCE_SIMULATION_NUDGE });
          }
          continue;
        }

        // Pendant un briefing incomplet : bloquer create/activate
        if (
          !hasSimAlready &&
          briefing.inCampaignFlow &&
          (toolCall.function.name === "create_automation" ||
            toolCall.function.name === "activate_automation")
        ) {
          if (!briefing.readyForDraft) {
            const block = JSON.stringify({
              error:
                `Briefing incomplet (≈${briefing.questionsAsked}/5 questions, manques : ${
                  briefing.missing.join(", ") || "détails"
                }). Pose encore UNE question ciblée — n'appelle pas cet outil maintenant.`,
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          if (!briefing.stickersQuestionAsked) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant d'avoir posé la question stickers (oui/non).",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          // Notif tiers + handoff : obligatoires seulement en support / closing entrant.
          if (briefing.isInboundClosing && !briefing.thirdPartyQuestionAsked) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon support avant d'avoir demandé si l'utilisateur veut prévenir un tiers (livreur, associé, commercial…) à la conversion. " +
                "Pose la question oui/non — ne saute pas cette étape même si le brief parle déjà de livraison.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          if (briefing.isInboundClosing && !briefing.handoffKeywordsQuestionAsked) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon support avant d'avoir demandé les mots-clés handoff " +
                "(quand l'IA doit arrêter et passer la main — remboursement, plainte…). " +
                "Pose la question, ou [] si aucun.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          if (
            !briefing.isInboundClosing &&
            !briefing.isGroupsFlow &&
            briefing.openerNeedsRiskConsent
          ) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon tant que l'utilisateur n'a pas tranché après l'avertissement risques " +
                "(garder son 1er message hors Attention, ou prendre la version courte). " +
                "Préviens / attends sa confirmation, puis create avec opener_risk_accepted=true s'il garde sa version.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          // Closing entrant : pas d'opener sortant → skip variantes.
          // Si variantes déjà proposées OU choix 1–5 → angle considéré collecté.
          if (
            !briefing.isInboundClosing &&
            !briefing.isGroupsFlow &&
            !briefing.openerDirectionCollected &&
            !briefing.openerVariantsProposed
          ) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant que l'utilisateur ait indiqué comment il veut aborder le premier message. " +
                "Pose UNE question sur son angle / ton / idée, attends sa réponse, puis propose UNE accroche.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          if (
            !briefing.isInboundClosing &&
            !briefing.isGroupsFlow &&
            !briefing.openerSingleValidated &&
            !briefing.openerVariantsProposed
          ) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant d'avoir proposé UNE accroche et obtenu la validation de l'utilisateur. " +
                "Ensuite seulement : montrer les 5 variantes.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }

          if (
            !briefing.isInboundClosing &&
            !briefing.isGroupsFlow &&
            !briefing.openerVariantsProposed
          ) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant d'avoir montré les 5 variantes d'accroche (rotation) dans le chat après validation de l'accroche unique.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: block,
            });
            const nudge = buildBriefingNudge(briefing, history, userMessage);
            if (nudge) messages.push({ role: "system", content: nudge });
            continue;
          }
        }

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(
            sanitizeToolCallArgumentsJson(toolCall.function.arguments)
          ) as Record<string, unknown>;
        } catch {
          args = {};
        }

        // Consentement risque déjà détecté dans le fil → autorise create/update hors Attention
        if (
          briefing.openerRiskAccepted &&
          (toolCall.function.name === "create_automation" ||
            toolCall.function.name === "update_automation_config") &&
          args.opener_risk_accepted !== true
        ) {
          args.opener_risk_accepted = true;
        }

        let result: string;
        if (
          toolCall.function.name === "show_campaign_simulation" &&
          shouldBlockDuplicateSimulation(history, userMessage)
        ) {
          result = JSON.stringify({
            error: silentTweakAfterSim
              ? "Simulation déjà affichée. Applique la modif via update_automation_config (sans re-simuler). Dans ta réponse : confirme d'abord ce qui a changé (valeur concrète), puis propose doucement « refais la simulation » ou « c'est bon » pour activer — n'agresse pas avec « activer maintenant » seul."
              : "Simulation déjà sur le téléphone. Ne la répète pas dans le chat : résume et demande s’il veut activer maintenant ou s’il a d’autres modifs. N'appelle activate_automation que sur oui / lance / active explicite.",
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
          messages.push({
            role: "system",
            content: silentTweakAfterSim
              ? SILENT_TWEAK_AFTER_SIM_NUDGE
              : ACTIVATION_AFTER_SIMULATION_NUDGE,
          });
          continue;
        }

        // Interdit de lister tous les groupes pendant une action / membres / contacts d'un groupe
        if (
          toolCall.function.name === "list_whatsapp_groups" &&
          (isGroupActionNotCatalogRequest(userMessage.toLowerCase()) ||
            Boolean(detectQuickGroupMembersIntent(userMessage)))
        ) {
          result = JSON.stringify({
            error:
              "INTERDIT de lister tous les groupes. L'utilisateur veut une action sur un groupe " +
              "(prospection, envoi, membres, contacts d'un groupe…). Si le groupe n'est pas nommé, " +
              "demande UNIQUEMENT le nom du groupe — une question courte. Sinon utilise get_group_members " +
              "ou le nom dans create_automation / send_whatsapp_message.",
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
          continue;
        }

        try {
          result = await executeTool(userId, threadId, toolCall.function.name, args);
        } catch (err) {
          result = JSON.stringify({
            error: userFacingError(err),
          });
        }

        // Listes préformatées : afficher `display` tel quel (évite le rewrite LLM en mur de texte).
        // get_group_members : TOUJOURS (même si « action » sur un groupe).
        // catalogue groupes : seulement si demandé explicitement.
        const preferToolDisplay =
          toolCall.function.name === "get_group_members" ||
          toolCall.function.name === "list_personal_contacts" ||
          toolCall.function.name === "list_contacts" ||
          toolCall.function.name === "list_prospected_contacts" ||
          (toolCall.function.name === "list_whatsapp_groups" &&
            wantsExplicitGroupCatalog(userMessage.toLowerCase()));

        if (preferToolDisplay) {
          try {
            const parsed = JSON.parse(result) as {
              success?: boolean;
              display?: string;
              error?: string;
            };
            if (parsed.display?.trim()) {
              return parsed.display.trim();
            }
            if (parsed.error) {
              return userFacingError(parsed.error);
            }
          } catch {
            /* fall through */
          }
        }

        // Si l'outil a déjà formaté le fil de simulation / le plan, on l'affiche tel quel
        if (toolCall.function.name === "show_campaign_simulation") {
          try {
            const parsed = JSON.parse(result) as {
              success?: boolean;
              display?: string;
              _uiDisplay?: string;
            };
            const ui = parsed._uiDisplay?.trim() || parsed.display?.trim();
            if (parsed.success && ui) {
              return ui;
            }
          } catch {
            /* fall through */
          }
        }

        if (toolCall.function.name === "show_automation_plan") {
          try {
            const parsed = JSON.parse(result) as { success?: boolean; display?: string };
            if (parsed.success && parsed.display?.trim()) {
              return parsed.display.trim();
            }
          } catch {
            /* fall through */
          }
        }

        // Après create : afficher le plan (invite à simuler dans ce chat).
        // Après update : NE PAS coller planDisplay — laisse l'IA confirmer brièvement
        // sans re-spammer une simulation.
        if (toolCall.function.name === "create_automation") {
          try {
            const parsed = JSON.parse(result) as {
              success?: boolean;
              planDisplay?: string;
            };
            if (parsed.success && parsed.planDisplay?.trim()) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: slimToolResultForLlm(toolCall.function.name, result),
              });
              return parsed.planDisplay.trim();
            }
          } catch {
            /* fall through */
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: slimToolResultForLlm(toolCall.function.name, result),
        });
      }

      continue;
    }

    let text = extractAssistantContent(assistantMsg);
    if (containsDsmlToolMarkup(text)) {
      const cleaned = stripDsmlMarkup(text);
      if (
        !cleaned &&
        dsmlEmptyRetries < MAX_DSML_EMPTY_RETRIES &&
        rounds < MAX_TOOL_ROUNDS
      ) {
        dsmlEmptyRetries++;
        messages.push({ role: "system", content: DSML_RETRY_NUDGE });
        continue;
      }
      text = cleaned;
    }
    text = userSafeAssistantText(text, "");
    if (!text) {
      if (forceSim && !forcedSimUsed && rounds < MAX_TOOL_ROUNDS) {
        messages.push({
          role: "system",
          content: FORCE_SIMULATION_NUDGE,
        });
        continue;
      }
      if (
        dsmlEmptyRetries < MAX_DSML_EMPTY_RETRIES &&
        rounds < MAX_TOOL_ROUNDS &&
        containsDsmlToolMarkup(extractAssistantContent(assistantMsg))
      ) {
        dsmlEmptyRetries++;
        messages.push({ role: "system", content: DSML_RETRY_NUDGE });
        continue;
      }
      if (emptyReplyRetries < MAX_EMPTY_REPLY_RETRIES && rounds < MAX_TOOL_ROUNDS) {
        emptyReplyRetries++;
        console.warn(
          `[agent] réponse vide (finish=${choice.finish_reason ?? "?"}) — retry ${emptyReplyRetries}/${MAX_EMPTY_REPLY_RETRIES}`
        );
        messages.push({
          role: "system",
          content:
            "Ta dernière réponse était vide. Réponds MAINTENANT à l'utilisateur en français, " +
            "clairement (1–3 phrases). Si un outil est nécessaire, utilise tool_calls natif — " +
            "sinon réponds en texte. INTERDIT de répondre vide.",
        });
        continue;
      }
      return "Je n'ai pas pu générer de réponse. Réessayez.";
    }

    // Interdit : annoncer la simu sans payload téléphone (fence)
    {
      const rawAssistant =
        typeof assistantMsg.content === "string" ? assistantMsg.content : text;
      if (
        /simulation affichée sur le/i.test(text) &&
        !/```klanvio-sim\b/i.test(rawAssistant) &&
        !hasSimulationThread(rawAssistant)
      ) {
        if (rounds < MAX_TOOL_ROUNDS) {
          messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));
          messages.push({
            role: "system",
            content:
              "INTERDIT d'annoncer « Simulation affichée » sans le fence ```klanvio-sim (6-7 tours Toi/Prospect). " +
              "Appelle show_campaign_simulation maintenant.",
          });
          continue;
        }
        return "Je n'ai pas pu générer la simulation. Réessaie « simule ».";
      }
    }

    // Garde-fou : annonce se terminant par « : » sans contenu.
    if (isDanglingAnnouncement(text) && rounds < MAX_TOOL_ROUNDS) {
      // Rejouer le message assistant complet (ThinkChunks inclus) — doc Mistral multi-tours.
      messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));
      messages.push({
        role: "system",
        content:
          "Ta réponse s'est arrêtée sur une annonce se terminant par «\u00A0:\u00A0» sans fournir le contenu. Appelle MAINTENANT l'outil show_campaign_simulation (6-7 tours). INTERDIT de coller le fil Toi/Prospect dans le chat — le téléphone à droite l'affiche. Ne termine JAMAIS sur «\u00A0:\u00A0».",
      });
      continue;
    }

    // Garde-fou : ne pas répéter une simulation déjà validée.
    if (
      shouldBlockDuplicateSimulation(history, userMessage) &&
      (hasSimulationThread(text) || isBrokenSimulationPreview(text)) &&
      rounds < MAX_TOOL_ROUNDS
    ) {
      messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));
      messages.push({ role: "system", content: ACTIVATION_AFTER_SIMULATION_NUDGE });
      continue;
    }

    // Garde-fou simulation vide / incomplète.
    if (isBrokenSimulationPreview(text) && simFixAttempts < 3 && rounds < MAX_TOOL_ROUNDS) {
      simFixAttempts++;
      messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));
      messages.push({
        role: "system",
        content:
          "INTERDIT : tu as annoncé une simulation/aperçu SANS générer le fil. Appelle MAINTENANT l'outil show_campaign_simulation avec exactement 6 ou 7 tours (speaker toi/prospect + texte réel sans crochets). INTERDIT de coller Toi → / Prospect → dans le chat — uniquement sur le téléphone. Puis 1 phrase de confirmation. MAX 7 messages.",
      });
      continue;
    }

    // Si on forçait la simulation et qu'on a du texte sans fil → forcer l'outil
    if (forceSim && !forcedSimUsed && !hasSimulationThread(text) && rounds < MAX_TOOL_ROUNDS) {
      messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));
      messages.push({ role: "system", content: FORCE_SIMULATION_NUDGE });
      continue;
    }

    // Garde-fou briefing sortant : ne jamais sauter l'étape « UNE accroche à valider ».
    if (
      briefing.inCampaignFlow &&
      !briefing.isInboundClosing &&
      !briefing.isGroupsFlow &&
      briefing.readyForDraft &&
      hasNumberedOpenerList(text) &&
      (!briefing.openerSingleProposed || !briefing.openerSingleValidated) &&
      rounds < MAX_TOOL_ROUNDS
    ) {
      messages.push(toAssistantHistoryMessage(assistantMsg, toolProvider));
      messages.push({
        role: "system",
        content:
          "INTERDIT de proposer les 5 variantes maintenant. " +
          "Tu dois d'abord proposer UNE seule accroche (format Attention recommandé), " +
          "demander validation, puis attendre. " +
          "S'il a collé un message avec prix/lien/pitch : préviens des risques d'abord. " +
          "Réécris ton message en UNE accroche unique + question de validation (ou avertissement risques).",
      });
      continue;
    }

    return text;
  }

  // Plafond atteint : une dernière réponse texte (sans outils) à partir du travail déjà fait.
  messages.push({
    role: "system",
    content:
      "Tu as atteint la limite d'outils pour ce message. À partir des résultats d'outils déjà obtenus, " +
      "réponds à l'utilisateur en français : confirme clairement ce qui a été fait, et s'il reste quelque chose " +
      "propose UNE seule prochaine action simple. N'appelle aucun outil. Ne dis jamais « trop d'étapes » ni « reformule ».",
  });
  try {
    const wrapUp = await callOpenAiWithRetry(() =>
      toolClient.chat.completions.create({
        model: toolModel,
        messages,
        temperature: toolProvider === "minimax" ? 1 : 0.7,
        max_tokens: recommendedMaxTokensForProvider(toolProvider, toolModel, 500, {
          thinkingEnabled: false,
        }),
        ...llmExtrasForProvider(toolProvider, toolModel, { enableThinking: false }),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
    );
    const wrapText = extractAssistantContent(wrapUp.choices[0]?.message).trim();
    if (wrapText) {
      if (containsDsmlToolMarkup(wrapText)) {
        const cleaned = stripDsmlMarkup(wrapText);
        if (cleaned) return cleaned;
      } else {
        return wrapText;
      }
    }
  } catch {
    /* fall through */
  }

  return "J'ai avancé sur ta demande, mais je n'ai pas pu tout finir d'un coup. Dis-moi juste la prochaine action (ex. « envoie aux autres ») et je continue.";
}
