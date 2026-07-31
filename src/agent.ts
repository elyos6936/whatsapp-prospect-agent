import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import {
  getAppSettings,
  getAgentThread,
  getAutomation,
  getOutreachQuotaSnapshot,
  getRecentAgentMessages,
  type AgentMessage,
  type AppSettings,
} from "./db.js";
import { testEvolutionConnection, listWhatsAppGroups, listPersonalContacts, chatIdToDisplay, findGroupByNameOrId, getGroupMembers } from "./evolutionapi.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, toAssistantHistoryMessage, deepseekChatExtras, recommendedMaxTokens, extractAssistantContent } from "./llm.js";
import {
  assessCampaignBriefing,
  buildBriefingNudge,
  buildThreadCampaignBlockNudge,
} from "./campaign-briefing.js";
import { generateCampaignSimulationDirect } from "./campaign-simulation.js";
import {
  hasSimulationThread,
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
  detectQuickGroupMembersIntent,
  detectQuickListIntent,
  isGroupActionNotCatalogRequest,
  wantsExplicitGroupCatalog,
} from "./group-list-intent.js";

/** Tours LLM+outils par message utilisateur. 5 était trop bas (Sheet → vérifs → envois). */
const MAX_TOOL_ROUNDS = 12;
const CHAT_HISTORY_LIMIT = 24;
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
  "S’il veut des modifs → update_automation_config en silence, confirme brièvement, " +
  "dis qu’il peut **repartir Valider / tester à droite** — INTERDIT de régénérer une simulation. " +
  "Il peut aussi cliquer **Lancer** dans l'en-tête. Activer = simulation déjà validée.";

const CONFIRM_ACTIVATE_NOW_NUDGE =
  "L'utilisateur CONFIRME l'activation (après ta question activer / autres modifs). " +
  "Appelle MAINTENANT activate_automation. INTERDIT de reposer la question. INTERDIT de re-simuler. " +
  "INTERDIT de redemander de Valider la simulation — l’activation suffit.";

const FORCE_SIMULATION_NUDGE =
  "L'utilisateur a ACCEPTÉ / demandé une simulation. Tu DOIS appeler l'outil show_campaign_simulation MAINTENANT " +
  "avec exactement 6 ou 7 tours (speaker toi/prospect, textes réels SANS crochets). " +
  "Le 1er tour « toi » = l'accroche validée (initial_message / variante choisie) — Attention seulement, PAS de prix/lien/pitch. " +
  "Les tours suivants : même mission / pacing (pousser l'intérêt, pas de « Ah super » vide), vouvoiement, sans prénom du prospect à tout va. " +
  "Parle de **simulation** (à droite) — jamais « panneau » ni « campagne créée ». " +
  "Dis clairement : « Si c'est bon, clique sur **Valider** à droite — je te demanderai ensuite dans ce chat si on active ou s’il y a d’autres modifs. » " +
  "INTERDIT d'annoncer sans outil. INTERDIT de dépasser 7 messages. " +
  "Après l'outil, le message contient déjà la demande de feedback — ne l'oublie pas. " +
  "INTERDIT ABSOLU d'appeler send_whatsapp_message / send_whatsapp_* / schedule_* / message_all_* : " +
  "la simulation s'affiche dans ce chat et à droite — aucun envoi WhatsApp réel.";

/** Après une simu déjà là : modifs / questions = pas de nouveau fil ni de fenêtre. */
const SILENT_TWEAK_AFTER_SIM_NUDGE =
  "Une simulation a DÉJÀ été montrée. L'utilisateur demande une modification ou pose une question. " +
  "INTERDIT d'appeler show_campaign_simulation. INTERDIT d'écrire un fil Toi → / Prospect →. " +
  "INTERDIT de coller un planDisplay / fence de plan dans ta réponse. " +
  "Si modif (ton, accroche, prix, relances, vouvoiement…) → applique via update_automation_config " +
  "(et initial_message / conversation_guide si besoin), puis confirme en 1–2 phrases courtes : " +
  "ce qui a changé + « tu peux repartir tester / Valider dans la simulation à droite ». " +
  "Si question / préoccupation → réponds clairement, sans outil de simulation. " +
  "Ne rouvre / ne renvoie PAS la fenêtre de simulation.";

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

