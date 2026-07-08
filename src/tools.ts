import type OpenAI from "openai";
import {
  getGreenApiCredentials,
  getChatHistory,
  getGroupMembers,
  findGroupByNameOrId,
  listPersonalContacts,
  listWhatsAppGroups,
  messageGroupMembers,
  normalizePhoneToChatId,
  sendWhatsAppMessage,
  testGreenApiConnection,
  chatIdToDisplay,
} from "./greenapi.js";
import {
  CONTACT_STATUSES,
  blockContact,
  cancelScheduledMessage,
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
  getAppSettings,
  getContact,
  getContactThread,
  getDailyBilan,
  listContacts,
  listIncomingMessages,
  listScheduledMessages,
  resolveLocalSendAt,
  saveBusinessProfile,
  saveContact,
  scheduleMessage,
  setContactAutoReply,
  type ContactStatus,
  unblockContact,
} from "./db.js";

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
      name: "get_business_profile",
      description: "Lit le profil business actuel (nom, offre, tarif) stocké en SQLite.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
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
]);

async function resolveRecipient(recipient: string): Promise<string> {
  const trimmed = recipient.trim();
  if (!trimmed) throw new Error("Destinataire vide.");

  // Déjà un chatId valide
  if (trimmed.endsWith("@c.us") || trimmed.endsWith("@g.us") || trimmed.endsWith("@lid")) {
    return trimmed;
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

    default:
      return JSON.stringify({ error: `Outil inconnu : ${name}` });
  }
}
