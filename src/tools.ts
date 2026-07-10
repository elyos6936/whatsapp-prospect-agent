import type OpenAI from "openai";
import {
  getGreenApiCredentials,
  getChatHistory,
  getGroupMembers,
  getLastIncomingMessages,
  findGroupByNameOrId,
  listPersonalContacts,
  listWhatsAppChats,
  listWhatsAppGroups,
  markChatRead,
  messageGroupMembers,
  normalizePhoneToChatId,
  sendWhatsAppMessage,
  sendWhatsAppTextStatus,
  testGreenApiConnection,
  chatIdToDisplay,
  chatIdToNumber,
  requireGreenApiAuthorized,
} from "./greenapi.js";
import {
  CONTACT_STATUSES,
  blockContact,
  cancelScheduledMessage,
  countOutboundToday,
  createAutomation,
  createGroupReplyRule,
  DAILY_OUTBOUND_LIMIT,
  getAutomationDetail,
  getAppSettings,
  getContact,
  getContactThread,
  getDailyBilan,
  listAutomations,
  listContacts,
  listIncomingMessages,
  listScheduledMessages,
  resolveLocalSendAt,
  saveBusinessProfile,
  saveContact,
  scheduleMessage,
  setContactAutoReply,
  updateAutomationStatus,
  type AutomationStatus,
  type AutomationType,
  type ContactStatus,
  unblockContact,
} from "./db.js";
import { bootstrapGroupProspectTargets } from "./automation-engine.js";

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "check_whatsapp_connection",
      description: "Vérifie si WhatsApp est connecté via Green-API.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_groups",
      description: "Liste tous les groupes WhatsApp dont l'utilisateur est membre.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_group_members",
      description: "Récupère les membres d'un groupe WhatsApp par son ID (xxx@g.us) ou son nom.",
      parameters: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "ID du groupe (xxx@g.us) OU nom du groupe (ex. Automax)",
          },
        },
        required: ["group_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_personal_contacts",
      description:
        "Liste les contacts du carnet WhatsApp via Green-API (hors groupes). À utiliser seulement si l'utilisateur demande explicitement les contacts WhatsApp / carnet d'adresses.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Nombre max de contacts (défaut 50)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_chat_history",
      description:
        "Récupère l'historique d'une conversation WhatsApp via Green-API (messages entrants et sortants).",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Numéro (+229…) ou chatId (229...@c.us)",
          },
          count: {
            type: "number",
            description: "Nombre de messages à récupérer (défaut 30, max 100)",
          },
        },
        required: ["recipient"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_incoming_messages",
      description:
        "Liste les messages WhatsApp entrants stockés localement. Filtrable par contact ou par date (aujourd'hui).",
      parameters: {
        type: "object",
        properties: {
          contact_phone: {
            type: "string",
            description: "Filtrer par numéro (+229…) ou chatId — optionnel",
          },
          today_only: {
            type: "boolean",
            description: "Ne garder que les messages reçus aujourd'hui",
          },
          limit: {
            type: "number",
            description: "Nombre max de messages (défaut 30)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_contact",
      description:
        "Enregistre ou met à jour un contact de prospection : numéro, nom, notes, statut (nouveau, en_conversation, interesse, stop).",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Numéro (+229…) ou chatId" },
          name: { type: "string", description: "Nom du contact" },
          notes: { type: "string", description: "Notes libres (activité, contexte…)" },
          status: {
            type: "string",
            enum: ["nouveau", "en_conversation", "interesse", "stop"],
            description: "Statut du contact",
          },
          auto_reply: {
            type: "boolean",
            description: "Activer/désactiver la réponse auto pour CE contact",
          },
        },
        required: ["phone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contacts",
      description:
        "Liste les contacts de prospection enregistrés EN BASE LOCALE (statut, notes, auto_reply). À utiliser pour « liste mes contacts », « montre les prospects », filtrable par statut.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["nouveau", "en_conversation", "interesse", "stop"],
            description: "Filtrer par statut (optionnel)",
          },
          limit: { type: "number", description: "Nombre max (défaut 50)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_auto_reply",
      description:
        "Active ou désactive la réponse automatique pour UN numéro donné (pas le toggle global).",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Numéro (+229…) ou chatId" },
          enabled: { type: "boolean", description: "true = activer, false = désactiver" },
        },
        required: ["phone", "enabled"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "block_contact",
      description:
        "Passe un contact en STOP : plus aucun envoi possible vers lui, même si demandé par erreur. Auto-reply désactivé.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Numéro (+229…) ou chatId" },
        },
        required: ["phone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unblock_contact",
      description: "Retire le statut STOP d'un contact (remet en_conversation).",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Numéro (+229…) ou chatId" },
        },
        required: ["phone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_message",
      description:
        "Envoie UN message texte WhatsApp. Destinataire : numéro personnel (+229…), chatId (@c.us), ID de groupe (@g.us), OU nom de groupe (ex. Automax). Pour poster DANS un groupe, utiliser cet outil — PAS message_all_group_members.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description:
              "Numéro (+229…), chatId personnel, ID groupe (@g.us), ou nom de groupe WhatsApp",
          },
          message: { type: "string", description: "Texte du message" },
        },
        required: ["recipient", "message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "message_all_group_members",
      description:
        "Envoie un message PRIVÉ à chaque membre d'un groupe (pas dans le groupe). Différent de poster dans le chat du groupe.",
      parameters: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "ID du groupe xxx@g.us OU nom du groupe",
          },
          message: { type: "string", description: "Texte à envoyer à chaque membre" },
          max_members: {
            type: "number",
            description: "Limite de membres (défaut 30, max 50)",
          },
        },
        required: ["group_id", "message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_whatsapp_message",
      description:
        "Programme l'envoi automatique d'un message WhatsApp (personne ou groupe). Utiliser delay_minutes (ex. 2) OU send_at_local (ex. 06:30, heure locale).",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Numéro, chatId, ID groupe (@g.us) ou nom de groupe",
          },
          message: { type: "string", description: "Texte exact à envoyer" },
          delay_minutes: {
            type: "number",
            description: "Envoi dans N minutes (ex. 2). Mutuellement exclusif avec send_at_local.",
          },
          send_at_local: {
            type: "string",
            description: "Heure locale HH:MM ou HHhMM (ex. 06:30). Si déjà passée → demain.",
          },
        },
        required: ["recipient", "message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_messages",
      description: "Liste les messages WhatsApp programmés (en attente par défaut).",
      parameters: {
        type: "object",
        properties: {
          include_done: {
            type: "boolean",
            description: "Inclure aussi les envoyés / échoués / annulés",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_scheduled_message",
      description: "Annule un message programmé encore en attente, via son id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "ID du message programmé" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_daily_bilan",
      description:
        "Bilan / rapport du jour (ou d'une date) depuis SQLite : messages entrants/sortants, contacts, top conversations, programmés. À utiliser pour « bilan », « rapport », « combien de messages aujourd'hui ».",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Date YYYY-MM-DD (optionnel, défaut = aujourd'hui heure locale)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_conversation",
      description:
        "Relit la conversation complète d'un prospect depuis la base SQLite locale (table messages). Préférer cet outil à l'affichage dans le chat agent.",
      parameters: {
        type: "object",
        properties: {
          phone: {
            type: "string",
            description: "Numéro (+229…) ou chatId",
          },
          limit: {
            type: "number",
            description: "Nombre max de messages (défaut 50, max 200)",
          },
        },
        required: ["phone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_business_profile",
      description:
        "Enregistre le profil business utilisé dans les réponses auto : prénom/nom, offre/formation, tarif FCFA. Évite les placeholders du type [ton prénom].",
      parameters: {
        type: "object",
        properties: {
          owner_name: {
            type: "string",
            description: "Prénom ou nom à utiliser pour se présenter",
          },
          offer: {
            type: "string",
            description: "Description courte de l'offre / formation",
          },
          price: {
            type: "string",
            description: "Tarif en FCFA (texte libre, ex. 25 000 FCFA)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_status",
      description:
        "Publie un STATUT WhatsApp (story) texte via Green-API sendTextStatus. Utiliser quand l'utilisateur demande de poster/publier un statut WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Texte du statut (max 500 caractères)" },
          background_color: {
            type: "string",
            description: "Couleur fond hex (défaut #228B22, éviter blanc)",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_chats",
      description:
        "Liste les chats WhatsApp de l'instance (getChats Green-API), triés par activité récente.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "Nombre de chats (défaut 50, max 200)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_chat_read",
      description: "Marque un chat ou un message comme lu (readChat Green-API).",
      parameters: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "chatId (@c.us ou @g.us) ou numéro +229…" },
          id_message: {
            type: "string",
            description: "ID message entrant précis (optionnel — sinon tout le chat)",
          },
        },
        required: ["chat_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_green_incoming_messages",
      description:
        "Derniers messages entrants sur l'instance Green-API (lastIncomingMessages), hors base locale.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_business_profile",
      description: "Lit le profil business actuel (nom, offre, tarif) stocké en SQLite.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_automation",
      description:
        "Crée une automatisation WhatsApp active (visible sur la page Automatisation). Utiliser quand l'utilisateur décrit un workflow récurrent : prospecter un groupe, vendre un produit sur mots-clés, etc. L'automatisation démarre immédiatement.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nom court de l'automatisation" },
          type: {
            type: "string",
            enum: ["group_prospect", "keyword_sales", "custom_followup"],
            description:
              "group_prospect = DM chaque membre d'un groupe ; keyword_sales = répondre/vendre quand un mot-clé est détecté ; custom_followup = suivi personnalisé",
          },
          summary: { type: "string", description: "Résumé en une phrase pour l'utilisateur" },
          group_id: { type: "string", description: "ID ou nom du groupe (@g.us ou nom)" },
          initial_message: { type: "string", description: "Premier message pour group_prospect" },
          max_members: { type: "number", description: "Limite de membres (défaut 30)" },
          enable_auto_reply: {
            type: "boolean",
            description: "Activer les réponses auto après le premier message (défaut true)",
          },
          conversation_guide: {
            type: "string",
            description: "Instructions pour guider les échanges automatiques",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Mots-clés déclencheurs pour keyword_sales (ex. commander, produit, prix)",
          },
          product_name: { type: "string", description: "Nom du produit à vendre" },
          price: { type: "string", description: "Prix en FCFA" },
          sales_script: { type: "string", description: "Script / argumentaire de vente" },
          budget_fcfa: { type: "number", description: "Budget estimé en FCFA (optionnel)" },
          personalize_messages: {
            type: "boolean",
            description: "Personnaliser chaque message avec l'IA selon le nom du membre (group_prospect)",
          },
          ab_variants: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                message: { type: "string" },
              },
            },
            description: "Variantes A/B pour tester plusieurs accroches",
          },
          sequence_steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                delayDays: { type: "number" },
                message: { type: "string" },
                condition: { type: "string", enum: ["no_reply", "always"] },
              },
            },
            description: "Relances multi-étapes après le premier message",
          },
          media_url: { type: "string", description: "URL image/document/audio à envoyer" },
          media_type: { type: "string", enum: ["image", "document", "audio"] },
        },
        required: ["name", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_automations",
      description: "Liste toutes les automatisations WhatsApp (actives, en pause, terminées).",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "paused", "completed", "failed"],
            description: "Filtrer par statut (optionnel)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_automation_report",
      description: "Rapport détaillé d'une automatisation : stats, cibles, logs récents.",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number", description: "ID de l'automatisation" },
        },
        required: ["automation_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_automation_status",
      description: "Active, met en pause ou arrête une automatisation.",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number" },
          status: {
            type: "string",
            enum: ["active", "paused", "completed"],
            description: "active = reprendre, paused = suspendre, completed = terminer",
          },
        },
        required: ["automation_id", "status"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_group_rule",
      description:
        "Crée une règle de réponse automatique dans un groupe WhatsApp. L'IA répond publiquement quand un message contient un mot-clé.",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "ID ou nom du groupe (@g.us ou nom)" },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Mots-clés déclencheurs (ex. prix, commander, info)",
          },
          reply_guide: {
            type: "string",
            description: "Instructions pour la réponse IA dans le groupe",
          },
          automation_id: { type: "number", description: "Lier à une automatisation existante (optionnel)" },
        },
        required: ["group_id", "keywords", "reply_guide"],
        additionalProperties: false,
      },
    },
  },
];