async function getOpenAiClient(userId: number): Promise<OpenAI> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) {
    throw new Error(
      `Clé ${llmProviderLabel()} manquante. Définissez DEEPSEEK_API_KEY (ou OPENAI_API_KEY) sur le serveur.`
    );
  }
  return createLlmClient(key);
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
    `## Profil business (RAPPEL TECHNIQUE — PAS une vérité absolue)\n` +
      `Prénom / nom enregistré : ${settings.business_owner_name || "(non configuré — INTERDIT d'inventer un prénom ; rester neutre)"}\n` +
      `Offre enregistrée (peut être OBSOLÈTE) : ${settings.business_offer || "(non configuré)"}\n` +
      `Tarif enregistré : ${settings.business_price || "(non communiqué)"}\n\n` +
      `⚠️ RÈGLE STRICTE : ce profil est un **indice optionnel**, PAS la source de vérité pour une campagne.\n` +
      `- Pour une **NOUVELLE campagne** : pose TOUJOURS une question ouverte sur l'offre actuelle ` +
      `("Qu'est-ce que tu proposes concrètement à ces personnes ?"). ` +
      `N'affirme JAMAIS "tu vends X" / "produits cosmétiques" / etc. d'après ce profil.\n` +
      `- Tu peux mentionner l'ancienne offre SEULEMENT comme question de confirmation : ` +
      `"Ton profil indiquait autrefois « … » — c'est toujours ça, ou ça a changé ?"\n` +
      `- N'utilise l'offre/prix du profil dans create_automation / messages WhatsApp ` +
      `QUE si l'utilisateur les a **confirmés explicitement** dans cette conversation.\n` +
      `- **Identité** : si prénom non configuré, ne te présente JAMAIS avec un nom (Will, etc.). Reste neutre.`
  );
  lines.push(
    `## Rappel campagnes\n` +
      `Parle comme un pro WhatsApp humain, créatif et concis — sans te donner de prénom inventé. ` +
      `Prospection / support / closing = briefing progressif (≥5 questions, une à la fois). ` +
      `Après « nouvelle campagne » → 1ʳᵉ question = offre ACTUELLE (ouverte, sans inventer). ` +
      `Demande aussi la fenêtre horaire d'envoi et le jour/heure de lancement. ` +
      `Objectif RDV → lien de réservation. Après brief : demande d'abord le 1er message souhaité, puis propose 5 variantes d'accroche, fais valider, puis create avec ab_variants. ` +
      `Simulation = 6-7 messages max + feedback (1er tour = accroche validée).`
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
          `- INTERDIT : contact_prospect, group_prospect, premier message de contact sortant, 5 variantes d'accroche.\n` +
          `- Questions utiles : produit/service, phrase(s) déclencheur exacte(s), infos à donner, objectif (vente/RDV/lien), présentation, stickers, notif tiers.\n` +
          `- INTERDIT de demander délais entre messages, vagues de 50, gap entre vagues ou plage anti-blocage — défauts système automatiques.\n` +
          `- Commence le brief par une question ouverte sur le produit / ce que tu dois répondre — PAS « quel premier message envoyer ».`
      );
    } else if (thread?.purpose === "prospection") {
      lines.push(
        `## TYPE DE FIL — PROSPECTION (OBLIGATOIRE)\n` +
          `Ce fil a été créé en mode **Prospection**. Vous contactez les prospects en premier.\n` +
          `- create_automation UNIQUEMENT avec type=\`contact_prospect\` ou \`group_prospect\` (mode \`outbound_prospect\`).\n` +
          `- INTERDIT : keyword_sales / inbound_closing / questions « phrase déclencheur » comme flux principal.\n` +
          `- Suivre le brief sortant : offre, cible, planning, premier message souhaité, puis 5 variantes d'accroche.`
      );
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
            `Modifications → update_automation_config (ne cite JAMAIS d'identifiant numérique de campagne à l'utilisateur).`
        );
        if (auto.config.initialMessage?.trim()) {
          const variants = (auto.config.abVariants ?? [])
            .map((v) => v.message?.trim())
            .filter(Boolean)
            .slice(0, 5);
          lines.push(
            `## Accroche validée (cadre strict)\n` +
              `initial_message : « ${auto.config.initialMessage.trim()} »\n` +
              (variants.length
                ? `ab_variants (${variants.length}) :\n` +
                  variants.map((m, i) => `${i + 1}. « ${m} »`).join("\n") +
                  "\n"
                : "") +
              `En simulation et en envoi : rester dans CE cadre (micro-variation OK). Pas de pitch complet au 1er message.`
          );
        }
      }
    } else {
      lines.push(
        `## Fil vide\nAucune campagne liée à ce fil. Tu peux en créer une via create_automation après le briefing complet.`
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

  const client = await getOpenAiClient(userId);
  const [settings, history, thread] = await Promise.all([
    getAppSettings(userId),
    getRecentAgentMessages(userId, threadId, CHAT_HISTORY_LIMIT),
    getAgentThread(userId, threadId),
  ]);

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

  const briefing = assessCampaignBriefing(history, userMessage, thread?.purpose ?? null);
  const hasSimAlready = recentHistoryHasSimulation(history);
  const turnMode = resolveSimulationTurnMode(history, userMessage);
  const forceSim = turnMode === "force_sim";
  const silentTweakAfterSim = turnMode === "silent_tweak";

  // Chemin fiable : simu sans tools / sans tool_choice (DeepSeek v4 thinking = 400 sinon).
  if (forceSim) {
    const recentTranscript = history
      .slice(-16)
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n\n");
    try {
      let approvedOpener: string | null = null;
      if (thread?.automation_id) {
        const auto = await getAutomation(userId, thread.automation_id);
        approvedOpener = auto?.config.initialMessage?.trim() || null;
      }
      const display = await generateCampaignSimulationDirect(client, {
        businessContext,
        recentTranscript: `${recentTranscript}\n\nUser: ${userMessage}`,
        approvedOpener,
      });
      if (display?.trim()) return display.trim();
    } catch (err) {
      console.warn("[agent] simulation directe échouée, fallback boucle outils:", err);
    }
  }

  if (forceSim) {
    messages.push({ role: "system", content: FORCE_SIMULATION_NUDGE });
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

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    // Toujours "auto" : DeepSeek thinking refuse tool_choice forcé (HTTP 400).
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await callOpenAiWithRetry(() =>
        client.chat.completions.create({
        model: config.openaiModel,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
          temperature: 0.65,
          max_tokens: recommendedMaxTokens(config.openaiModel, CHAT_MAX_TOKENS, {
            thinkingEnabled: false,
          }),
          ...deepseekChatExtras({ enableThinking: false }),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
      );
    } catch (err) {
      throw new Error(userFacingError(err));
    }

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("Je n'ai pas reçu de réponse. Réessayez dans un instant.");
    }

    const assistantMsg = choice.message;

    if (assistantMsg.tool_calls?.length) {
      // DeepSeek thinking : rejouer reasoning_content avec les tool_calls
      messages.push(toAssistantHistoryMessage(assistantMsg));

      for (const toolCall of assistantMsg.tool_calls) {
        if (toolCall.type !== "function") continue;

        if (toolCall.function.name === "show_campaign_simulation") {
          forcedSimUsed = true;
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
                "Appelle UNIQUEMENT show_campaign_simulation (aperçu dans le chat, 0 envoi réel).",
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

          if (!briefing.thirdPartyQuestionAsked) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant d'avoir demandé si l'utilisateur veut prévenir un tiers (livreur, associé, commercial…) à la conversion. " +
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

          // Closing entrant : pas d'opener sortant → skip variantes.
          if (!briefing.isInboundClosing && !briefing.openerDirectionCollected) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant que l'utilisateur ait indiqué comment il veut aborder le premier message. " +
                "Pose UNE question sur son angle / ton / idée, attends sa réponse, puis propose 5 variantes.",
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

          if (!briefing.isInboundClosing && !briefing.openerVariantsProposed) {
            const block = JSON.stringify({
              error:
                "INTERDIT de créer le brouillon avant d'avoir proposé les 5 variantes d'accroche dans le chat et d'avoir obtenu le choix de l'utilisateur.",
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
          args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        let result: string;
        if (
          toolCall.function.name === "show_campaign_simulation" &&
          shouldBlockDuplicateSimulation(history, userMessage)
        ) {
          result = JSON.stringify({
            error: silentTweakAfterSim
              ? "Simulation déjà affichée. Applique la modif via update_automation_config (sans re-simuler) et confirme brièvement : l'utilisateur peut repartir Valider à droite."
              : "Simulation déjà affichée. Ne la répète pas : résume et demande dans ce chat s’il veut activer maintenant ou s’il a d’autres modifs. N'appelle activate_automation que sur oui / lance / active explicite.",
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
            const parsed = JSON.parse(result) as { success?: boolean; display?: string };
            if (parsed.success && parsed.display?.trim()) {
              return parsed.display.trim();
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

        // Après create : afficher le plan (ouvre la simu à droite).
        // Après update : NE PAS coller planDisplay — laisse l'IA confirmer brièvement
        // sans re-spammer la fenêtre de simulation.
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
                content: result,
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
          content: result,
        });
      }

      continue;
    }

    const text = extractAssistantContent(assistantMsg);
    if (!text) {
      if (forceSim && !forcedSimUsed && rounds < MAX_TOOL_ROUNDS) {
        messages.push({
          role: "system",
          content: FORCE_SIMULATION_NUDGE,
        });
        continue;
      }
      return "Je n'ai pas pu générer de réponse. Réessayez.";
    }

    // Garde-fou : annonce se terminant par « : » sans contenu.
    if (isDanglingAnnouncement(text) && rounds < MAX_TOOL_ROUNDS) {
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "system",
        content:
          "Ta réponse s'est arrêtée sur une annonce se terminant par «\u00A0:\u00A0» sans fournir le contenu. Réécris MAINTENANT ta réponse complète dans UN seul message : si c'est une simulation, appelle l'outil show_campaign_simulation (6-7 tours Toi/Prospect) OU écris directement le fil « Toi → «\u00A0…\u00A0» » / « Prospect → «\u00A0…\u00A0» ». Ne termine JAMAIS sur «\u00A0:\u00A0».",
      });
      continue;
    }

    // Garde-fou : ne pas répéter une simulation déjà validée.
    if (
      shouldBlockDuplicateSimulation(history, userMessage) &&
      (hasSimulationThread(text) || isBrokenSimulationPreview(text)) &&
      rounds < MAX_TOOL_ROUNDS
    ) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "system", content: ACTIVATION_AFTER_SIMULATION_NUDGE });
      continue;
    }

    // Garde-fou simulation vide / incomplète.
    if (isBrokenSimulationPreview(text) && simFixAttempts < 3 && rounds < MAX_TOOL_ROUNDS) {
      simFixAttempts++;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "system",
        content:
          "INTERDIT : tu as annoncé une simulation/aperçu SANS écrire le fil. Appelle MAINTENANT l'outil show_campaign_simulation avec exactement 6 ou 7 tours (speaker toi/prospect + texte réel sans crochets), OU écris le fil complet dans ce message au format :\nToi → «\u00A0…\u00A0»\nProspect → «\u00A0…\u00A0»\nToi → «\u00A0…\u00A0»\nPuis demande ce qu'il faut changer ou garder. Aucune phrase qui finit par «\u00A0:\u00A0» sans le fil juste après. MAX 7 messages.",
      });
      continue;
    }

    // Si on forçait la simulation et qu'on a du texte sans fil → forcer l'outil
    if (forceSim && !forcedSimUsed && !hasSimulationThread(text) && rounds < MAX_TOOL_ROUNDS) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "system", content: FORCE_SIMULATION_NUDGE });
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
      client.chat.completions.create({
        model: config.openaiModel,
        messages,
        temperature: 0.5,
        max_tokens: recommendedMaxTokens(config.openaiModel, 500, {
          thinkingEnabled: false,
        }),
        ...deepseekChatExtras({ enableThinking: false }),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
    );
    const wrapText = extractAssistantContent(wrapUp.choices[0]?.message).trim();
    if (wrapText) return wrapText;
  } catch {
    /* fall through */
  }

  return "J'ai avancé sur ta demande, mais je n'ai pas pu tout finir d'un coup. Dis-moi juste la prochaine action (ex. « envoie aux autres ») et je continue.";
}
