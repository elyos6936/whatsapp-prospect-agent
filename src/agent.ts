import OpenAI from "openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./persona.js";
import { getAppSettings, getAgentThread, getAutomation, getRecentAgentMessages, type AgentMessage, type AppSettings } from "./db.js";
import { testEvolutionConnection, listWhatsAppGroups, listPersonalContacts, chatIdToDisplay } from "./evolutionapi.js";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, toAssistantHistoryMessage, deepseekChatExtras, recommendedMaxTokens, extractAssistantContent } from "./llm.js";
import {
  assessCampaignBriefing,
  buildBriefingNudge,
  buildThreadCampaignBlockNudge,
  wantsCampaignSimulation,
} from "./campaign-briefing.js";
import { generateCampaignSimulationDirect } from "./campaign-simulation.js";
import {
  formatVerticalContactList,
  formatVerticalGroupList,
  userFacingError,
} from "./user-facing.js";

const MAX_TOOL_ROUNDS = 5;
const CHAT_HISTORY_LIMIT = 24;
const CHAT_MAX_TOKENS = 1100;

/** Intentions simples : listes sans boucle LLM (fiable pour tous les comptes). */
function detectQuickListIntent(
  msg: string
): { kind: "groups" | "contacts"; limit?: number } | null {
  const t = msg.trim().toLowerCase();
  if (!t || t.length > 160) return null;

  const num =
    t.match(/\b(\d{1,3})\s*(?:groupes?|contacts?)\b/) ||
    t.match(/\b(?:groupes?|contacts?)\s*(\d{1,3})\b/) ||
    t.match(/\bliste[- ]?moi\s+(\d{1,3})\b/);
  const limit = num ? Math.min(200, Math.max(1, Number(num[1]))) : undefined;

  if (
    /\b(groupes?|groups?)\b/i.test(t) &&
    /\b(liste|lister|montre|afficher|voir|mes|tous|all)\b/i.test(t)
  ) {
    return { kind: "groups", limit };
  }
  if (
    /\b(contacts?)\b/i.test(t) &&
    /\b(liste|lister|montre|afficher|voir|mes|tous|all)\b/i.test(t) &&
    !/\bgroupes?\b/i.test(t)
  ) {
    return { kind: "contacts", limit };
  }
  return null;
}

/**
 * Détecte une réponse « amorce vide » : le modèle annonce un contenu
 * (phrase se terminant par «\u00A0:\u00A0») puis s'arrête sans le fournir.
 */
function isDanglingAnnouncement(text: string): boolean {
  const t = text.replace(/\s+$/u, "");
  return /[:：]$/u.test(t);
}