/** Outils qui n'ont pas besoin de Green-API immédiatement */
const LOCAL_TOOLS = new Set([
  "save_contact",
  "list_contacts",
  "set_auto_reply",
  "block_contact",
  "unblock_contact",
  "list_incoming_messages",
  "check_whatsapp_connection",
  "list_scheduled_messages",
  "cancel_scheduled_message",
  "get_daily_bilan",
  "get_contact_conversation",
  "save_business_profile",
  "get_business_profile",
  "create_automation",
  "list_automations",
  "get_automation_report",
  "set_automation_status",
  "create_group_rule",
]);

async function resolveRecipient(recipient: string): Promise<string> {
  const trimmed = recipient.trim();
  if (!trimmed) throw new Error("Destinataire vide.");

  // Déjà un chatId valide
  if (trimmed.endsWith("@c.us") || trimmed.endsWith("@g.us") || trimmed.endsWith("@lid") || trimmed.endsWith("@s.whatsapp.net")) {
    return trimmed.endsWith("@s.whatsapp.net")
      ? `${chatIdToNumber(trimmed)}@c.us`
      : trimmed;
  }

  // Numéro de téléphone
  if (/^[\d+\s\-().]+$/.test(trimmed) && trimmed.replace(/\D/g, "").length >= 8) {
    return normalizePhoneToChatId(trimmed);
  }

  // Nom de groupe (ex. Automax)
  const group = await findGroupByNameOrId(trimmed);
  if (group) return group.id;

  throw new Error(
    `Destinataire introuvable : « ${trimmed} ». Indiquez un numéro (+229…), un chatId, ou le nom exact d'un groupe WhatsApp.`
  );
}