/** Vrai contenu de simulation (fil Toi → / Prospect → ou messages entre guillemets). */
function hasSimulationThread(text: string): boolean {
  const arrowTurns = (text.match(/→/g) || []).length;
  if (arrowTurns >= 2) return true;
  if (/(^|\n)\s*(toi|moi)\s*→/im.test(text) && /(^|\n)\s*\S{2,}\s*→/im.test(text)) return true;
  const quotes = text.match(/[«"][^»"\n]{12,}[»"]/g);
  return Boolean(quotes && quotes.length >= 2);
}

const SIMULATION_ADJUSTMENT_FOOTER =
  /Qu'est-ce que tu veux (ajuster|changer)|ce qui te convient|simulation courte/i;

function recentHistoryHasSimulation(history: AgentMessage[]): boolean {
  for (let i = history.length - 1; i >= 0 && i >= history.length - 8; i--) {
    const m = history[i];
    if (m?.role !== "assistant") continue;
    if (hasSimulationThread(m.content) || SIMULATION_ADJUSTMENT_FOOTER.test(m.content)) return true;
  }
  return false;
}

/** L'utilisateur valide la simulation (pas une demande de modification). */
function isSimulationApproval(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\b(modifie|change|ajuste|autre|recommence|refais|retire|enlève|enleve|moins|plus court|plus long)\b/i.test(t)) {
    return false;
  }
  return (
    /^(c'est bon|c bon|cest bon|ok\.?|parfait\.?|nickel\.?|top\.?|validé\.?|validé|ca me va|ça me va|good|yes|oui\.?)(\s|$|pour|,)/i.test(
      t
    ) ||
    /\b(c'est bon pour moi|ca me convient|ça me convient|rien à changer|pas de changement|comme ça|comme ca)\b/i.test(
      t
    )
  );
}

function userWantsSimulationChange(text: string): boolean {
  return /\b(modifie|change|ajuste|autre|recommence|refais|ton|accroche|message|relance|plus court|plus long|moins agressif|moins direct)\b/i.test(
    text
  );
}

const ACTIVATION_AFTER_SIMULATION_NUDGE =
  "L'utilisateur a VALIDÉ la simulation déjà affichée (après feedback). INTERDIT de rappeler show_campaign_simulation ou de réécrire le fil Toi/Prospect. Étape suivante UNIQUEMENT :\n" +
  "1. Résume en 2-3 lignes la campagne (cible, message d'ouverture, relances si configurées).\n" +
  "2. Demande explicitement : « Je lance la campagne maintenant ? »\n" +
  "3. Si l'utilisateur confirme (oui / vas-y / active / lance) → appelle activate_automation avec l'automationId du brouillon.\n" +
  "Ne répète jamais la simulation.";

const FORCE_SIMULATION_NUDGE =
  "L'utilisateur a ACCEPTÉ / demandé une simulation. Tu DOIS appeler l'outil show_campaign_simulation MAINTENANT " +
  "avec exactement 6 ou 7 tours (speaker toi/prospect, textes réels SANS crochets). " +
  "Le 1er tour « toi » = accroche A.I.D.A. Attention (PAS de prix/lien). " +
  "INTERDIT d'annoncer sans outil. INTERDIT de dépasser 7 messages. " +
  "Après l'outil, le message contient déjà la demande de feedback — ne l'oublie pas. " +
  "INTERDIT ABSOLU d'appeler send_whatsapp_message / send_whatsapp_* / schedule_* / message_all_* : " +
  "la simulation s'affiche UNIQUEMENT dans ce chat — aucun envoi WhatsApp réel.";

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

function shouldBlockDuplicateSimulation(history: AgentMessage[], userMessage: string): boolean {
  if (!recentHistoryHasSimulation(history)) return false;
  if (userWantsSimulationChange(userMessage)) return false;
  return true;
}

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
      `Objectif RDV → lien de réservation. Simulation = 6-7 messages max + feedback.`
    );

  try {
    const thread = await getAgentThread(userId, threadId);
    if (thread?.automation_id) {
      const auto = await getAutomation(userId, thread.automation_id);
      if (auto) {
        lines.push(
          `## Campagne de ce fil (unique)\n` +
            `« ${auto.name} » [${auto.status}] type=${auto.type}\n\n` +
            `Ce fil ne gère qu'UNE automatisation. Pour une nouvelle campagne → l'utilisateur doit cliquer « Nouvelle automatisation » dans la barre latérale.\n` +
            `Modifications → update_automation_config (ne cite JAMAIS d'identifiant numérique de campagne à l'utilisateur).`
        );
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

  const briefing = assessCampaignBriefing(history, userMessage);
  const hasSimAlready = recentHistoryHasSimulation(history);
  const forceSim =
    wantsCampaignSimulation(userMessage, history) &&
    (!hasSimAlready || userWantsSimulationChange(userMessage));

  // Chemin fiable : simu sans tools / sans tool_choice (DeepSeek v4 thinking = 400 sinon).
  if (forceSim) {
    const recentTranscript = history
      .slice(-16)
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n\n");
    try {
      const display = await generateCampaignSimulationDirect(client, {
        businessContext,
        recentTranscript: `${recentTranscript}\n\nUser: ${userMessage}`,
      });
      if (display?.trim()) return display.trim();
    } catch (err) {
      console.warn("[agent] simulation directe échouée, fallback boucle outils:", err);
    }
  }

  if (forceSim) {
    messages.push({ role: "system", content: FORCE_SIMULATION_NUDGE });
  } else if (isSimulationApproval(userMessage) && hasSimAlready) {
    messages.push({ role: "system", content: ACTIVATION_AFTER_SIMULATION_NUDGE });
  } else if (!hasSimAlready) {
    const nudge = buildBriefingNudge(briefing);
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
          !briefing.readyForDraft &&
          briefing.inCampaignFlow &&
          (toolCall.function.name === "create_automation" ||
            toolCall.function.name === "activate_automation")
        ) {
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
          const nudge = buildBriefingNudge(briefing);
          if (nudge) messages.push({ role: "system", content: nudge });
          continue;
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
            error:
              "Simulation déjà affichée et validée. Ne la répète pas : résume la campagne et demande « Je lance la campagne ? », ou appelle activate_automation si l'utilisateur confirme.",
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
          messages.push({ role: "system", content: ACTIVATION_AFTER_SIMULATION_NUDGE });
          continue;
        }

        try {
          result = await executeTool(userId, threadId, toolCall.function.name, args);
        } catch (err) {
          result = JSON.stringify({
            error: userFacingError(err),
          });
        }

        // Listes contacts / groupes : affichage vertical structuré immédiat
        if (
          toolCall.function.name === "get_group_members" ||
          toolCall.function.name === "list_whatsapp_groups" ||
          toolCall.function.name === "list_personal_contacts" ||
          toolCall.function.name === "list_contacts" ||
          toolCall.function.name === "list_prospected_contacts"
        ) {
          try {
            const parsed = JSON.parse(result) as { success?: boolean; display?: string; error?: string };
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

        // Après create/update : forcer l'affichage du plan graphique (sans toucher persona)
        if (
          toolCall.function.name === "create_automation" ||
          toolCall.function.name === "update_automation_config"
        ) {
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

  return "Trop d'étapes d'exécution. Reformulez votre demande de façon plus simple.";
}