async function resolveGroupId(groupIdOrName: string): Promise<string> {
  const trimmed = groupIdOrName.trim();
  if (trimmed.endsWith("@g.us")) return trimmed;
  const group = await findGroupByNameOrId(trimmed);
  if (!group) {
    throw new Error(
      `Groupe introuvable : « ${trimmed} ». Vérifiez le nom avec list_whatsapp_groups.`
    );
  }
  return group.id;
}

function nowFr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatContact(c: {
  phone: string;
  name: string | null;
  notes: string | null;
  status: string;
  auto_reply: number;
}) {
  return {
    phone: c.phone,
    display: chatIdToDisplay(c.phone),
    name: c.name,
    notes: c.notes,
    status: c.status,
    auto_reply: c.auto_reply === 1,
  };
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!LOCAL_TOOLS.has(name) && !getGreenApiCredentials()) {
    return JSON.stringify({
      error:
        "Green-API non configuré. Demandez à l'utilisateur d'ouvrir « Connexions » et de renseigner Instance ID, Token et URL.",
    });
  }

  switch (name) {
    case "check_whatsapp_connection": {
      const result = await testGreenApiConnection();
      return JSON.stringify({
        ...result,
        outboundToday: countOutboundToday(),
        outboundLimit: DAILY_OUTBOUND_LIMIT,
      });
    }

    case "list_whatsapp_groups": {
      const groups = await listWhatsAppGroups();
      return JSON.stringify({
        count: groups.length,
        groups: groups.map((g) => ({ id: g.id, name: g.name })),
      });
    }

    case "get_group_members": {
      const groupId = await resolveGroupId(String(args.group_id ?? ""));
      const data = await getGroupMembers(groupId);
      return JSON.stringify({
        groupId: data.groupId,
        name: data.subject,
        size: data.size,
        members: data.participants.map((p) => ({
          id: p.id,
          display: chatIdToDisplay(p.id),
          name: p.name ?? null,
          isAdmin: p.isAdmin ?? false,
        })),
      });
    }

    case "list_personal_contacts": {
      const limit = Math.min(Number(args.limit) || 50, 100);
      const contacts = await listPersonalContacts(limit);
      return JSON.stringify({ count: contacts.length, contacts });
    }

    case "get_chat_history": {
      const recipient = String(args.recipient ?? "");
      const count = Math.min(Number(args.count) || 30, 100);
      const data = await getChatHistory(recipient, count);
      return JSON.stringify({
        chatId: data.chatId,
        display: data.display,
        count: data.messages.length,
        messages: data.messages.map((m) => ({
          direction: m.type === "incoming" ? "entrant" : "sortant",
          text: m.text,
          time: m.timestamp
            ? new Date(m.timestamp * 1000).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
          sender: m.senderName ?? (m.type === "incoming" ? data.display : "Moi"),
        })),
      });
    }

    case "list_incoming_messages": {
      const messages = listIncomingMessages({
        contactPhone: args.contact_phone ? String(args.contact_phone) : undefined,
        todayOnly: Boolean(args.today_only),
        limit: Math.min(Number(args.limit) || 30, 100),
      });
      return JSON.stringify({
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          contact: chatIdToDisplay(m.contact_phone),
          sender: m.sender_name || chatIdToDisplay(m.contact_phone),
          body: m.body,
          receivedAt: m.created_at,
        })),
      });
    }

    case "save_contact": {
      const phone = String(args.phone ?? "");
      const statusRaw = args.status ? String(args.status) : undefined;
      if (statusRaw && !CONTACT_STATUSES.includes(statusRaw as ContactStatus)) {
        return JSON.stringify({
          error: `Statut invalide. Attendu : ${CONTACT_STATUSES.join(", ")}`,
        });
      }
      const contact = saveContact({
        phone,
        name: args.name !== undefined ? String(args.name) : undefined,
        notes: args.notes !== undefined ? String(args.notes) : undefined,
        status: statusRaw as ContactStatus | undefined,
        autoReply: typeof args.auto_reply === "boolean" ? args.auto_reply : undefined,
      });
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        message: `Contact ${chatIdToDisplay(contact.phone)} enregistré (statut : ${contact.status}).`,
      });
    }

    case "list_contacts": {
      const statusRaw = args.status ? String(args.status) : undefined;
      const status =
        statusRaw && CONTACT_STATUSES.includes(statusRaw as ContactStatus)
          ? (statusRaw as ContactStatus)
          : undefined;
      const contacts = listContacts({
        status,
        limit: Math.min(Number(args.limit) || 50, 100),
      });
      return JSON.stringify({
        count: contacts.length,
        contacts: contacts.map(formatContact),
      });
    }

    case "set_auto_reply": {
      const phone = String(args.phone ?? "");
      const enabled = Boolean(args.enabled);
      const contact = setContactAutoReply(phone, enabled);
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        message: enabled
          ? `Réponse auto activée pour ${chatIdToDisplay(contact.phone)}.`
          : `Réponse auto désactivée pour ${chatIdToDisplay(contact.phone)}.`,
      });
    }

    case "block_contact": {
      const phone = String(args.phone ?? "");
      const contact = blockContact(phone);
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        message: `⛔ Contact ${chatIdToDisplay(contact.phone)} passé en STOP. Aucun envoi possible vers lui.`,
      });
    }

    case "unblock_contact": {
      const phone = String(args.phone ?? "");
      const contact = unblockContact(phone);
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        message: `Contact ${chatIdToDisplay(contact.phone)} débloqué (statut : ${contact.status}).`,
      });
    }

    case "send_whatsapp_message": {
      const recipient = String(args.recipient ?? "");
      const message = String(args.message ?? "");
      try {
        const chatId = await resolveRecipient(recipient);

        if (chatId.endsWith("@c.us")) {
          const existing = getContact(chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({
              error: `Ce contact est en STOP. Aucun message ne sera envoyé. Demandez à l'utilisateur de le débloquer si vraiment nécessaire.`,
            });
          }
        }

        const result = await sendWhatsAppMessage(chatId, message);
        if (chatId.endsWith("@c.us")) {
          try {
            setContactAutoReply(chatId, true);
            saveContact({
              phone: chatId,
              status: "en_conversation",
              autoReply: true,
            });
          } catch {
            /* best effort */
          }
        }
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          isGroup,
          idMessage: result.idMessage,
          sentAt: nowFr(),
          outboundToday: countOutboundToday(),
          outboundLimit: DAILY_OUTBOUND_LIMIT,
          message: isGroup
            ? `Message envoyé dans le groupe à ${nowFr()}`
            : `Message envoyé à ${chatIdToDisplay(result.chatId)} à ${nowFr()}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "send_whatsapp_status": {
      const message = String(args.message ?? "").trim();
      const backgroundColor = args.background_color ? String(args.background_color) : undefined;
      try {
        const result = await sendWhatsAppTextStatus(message, { backgroundColor });
        return JSON.stringify({
          success: true,
          idMessage: result.idMessage,
          audienceCount: result.audienceCount,
          publishedAt: nowFr(),
          message: `✅ Statut WhatsApp publié pour ${result.audienceCount} contact(s) : « ${message.slice(0, 80)}${message.length > 80 ? "…" : ""} »`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          error: msg.includes("Forbidden")
            ? "Publication de statut refusée par Evolution API. Vérifiez que l'instance est connectée et que sendStatus est activé."
            : msg,
        });
      }
    }

    case "list_whatsapp_chats": {
      const count = Math.min(Math.max(Number(args.count) || 50, 1), 200);
      const chats = await listWhatsAppChats(count);
      return JSON.stringify({
        count: chats.length,
        chats: chats.map((c) => ({
          id: c.id,
          name: c.name,
          display: c.id.endsWith("@c.us") ? chatIdToDisplay(c.id) : c.name,
          type: c.type,
          archive: c.archive,
        })),
      });
    }

    case "mark_chat_read": {
      const chatId = await resolveRecipient(String(args.chat_id ?? ""));
      const idMessage = args.id_message ? String(args.id_message) : undefined;
      const result = await markChatRead(chatId, idMessage);
      return JSON.stringify({
        success: true,
        chatId,
        setRead: result.setRead,
        message: `Chat ${chatIdToDisplay(chatId)} marqué comme lu.`,
      });
    }

    case "list_green_incoming_messages": {
      const raw = await getLastIncomingMessages();
      const messages = raw.map((m) => ({
        idMessage: m.idMessage,
        chatId: m.chatId,
        display: chatIdToDisplay(m.chatId),
        senderName: m.senderName || m.senderContactName || "",
        typeMessage: m.typeMessage,
        text:
          m.textMessage?.trim() ||
          m.extendedTextMessageData?.text?.trim() ||
          `[${m.typeMessage}]`,
        timestamp: m.timestamp,
      }));
      return JSON.stringify({ count: messages.length, messages });
    }

    case "message_all_group_members": {
      const groupId = await resolveGroupId(String(args.group_id ?? ""));
      const message = String(args.message ?? "");
      const maxMembers = Math.min(Math.max(Number(args.max_members) || 30, 1), 50);
      const result = await messageGroupMembers(groupId, message, { maxMembers, delayMs: 4000 });
      return JSON.stringify({
        groupName: result.groupName,
        sentCount: result.sent.length,
        errorCount: result.errors.length,
        skipped: result.skipped,
        sent: result.sent.map((s) => ({ ...s, display: chatIdToDisplay(s.chatId) })),
        errors: result.errors,
        outboundToday: countOutboundToday(),
        outboundLimit: DAILY_OUTBOUND_LIMIT,
        completedAt: nowFr(),
      });
    }

    case "schedule_whatsapp_message": {
      const recipientRaw = String(args.recipient ?? "");
      const message = String(args.message ?? "").trim();
      if (!message) {
        return JSON.stringify({ error: "Le texte du message est requis." });
      }

      const hasDelay = args.delay_minutes !== undefined && args.delay_minutes !== null && args.delay_minutes !== "";
      const hasTime = Boolean(args.send_at_local);

      if (hasDelay === hasTime) {
        return JSON.stringify({
          error: "Indiquez UNIQUEMENT delay_minutes (ex. 2) OU send_at_local (ex. 06:30), pas les deux ni aucun.",
        });
      }

      const chatId = await resolveRecipient(recipientRaw);
      if (chatId.endsWith("@c.us")) {
        const existing = getContact(chatId);
        if (existing?.status === "stop") {
          return JSON.stringify({
            error: "Ce contact est en STOP. Impossible de programmer un envoi.",
          });
        }
      }

      let sendAt: string;
      try {
        sendAt = resolveLocalSendAt({
          delayMinutes: hasDelay ? Number(args.delay_minutes) : undefined,
          sendAtLocal: hasTime ? String(args.send_at_local) : undefined,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const isGroup = chatId.endsWith("@g.us");
      const label = isGroup
        ? recipientRaw.endsWith("@g.us")
          ? chatId
          : recipientRaw.trim()
        : chatIdToDisplay(chatId);

      const job = scheduleMessage({
        recipient: chatId,
        recipientLabel: label,
        message,
        sendAt,
      });

      return JSON.stringify({
        success: true,
        id: job.id,
        recipient: chatId,
        label,
        isGroup,
        message: job.message,
        sendAt: job.send_at,
        confirmation: `⏰ Message #${job.id} programmé pour ${label} à ${job.send_at} (heure locale).`,
      });
    }

    case "list_scheduled_messages": {
      const jobs = listScheduledMessages({
        includeDone: Boolean(args.include_done),
        limit: 50,
      });
      return JSON.stringify({
        count: jobs.length,
        messages: jobs.map((j) => ({
          id: j.id,
          recipient: j.recipient,
          label: j.recipient_label || chatIdToDisplay(j.recipient),
          message: j.message,
          sendAt: j.send_at,
          status: j.status,
          error: j.error,
          sentAt: j.sent_at,
        })),
      });
    }

    case "cancel_scheduled_message": {
      const id = Number(args.id);
      if (!Number.isInteger(id) || id < 1) {
        return JSON.stringify({ error: "ID invalide." });
      }
      try {
        const job = cancelScheduledMessage(id);
        if (!job) return JSON.stringify({ error: `Message programmé #${id} introuvable.` });
        return JSON.stringify({
          success: true,
          id: job.id,
          status: job.status,
          message: `⏰ Message programmé #${id} annulé.`,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    case "get_daily_bilan": {
      const bilan = getDailyBilan(args.date ? String(args.date) : undefined);
      return JSON.stringify({
        ...bilan,
        summary: `Bilan ${bilan.date} : ${bilan.incoming} entrant(s), ${bilan.outgoing} sortant(s), ${bilan.uniqueContacts} contact(s) actifs. Pipeline : ${bilan.contactsByStatus.nouveau} nouveau · ${bilan.contactsByStatus.en_conversation} en conversation · ${bilan.contactsByStatus.interesse} intéressé · ${bilan.contactsByStatus.stop} STOP. Programmés : ${bilan.scheduledSentToday} envoyé(s) ce jour, ${bilan.scheduledPending} en attente.`,
      });
    }

    case "get_contact_conversation": {
      const phone = String(args.phone ?? "");
      if (!phone.trim()) {
        return JSON.stringify({ error: "Le numéro / chatId est requis." });
      }
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      const thread = getContactThread(phone, limit);
      const contact = getContact(
        phone.includes("@") ? phone.trim() : `${phone.replace(/\D/g, "")}@c.us`
      );
      return JSON.stringify({
        phone: contact?.phone ?? phone,
        display: chatIdToDisplay(contact?.phone ?? phone),
        name: contact?.name ?? null,
        status: contact?.status ?? null,
        count: thread.length,
        source: "sqlite:messages",
        messages: thread.map((m) => ({
          id: m.id,
          direction: m.direction,
          sender: m.sender_name || (m.direction === "entrant" ? chatIdToDisplay(m.contact_phone) : "Moi"),
          body: m.body,
          at: m.created_at,
        })),
      });
    }

    case "save_business_profile": {
      saveBusinessProfile({
        ownerName: args.owner_name !== undefined ? String(args.owner_name) : undefined,
        offer: args.offer !== undefined ? String(args.offer) : undefined,
        price: args.price !== undefined ? String(args.price) : undefined,
      });
      const s = getAppSettings();
      return JSON.stringify({
        success: true,
        profile: {
          ownerName: s.business_owner_name,
          offer: s.business_offer,
          price: s.business_price,
        },
        message: "Profil business enregistré dans SQLite. Les prochaines réponses auto l'utiliseront.",
      });
    }

    case "get_business_profile": {
      const s = getAppSettings();
      return JSON.stringify({
        ownerName: s.business_owner_name || null,
        offer: s.business_offer || null,
        price: s.business_price || null,
        configured: Boolean(s.business_owner_name || s.business_offer),
      });
    }

    case "create_automation": {
      const type = String(args.type ?? "") as AutomationType;
      if (!["group_prospect", "keyword_sales", "custom_followup"].includes(type)) {
        return JSON.stringify({ error: "type invalide." });
      }

      const config: Record<string, unknown> = {
        initialMessage: args.initial_message ? String(args.initial_message) : undefined,
        maxMembers: args.max_members ? Number(args.max_members) : 30,
        enableAutoReply: args.enable_auto_reply !== false,
        conversationGuide: args.conversation_guide ? String(args.conversation_guide) : undefined,
        keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : undefined,
        productName: args.product_name ? String(args.product_name) : undefined,
        price: args.price ? String(args.price) : undefined,
        salesScript: args.sales_script ? String(args.sales_script) : undefined,
        personalizeMessages: args.personalize_messages === true,
        abVariants: Array.isArray(args.ab_variants)
          ? (args.ab_variants as Array<{ id?: string; message?: string }>).map((v, i) => ({
              id: v.id || `v${i + 1}`,
              message: String(v.message ?? ""),
            }))
          : undefined,
        sequenceSteps: Array.isArray(args.sequence_steps)
          ? (args.sequence_steps as Array<{ delayDays?: number; message?: string; condition?: string }>).map(
              (s) => ({
                delayDays: Number(s.delayDays ?? 1),
                message: String(s.message ?? ""),
                condition: (s.condition as "no_reply" | "always") || "no_reply",
              })
            )
          : undefined,
        mediaUrl: args.media_url ? String(args.media_url) : undefined,
        mediaType: args.media_type ? (String(args.media_type) as "image" | "document" | "audio") : undefined,
      };

      if (type === "group_prospect") {
        if (!args.group_id || !args.initial_message) {
          return JSON.stringify({
            error: "group_prospect requiert group_id et initial_message.",
          });
        }
        try {
          await requireGreenApiAuthorized("la création d'une campagne de prospection groupe");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
        const groupId = await resolveGroupId(String(args.group_id));
        const group = await findGroupByNameOrId(groupId);
        config.groupId = groupId;
        config.groupName = group?.name ?? String(args.group_id);
      }

      if (type === "keyword_sales") {
        const keywords = Array.isArray(args.keywords) ? args.keywords.map(String) : [];
        if (!keywords.length) {
          return JSON.stringify({ error: "keyword_sales requiert au moins un mot-clé." });
        }
        config.keywords = keywords;
      }

      const auto = createAutomation({
        name: String(args.name ?? "Automatisation"),
        type,
        config: config as Parameters<typeof createAutomation>[0]["config"],
        summary: args.summary ? String(args.summary) : undefined,
        budgetFcfa: args.budget_fcfa ? Number(args.budget_fcfa) : 0,
        status: "active",
      });

      let targetsAdded = 0;
      if (type === "group_prospect" && config.groupId) {
        try {
          targetsAdded = await bootstrapGroupProspectTargets(auto.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({
            error: `Automatisation créée (#${auto.id}) mais échec chargement membres : ${msg}`,
            automationId: auto.id,
          });
        }
      }

      const detail = getAutomationDetail(auto.id);
      return JSON.stringify({
        success: true,
        automationId: auto.id,
        name: auto.name,
        type: auto.type,
        status: auto.status,
        targetsAdded,
        summary: auto.summary,
        stats: detail?.automation.stats,
        message: `Automatisation « ${auto.name} » créée et active. Visible sur la page Automatisation.`,
        pageHint: "L'utilisateur peut ouvrir Automatisation (bouton en haut) pour suivre les stats.",
        completedAt: nowFr(),
      });
    }

    case "list_automations": {
      const status = args.status ? (String(args.status) as AutomationStatus) : undefined;
      const list = listAutomations(status ? { status, limit: 50 } : { limit: 50 });
      return JSON.stringify({
        count: list.length,
        automations: list.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          status: a.status,
          summary: a.summary,
          stats: a.stats,
          budgetFcfa: a.budget_fcfa,
          createdAt: a.created_at,
        })),
      });
    }

    case "get_automation_report": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      const detail = getAutomationDetail(id);
      if (!detail) {
        return JSON.stringify({ error: `Automatisation #${id} introuvable.` });
      }
      const { automation, targets, logs } = detail;
      return JSON.stringify({
        id: automation.id,
        name: automation.name,
        type: automation.type,
        status: automation.status,
        summary: automation.summary,
        config: automation.config,
        stats: automation.stats,
        budgetFcfa: automation.budget_fcfa,
        targetsTotal: targets.length,
        targetsPending: targets.filter((t) => t.status === "pending").length,
        targetsContacted: targets.filter((t) => t.status === "contacted").length,
        targetsReplied: targets.filter((t) => t.status === "replied").length,
        recentLogs: logs.slice(0, 15).map((l) => ({
          level: l.level,
          message: l.message,
          at: l.created_at,
        })),
      });
    }

    case "set_automation_status": {
      const id = Number(args.automation_id);
      const status = String(args.status ?? "") as "active" | "paused" | "completed";
      if (!Number.isFinite(id) || !["active", "paused", "completed"].includes(status)) {
        return JSON.stringify({ error: "Paramètres invalides." });
      }
      const updated = updateAutomationStatus(id, status);
      if (!updated) {
        return JSON.stringify({ error: `Automatisation #${id} introuvable.` });
      }
      return JSON.stringify({
        success: true,
        automationId: id,
        status: updated.status,
        message: `Automatisation #${id} → ${status}.`,
      });
    }

    case "create_group_rule": {
      const groupId = await resolveGroupId(String(args.group_id ?? ""));
      const keywords = Array.isArray(args.keywords)
        ? args.keywords.map((k) => String(k).trim()).filter(Boolean)
        : [];
      const replyGuide = String(args.reply_guide ?? "").trim();
      if (!keywords.length || !replyGuide) {
        return JSON.stringify({ error: "keywords et reply_guide requis." });
      }
      const group = await findGroupByNameOrId(groupId);
      const rule = createGroupReplyRule({
        groupId,
        groupLabel: group?.name,
        keywords,
        replyGuide,
        automationId: args.automation_id != null ? Number(args.automation_id) : undefined,
      });
      return JSON.stringify({
        success: true,
        ruleId: rule.id,
        groupId: rule.group_id,
        keywords: rule.keywords,
        message: `Règle groupe créée pour ${group?.name || groupId}.`,
      });
    }

    default:
      return JSON.stringify({ error: `Outil inconnu : ${name}` });
  }
}
