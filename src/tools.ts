import type OpenAI from "openai";
import {
  getEvolutionCredentials,
  getChatHistory,
  getGroupMembers,
  getLastIncomingMessages,
  createWhatsAppGroup,
  findGroupByNameOrId,
  getGroupInfo,
  updateGroupSubject,
  updateGroupDescription,
  updateGroupPicture,
  updateGroupParticipants,
  updateGroupSetting,
  toggleGroupEphemeral,
  getGroupInviteCode,
  revokeGroupInviteCode,
  getGroupInviteInfo,
  acceptGroupInvite,
  sendGroupInvite,
  leaveWhatsAppGroup,
  listPersonalContacts,
  listWhatsAppChats,
  listWhatsAppGroups,
  listWhatsAppChannels,
  markChatRead,
  markChatUnread,
  archiveChat,
  editWhatsAppMessage,
  deleteWhatsAppMessage,
  getMessageMediaBase64,
  searchWhatsAppMessages,
  sendWhatsAppPresence,
  checkWhatsAppNumbers,
  fetchProfilePictureUrl,
  fetchContactProfile,
  fetchContactBusinessProfile,
  updateWhatsAppBlockStatus,
  updateProfileName,
  updateProfileStatus,
  updateProfilePicture,
  removeProfilePicture,
  fetchPrivacySettings,
  updatePrivacySettings,
  messageGroupMembers,
  normalizePhoneToChatId,
  normalizeGroupParticipantId,
  isLikelyPhoneJid,
  sendWhatsAppMessage,
  sendWhatsAppChannelMessage,
  sendWhatsAppMedia,
  sendWhatsAppVoice,
  sendWhatsAppLocation,
  sendWhatsAppContact,
  sendWhatsAppReaction,
  sendWhatsAppPoll,
  sendWhatsAppList,
  sendWhatsAppSticker,
  sendWhatsAppMediaStatus,
  sendWhatsAppTextStatus,
  testEvolutionConnection,
  chatIdToDisplay,
  chatIdToNumber,
  requireEvolutionConnected,
} from "./evolutionapi.js";
import { needsAppointmentLink } from "./campaign-briefing.js";
import {
  CONTACT_STATUSES,
  blockContact,
  cancelScheduledMessage,
  countOutboundToday,
  createAutomation,
  createGroupReplyRule,
  getEffectiveOutboundLimit,
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
  pauseAutomation,
  resumeAutomation,
  updateAutomationConfig,
  deleteAutomation,
  listProspectedContacts,
  type AutomationStatus,
  type AutomationType,
  type ContactStatus,
  type AutomationConfig,
  unblockContact,
} from "./db.js";
import {
  bootstrapGroupProspectTargets,
  bootstrapContactProspectTargets,
} from "./automation-engine.js";
import { getContactPresence } from "./notifications.js";
import { findPlaceholderFields, hasTemplatePlaceholders } from "./outbound-sanitize.js";

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "check_whatsapp_connection",
      description: "Vérifie si WhatsApp est connecté via Evolution API.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_groups",
      description:
        "Liste tous les groupes WhatsApp dont l'utilisateur est membre, avec leur nom lisible et leur ID (@g.us).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_channels",
      description:
        "Liste les chaînes / newsletters WhatsApp (@newsletter) suivies par le compte, avec noms et IDs.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "send_channel_message",
      description:
        "Publie un message texte dans une chaîne WhatsApp existante (ID @newsletter). Impossible de créer une chaîne — uniquement envoyer dans une chaîne déjà liée au compte.",
      parameters: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description: "ID de la chaîne (xxx@newsletter). Obtenir via list_whatsapp_channels.",
          },
          message: { type: "string", description: "Texte à publier dans la chaîne." },
        },
        required: ["channel_id", "message"],
        additionalProperties: false,
      },
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
      name: "get_group_info",
      description:
        "Récupère les infos complètes d'un groupe WhatsApp (description, paramètres, taille…) par JID (@g.us) ou nom.",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "ID du groupe (@g.us) ou nom (ex. Automax)" },
        },
        required: ["group_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_group",
      description:
        "Modifie un groupe WhatsApp : nom (subject), description, photo, paramètres (mode annonce/discussion, verrouillage), messages éphémères.",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "ID du groupe (@g.us) ou nom" },
          subject: { type: "string", description: "Nouveau nom du groupe" },
          description: { type: "string", description: "Nouvelle description" },
          picture: { type: "string", description: "Nouvelle photo : URL publique ou base64" },
          setting: {
            type: "string",
            enum: ["announcement", "not_announcement", "locked", "unlocked"],
            description:
              "announcement=seuls admins envoient, not_announcement=tout le monde, locked=seuls admins modifient infos, unlocked=tout le monde",
          },
          ephemeral_seconds: {
            type: "number",
            description: "Messages éphémères en secondes (0=désactivé, 86400=24h, 604800=7j, 7776000=90j)",
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
      name: "manage_group_participants",
      description: "Gère les participants d'un groupe : ajouter, retirer, promouvoir admin, rétrograder admin.",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "ID du groupe (@g.us) ou nom" },
          action: {
            type: "string",
            enum: ["add", "remove", "promote", "demote"],
            description: "add=ajouter, remove=retirer, promote=admin, demote=retirer admin",
          },
          participants: {
            type: "array",
            items: { type: "string" },
            description: "Numéros des participants (+229… ou international)",
          },
        },
        required: ["group_id", "action", "participants"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "group_invite",
      description:
        "Gestion des invitations de groupe : obtenir le lien, révoquer le lien, consulter un groupe par code, accepter une invitation, envoyer une invitation à des numéros.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["get_code", "revoke_code", "info", "accept", "send"],
            description:
              "get_code=obtenir lien, revoke_code=révoquer+nouveau lien, info=infos via code, accept=rejoindre via code, send=envoyer invitation à des numéros",
          },
          group_id: { type: "string", description: "ID/nom du groupe (requis sauf info/accept)" },
          invite_code: {
            type: "string",
            description: "Code ou URL d'invitation (pour info/accept, ex. https://chat.whatsapp.com/XXXX)",
          },
          numbers: {
            type: "array",
            items: { type: "string" },
            description: "Numéros à inviter (action=send)",
          },
          description: { type: "string", description: "Message d'accompagnement de l'invitation (action=send)" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leave_group",
      description: "Quitte un groupe WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "ID du groupe (@g.us) ou nom" },
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
        "Liste les contacts du carnet WhatsApp via Evolution API (hors groupes). À utiliser seulement si l'utilisateur demande explicitement les contacts WhatsApp / carnet d'adresses.",
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
        "Récupère l'historique d'une conversation WhatsApp via Evolution API (messages entrants et sortants).",
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
      description: "Retire le statut STOP d'un contact (remet en_conversation) et le débloque aussi sur WhatsApp.",
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
      name: "send_presence",
      description:
        "Affiche une présence à un contact/groupe : « en train d'écrire » (composing), « en train d'enregistrer un vocal » (recording), « en ligne » (available), « hors ligne » (unavailable), ou « en pause » (paused).",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…), chatId (@c.us / @g.us) ou nom de groupe" },
          presence: {
            type: "string",
            enum: ["composing", "recording", "available", "unavailable", "paused"],
            description: "Type de présence à afficher",
          },
          duration_ms: { type: "number", description: "Durée d'affichage en ms (défaut 3000, max 20000)" },
        },
        required: ["recipient", "presence"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_whatsapp_number",
      description:
        "Vérifie si un ou plusieurs numéros sont enregistrés sur WhatsApp. Renvoie pour chacun exists (true/false) et le jid WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          numbers: {
            type: "array",
            items: { type: "string" },
            description: "Numéros à vérifier (format +229… ou international)",
          },
        },
        required: ["numbers"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_profile_picture",
      description: "Récupère l'URL de la photo de profil d'un contact (null si masquée ou absente).",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…) ou chatId" },
        },
        required: ["recipient"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_profile",
      description:
        "Récupère le profil d'un contact WhatsApp (nom, statut/bio, photo, indicateur business le cas échéant).",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…) ou chatId" },
        },
        required: ["recipient"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_business_profile",
      description:
        "Récupère le profil BUSINESS d'un contact (description, catégorie, email, adresse, site web). Null si ce n'est pas un compte WhatsApp Business.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…) ou chatId" },
        },
        required: ["recipient"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_presence",
      description:
        "Consulte la dernière présence connue d'un contact (en ligne, en train d'écrire, d'enregistrer, hors ligne…), reçue via le webhook. Sans recipient : liste toutes les présences connues. Astuce : appeler d'abord send_presence pour t'abonner à sa présence.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…) ou chatId (optionnel)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_my_profile",
      description:
        "Modifie le profil DU COMPTE WhatsApp connecté (le nôtre, pas un contact) : nom affiché, statut/bio, photo de profil (URL ou base64), ou suppression de la photo. Renseigner uniquement les champs à changer.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nouveau nom affiché du profil" },
          status: { type: "string", description: "Nouveau statut / bio (« À propos »)" },
          picture: { type: "string", description: "Nouvelle photo de profil : URL publique ou base64" },
          remove_picture: { type: "boolean", description: "true pour SUPPRIMER la photo de profil actuelle" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_privacy_settings",
      description: "Consulte les paramètres de confidentialité du compte WhatsApp connecté (accusés de lecture, photo, statut, en ligne, dernière connexion, ajout aux groupes).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_privacy_settings",
      description:
        "Modifie les paramètres de confidentialité du compte connecté. Renseigner uniquement les champs à changer ; les autres restent inchangés.",
      parameters: {
        type: "object",
        properties: {
          readreceipts: {
            type: "string",
            enum: ["all", "none"],
            description: "Accusés de lecture (coches bleues)",
          },
          profile: {
            type: "string",
            enum: ["all", "contacts", "contact_blacklist", "none"],
            description: "Qui peut voir ma photo de profil",
          },
          status: {
            type: "string",
            enum: ["all", "contacts", "contact_blacklist", "none"],
            description: "Qui peut voir mon statut/bio",
          },
          online: {
            type: "string",
            enum: ["all", "match_last_seen"],
            description: "Qui peut voir quand je suis en ligne",
          },
          last: {
            type: "string",
            enum: ["all", "contacts", "contact_blacklist", "none"],
            description: "Qui peut voir ma dernière connexion",
          },
          groupadd: {
            type: "string",
            enum: ["all", "contacts", "contact_blacklist"],
            description: "Qui peut m'ajouter aux groupes",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_message",
      description:
        "Envoie UN message texte WhatsApp. Destinataire : numéro personnel (+229…), chatId (@c.us), ID de groupe (@g.us), OU nom de groupe (ex. Automax). Pour poster DANS un groupe, utiliser cet outil — PAS message_all_group_members. Supporte aussi : répondre en citant un message (reply_to_message_id), mentionner des membres (mentions + @numéro dans le texte), mentionner tout le monde (mention_everyone, groupes), et l'aperçu de lien (link_preview).",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description:
              "Numéro (+229…), chatId personnel, ID groupe (@g.us), ou nom de groupe WhatsApp",
          },
          message: { type: "string", description: "Texte du message (gras *…*, italique _…_, barré ~…~, code ```…```, emojis)" },
          reply_to_message_id: {
            type: "string",
            description:
              "ID du message à citer/répondre (ex. idMessage via list_green_incoming_messages). Affiche la carte de citation WhatsApp.",
          },
          mentions: {
            type: "array",
            items: { type: "string" },
            description:
              "Numéros à mentionner (chiffres, ex. 22990000000). IMPORTANT : inclure aussi @numéro dans le texte pour chaque personne (ex. « Salut @22990000000 »). Groupes uniquement.",
          },
          mention_everyone: {
            type: "boolean",
            description: "true pour mentionner TOUS les membres du groupe (@everyone). Groupes uniquement.",
          },
          link_preview: {
            type: "boolean",
            description: "true pour afficher l'aperçu de lien (carte) des URLs du message. Défaut : comportement natif.",
          },
          delay_ms: {
            type: "number",
            description: "Délai en millisecondes d'affichage « en train d'écrire… » avant l'envoi (max 20000). Ex. 3000 pour 3s.",
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
      name: "send_whatsapp_reaction",
      description:
        "Réagit à un message WhatsApp avec un emoji (👍❤️😂🔥…). Pour retirer une réaction déjà posée, laisser emoji vide. Récupérer message_id via list_green_incoming_messages.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "chatId (@c.us / @g.us), numéro (+229…) ou nom de groupe où se trouve le message",
          },
          message_id: { type: "string", description: "ID du message ciblé (idMessage)" },
          emoji: { type: "string", description: "Emoji de réaction (ex. 👍). Vide = retirer la réaction." },
          from_me: {
            type: "boolean",
            description: "true si le message ciblé a été envoyé par nous. Défaut : false (message reçu).",
          },
        },
        required: ["recipient", "message_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_media",
      description:
        "Envoie un MÉDIA WhatsApp (image, vidéo ou document) à un contact ou un groupe. La source peut être une URL publique OU du base64 (préfixe data: accepté). Utiliser pour « envoie cette image/vidéo/ce PDF à … ».",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Numéro (+229…), chatId (@c.us), ID groupe (@g.us) ou nom de groupe",
          },
          media: {
            type: "string",
            description: "URL publique du fichier OU chaîne base64 (data:...;base64,... accepté)",
          },
          type: {
            type: "string",
            enum: ["image", "video", "document"],
            description: "Type de média",
          },
          caption: { type: "string", description: "Légende / texte accompagnant (optionnel)" },
          file_name: {
            type: "string",
            description: "Nom du fichier (recommandé pour les documents, ex. devis.pdf)",
          },
          mimetype: {
            type: "string",
            description: "MIME explicite si base64 (ex. video/mp4, application/pdf, image/jpeg)",
          },
        },
        required: ["recipient", "media", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_voice",
      description:
        "Envoie une VRAIE note vocale WhatsApp (PTT, avec forme d'onde). La source audio peut être une URL publique OU du base64. Utiliser pour « envoie un message vocal / une note audio à … ».",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Numéro (+229…), chatId (@c.us), ID groupe (@g.us) ou nom de groupe",
          },
          audio: {
            type: "string",
            description: "URL publique du fichier audio OU base64 (data:...;base64,... accepté)",
          },
        },
        required: ["recipient", "audio"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_location",
      description:
        "Envoie une LOCALISATION (épingle carte) avec nom et adresse. Utiliser pour « partage ma position / l'adresse de … ». Fournir latitude et longitude.",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Numéro (+229…), chatId (@c.us), ID groupe (@g.us) ou nom de groupe",
          },
          latitude: { type: "number", description: "Latitude (ex. 6.3703)" },
          longitude: { type: "number", description: "Longitude (ex. 2.3912)" },
          name: { type: "string", description: "Nom du lieu (ex. Bureau Klanvio)" },
          address: { type: "string", description: "Adresse / description (optionnel)" },
        },
        required: ["recipient", "latitude", "longitude"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_contact",
      description:
        "Envoie une CARTE CONTACT (vCard) : nom, entreprise, téléphone, email, URL. Utiliser pour « partage le contact de … ».",
      parameters: {
        type: "object",
        properties: {
          recipient: {
            type: "string",
            description: "Numéro (+229…), chatId (@c.us), ID groupe (@g.us) ou nom de groupe",
          },
          full_name: { type: "string", description: "Nom complet du contact partagé" },
          phone: { type: "string", description: "Téléphone du contact (ex. +229…)" },
          organization: { type: "string", description: "Entreprise (optionnel)" },
          email: { type: "string", description: "Email (optionnel)" },
          url: { type: "string", description: "Site web / lien (optionnel)" },
        },
        required: ["recipient", "full_name", "phone"],
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
        "Publie un STATUT WhatsApp (story) : texte, image, vidéo ou audio. Utiliser quand l'utilisateur demande de poster/publier un statut/une story WhatsApp. Audience : par défaut tous les contacts, ou ciblée via participants.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["text", "image", "video", "audio"],
            description: "Type de statut. Défaut : text.",
          },
          message: {
            type: "string",
            description: "Texte du statut (type=text, max 500 caractères) OU légende pour un média.",
          },
          media: {
            type: "string",
            description: "URL publique OU base64 du média (requis pour type image/video/audio).",
          },
          background_color: {
            type: "string",
            description: "Couleur fond hex (statut texte/image, défaut #228B22, éviter blanc)",
          },
          font: {
            type: "string",
            enum: ["SERIF", "SAN_SERIF", "NORICAN", "BRYNDAN", "BEBAS"],
            description: "Police du statut texte (défaut SERIF).",
          },
          participants: {
            type: "array",
            items: { type: "string" },
            description: "Numéros ciblés (optionnel). Sinon publié pour tous les contacts.",
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
      name: "send_whatsapp_poll",
      description:
        "Envoie un SONDAGE (poll) à un contact ou un groupe. Les votes reviennent automatiquement et apparaissent dans les messages entrants (best-effort selon Evolution).",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…), chatId (@c.us), ID/nom de groupe (@g.us)" },
          question: { type: "string", description: "La question du sondage" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Options du sondage (2 minimum)",
          },
          selectable_count: {
            type: "number",
            description: "Nombre de choix qu'un votant peut sélectionner (défaut 1)",
          },
          delay_ms: { type: "number", description: "Délai « écrit… » avant envoi (ms, optionnel)" },
        },
        required: ["recipient", "question", "options"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_list",
      description:
        "Envoie une LISTE interactive (menu de sélection avec sections). EXPÉRIMENTAL : le rendu dépend de la version WhatsApp du destinataire, à utiliser en test.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…), chatId ou groupe" },
          title: { type: "string", description: "Titre de la liste" },
          description: { type: "string", description: "Texte du corps" },
          button_text: { type: "string", description: "Libellé du bouton (ex. « Voir les options »)" },
          footer_text: { type: "string", description: "Texte de pied (optionnel)" },
          sections: {
            type: "array",
            description: "Sections de la liste",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Titre de la section" },
                rows: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      rowId: { type: "string" },
                    },
                    required: ["title"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["title", "rows"],
              additionalProperties: false,
            },
          },
          delay_ms: { type: "number", description: "Délai « écrit… » avant envoi (ms, optionnel)" },
        },
        required: ["recipient", "title", "description", "button_text", "sections"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_sticker",
      description:
        "Envoie un STICKER (image statique WebP/PNG/JPEG). La source peut être une URL publique ou du base64.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Numéro (+229…), chatId ou groupe" },
          sticker: { type: "string", description: "URL publique OU base64 de l'image du sticker" },
          delay_ms: { type: "number", description: "Délai « écrit… » avant envoi (ms, optionnel)" },
        },
        required: ["recipient", "sticker"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_chats",
      description:
        "Liste les conversations WhatsApp (contacts, groupes, chaînes) avec noms lisibles et IDs.",
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
      description: "Marque un chat ou un message comme lu.",
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
      name: "mark_chat_unread",
      description: "Marque un chat comme NON LU (pastille non lue). Nécessite l'ID d'un message récent du chat.",
      parameters: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "chatId (@c.us / @g.us), numéro +229… ou nom de groupe" },
          message_id: { type: "string", description: "ID d'un message récent du chat (via list_green_incoming_messages / search_messages)" },
          from_me: { type: "boolean", description: "true si ce message a été envoyé par nous. Défaut : false." },
        },
        required: ["chat_id", "message_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_chat",
      description: "Archive ou désarchive un chat. Nécessite l'ID d'un message récent du chat.",
      parameters: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "chatId (@c.us / @g.us), numéro +229… ou nom de groupe" },
          message_id: { type: "string", description: "ID d'un message récent du chat" },
          archive: { type: "boolean", description: "true pour archiver, false pour désarchiver. Défaut : true." },
          from_me: { type: "boolean", description: "true si ce message a été envoyé par nous. Défaut : false." },
        },
        required: ["chat_id", "message_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_message",
      description: "Modifie le TEXTE d'un message déjà envoyé PAR NOUS (édition WhatsApp). Fonctionne dans les ~15 min après l'envoi.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "chatId (@c.us / @g.us), numéro +229… ou nom de groupe" },
          message_id: { type: "string", description: "ID du message à modifier (envoyé par nous)" },
          new_text: { type: "string", description: "Nouveau texte du message" },
        },
        required: ["recipient", "message_id", "new_text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_message",
      description: "Supprime un message POUR TOUT LE MONDE (revoke). Doit avoir été envoyé par nous (sauf admin de groupe).",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "chatId (@c.us / @g.us), numéro +229… ou nom de groupe" },
          message_id: { type: "string", description: "ID du message à supprimer" },
          from_me: { type: "boolean", description: "true si le message a été envoyé par nous. Défaut : true." },
          participant: { type: "string", description: "En groupe : JID de l'auteur du message (optionnel)" },
        },
        required: ["recipient", "message_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_message_media",
      description: "Récupère le média (image/vidéo/audio/document) d'un message en base64 (data URL). Utile pour ré-envoyer ou analyser un fichier reçu.",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "ID du message contenant le média" },
          convert_to_mp4: { type: "boolean", description: "Convertir la vidéo/audio en mp4 (optionnel)" },
        },
        required: ["message_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_messages",
      description: "Recherche/liste des messages WhatsApp. Filtre par chat (recipient) et/ou texte (query). Pour les messages de STATUT, mettre recipient='status@broadcast'.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "chatId, numéro, nom de groupe, ou 'status@broadcast' pour les statuts. Optionnel." },
          query: { type: "string", description: "Texte à rechercher dans les messages (optionnel)" },
          count: { type: "number", description: "Nombre max de résultats (défaut 50, max 200)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_green_incoming_messages",
      description:
        "Derniers messages entrants sur l'instance Evolution API, hors base locale.",
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
        "Crée une campagne WhatsApp en BROUILLON (draft) — visible sur Automatisation mais PAS active. Utiliser pour prospection groupe ou closing e-commerce. L'activation se fait via activate_automation après simulation validée et confirmation utilisateur.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nom court de la campagne" },
          type: {
            type: "string",
            enum: ["group_prospect", "contact_prospect", "keyword_sales", "custom_followup"],
            description:
              "group_prospect = prospection sortante d'un groupe ; contact_prospect = prospection d'un ou plusieurs contacts précis (hors groupe) ; keyword_sales = closing entrant sur déclencheur exact",
          },
          summary: { type: "string", description: "Résumé en une phrase" },
          group_id: { type: "string", description: "ID ou nom du groupe (@g.us ou nom) — group_prospect" },
          contacts: {
            type: "array",
            items: { type: "string" },
            description:
              "contact_prospect : liste des contacts à prospecter (numéros +229…, chatId, ou noms exacts présents dans les contacts). 1 ou plusieurs.",
          },
          initial_message: { type: "string", description: "Premier message pour group_prospect / contact_prospect" },
          max_members: { type: "number", description: "Limite de membres pour group_prospect (défaut 30)" },
          max_per_day: {
            type: "number",
            description: "Nombre max de premiers messages envoyés par jour pour cette campagne (anti-blocage)",
          },
          min_delay_seconds: {
            type: "number",
            description: "Délai minimum entre deux envois, en secondes (anti-blocage, min 30)",
          },
          max_delay_seconds: {
            type: "number",
            description: "Délai maximum entre deux envois, en secondes (anti-blocage)",
          },
          quiet_hours_start: {
            type: "number",
            description:
              "Heure (0-23) de début des heures calmes (PAS d'envoi). Ex. activité 9h-18h → quiet_hours_start=18",
          },
          quiet_hours_end: {
            type: "number",
            description:
              "Heure (0-23) de fin des heures calmes. Ex. activité 9h-18h → quiet_hours_end=9",
          },
          scheduled_start_at: {
            type: "string",
            description:
              "Date/heure de lancement différé (ISO 8601 ou 'YYYY-MM-DD HH:mm'). Omettre = dès activation.",
          },
          enable_auto_reply: {
            type: "boolean",
            description: "Réponses auto pour les prospects contactés (défaut true)",
          },
          conversation_guide: {
            type: "string",
            description: "Instructions pour guider les échanges (ton, style, objectif)",
          },
          closing_goal: {
            type: "string",
            enum: ["payment", "delivery", "link", "appointment"],
            description: "Objectif final pour inbound_closing",
          },
          trigger_phrases: {
            type: "array",
            items: { type: "string" },
            description:
              "Mots/phrases EXACTS déclencheurs pour keyword_sales (ex. « je suis intéressé par ce produit »)",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Alias de trigger_phrases (rétrocompat)",
          },
          product_name: {
            type: "string",
            description: "Nom du produit / offre (valeur réelle, sans crochets)",
          },
          price: {
            type: "string",
            description: "Prix réel en FCFA (ex. « 25000 FCFA ») — OBLIGATOIRE si on vend quelque chose. Jamais [prix].",
          },
          closing_link: {
            type: "string",
            description:
              "URL réelle à envoyer aux prospects (Calendly, paiement, landing…). Obligatoire si l'objectif est RDV / paiement / lien. Jamais [lien].",
          },
          sales_script: { type: "string", description: "Script / argumentaire (sans crochets)" },
          relance_enabled: { type: "boolean", description: "Activer les relances si pas de réponse" },
          relance_delays_days: {
            type: "array",
            items: { type: "number" },
            description: "Délais de relance en jours (ex. [1, 2] = J+1 puis J+2)",
          },
          relance_hour: {
            type: "number",
            description: "Heure d'envoi des relances (0-23, ex. 8 pour 8h)",
          },
          relance_messages: {
            type: "array",
            items: { type: "string" },
            description: "Textes des relances (un par délai)",
          },
          stop_on_dissatisfaction: {
            type: "boolean",
            description: "Arrêter si mécontentement (défaut true)",
          },
          stop_on_unknown_question: {
            type: "boolean",
            description: "Arrêter si question sans réponse (défaut true)",
          },
          budget_fcfa: { type: "number", description: "Budget estimé FCFA (optionnel)" },
          personalize_messages: { type: "boolean", description: "Personnaliser chaque DM (group_prospect)" },
          ab_variants: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, message: { type: "string" } },
            },
            description: "Variantes A/B",
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
            description: "Relances (alternative à relance_*)",
          },
          media_url: { type: "string" },
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
            enum: ["draft", "active", "paused", "completed", "failed"],
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
      name: "activate_automation",
      description:
        "Active une campagne en brouillon (draft) après confirmation utilisateur. Pour group_prospect : charge les membres et démarre l'envoi. Pour keyword_sales : commence à écouter les déclencheurs.",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number", description: "ID de la campagne à activer" },
        },
        required: ["automation_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_automation_config",
      description: "Modifie la configuration d'une campagne (brouillon ou active).",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number" },
          initial_message: { type: "string" },
          conversation_guide: { type: "string" },
          trigger_phrases: { type: "array", items: { type: "string" } },
          product_name: { type: "string" },
          price: { type: "string" },
          closing_link: { type: "string", description: "URL réelle (RDV / paiement / landing), sans crochets" },
          sales_script: { type: "string" },
          closing_goal: { type: "string", enum: ["payment", "delivery", "link", "appointment"] },
          relance_enabled: { type: "boolean" },
          relance_delays_days: { type: "array", items: { type: "number" } },
          relance_hour: { type: "number" },
          relance_messages: { type: "array", items: { type: "string" } },
          max_members: { type: "number" },
          quiet_hours_start: { type: "number" },
          quiet_hours_end: { type: "number" },
          scheduled_start_at: { type: "string" },
        },
        required: ["automation_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_automation",
      description: "Supprime une campagne et toutes ses données (cibles, logs, relances en attente).",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number" },
        },
        required: ["automation_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_prospected_contacts",
      description: "Liste les personnes déjà contactées par une ou toutes les campagnes de prospection.",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number", description: "Filtrer par campagne (optionnel)" },
          limit: { type: "number", description: "Max résultats (défaut 200)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_automation_status",
      description:
        "Active, met en pause ou marque terminée une automatisation. paused = coupe TOUS les envois (file, relances) et les réponses auto des prospects.",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number" },
          status: {
            type: "string",
            enum: ["active", "paused", "completed"],
            description:
              "active = reprendre (réponses + envois), paused = tout couper (préféré pour arrêter), completed = marquer terminée manuellement",
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
      name: "create_whatsapp_group",
      description:
        "Crée un nouveau groupe WhatsApp avec un nom (subject) et au moins un participant (numéro international). WhatsApp exige minimum 1 membre en plus du créateur.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Nom du groupe (ex. TEXTE, Automax)" },
          participants: {
            type: "array",
            items: { type: "string" },
            description:
              "Numéros à ajouter (ex. +22945584212). Au moins 1 requis. Si absent, le contact prospect le plus récent sera utilisé.",
          },
          description: { type: "string", description: "Description du groupe (optionnel)" },
          promote_participants: {
            type: "boolean",
            description: "Promouvoir tous les participants admin (défaut false)",
          },
        },
        required: ["subject"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_campaign_simulation",
      description:
        "OBLIGATOIRE dès que l'utilisateur accepte une simulation. Affiche un fil court (EXACTEMENT 3 ou 4 messages max — économie tokens) dans le chat agent — aucun envoi WhatsApp. Après affichage, l'utilisateur doit dire ce qu'il change ou valide. Ne jamais annoncer « Voici comment… : » sans cet outil.",
      parameters: {
        type: "object",
        properties: {
          turns: {
            type: "array",
            description: "Exactement 3 ou 4 répliques alternées Toi / Prospect (JAMAIS plus de 4)",
            minItems: 3,
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                speaker: {
                  type: "string",
                  enum: ["toi", "prospect"],
                  description: "toi = message de l'entreprise ; prospect = réponse du contact",
                },
                name: {
                  type: "string",
                  description: "Prénom du prospect (si speaker=prospect). Défaut : Prospect",
                },
                text: {
                  type: "string",
                  description: "Texte du message WhatsApp (valeurs réelles, SANS crochets [ ])",
                },
              },
              required: ["speaker", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["turns"],
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

/** Outils qui n'ont pas besoin d'Evolution API immédiatement */
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
  "activate_automation",
  "update_automation_config",
  "delete_automation",
  "list_prospected_contacts",
  "show_campaign_simulation",
  "create_group_rule",
]);

async function resolveRecipient(userId: number, recipient: string): Promise<string> {
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
  const group = await findGroupByNameOrId(userId, trimmed);
  if (group) return group.id;

  throw new Error(
    `Destinataire introuvable : « ${trimmed} ». Indiquez un numéro (+229…), un chatId, ou le nom exact d'un groupe WhatsApp.`
  );
}

async function resolveGroupId(userId: number, groupIdOrName: string): Promise<string> {
  const trimmed = groupIdOrName.trim();
  if (trimmed.endsWith("@g.us")) return trimmed;
  const group = await findGroupByNameOrId(userId, trimmed);
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

function buildAutomationConfigFromArgs(
  args: Record<string, unknown>,
  type: AutomationType
): AutomationConfig {
  const triggerPhrases = Array.isArray(args.trigger_phrases)
    ? args.trigger_phrases.map(String).filter(Boolean)
    : Array.isArray(args.keywords)
      ? args.keywords.map(String).filter(Boolean)
      : undefined;

  const relanceEnabled = args.relance_enabled === true;
  const relanceDelays = Array.isArray(args.relance_delays_days)
    ? args.relance_delays_days.map((d) => Number(d)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const isOutbound = type === "group_prospect" || type === "contact_prospect";
  const clampSeconds = (v: unknown): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.max(30, Math.round(n));
  };

  const config: AutomationConfig = {
    mode: isOutbound ? "outbound_prospect" : type === "keyword_sales" ? "inbound_closing" : undefined,
    initialMessage: args.initial_message ? String(args.initial_message) : undefined,
    maxMembers: args.max_members ? Number(args.max_members) : 30,
    maxPerDay:
      args.max_per_day != null && Number.isFinite(Number(args.max_per_day)) && Number(args.max_per_day) > 0
        ? Math.round(Number(args.max_per_day))
        : undefined,
    minDelaySeconds: clampSeconds(args.min_delay_seconds),
    maxDelaySeconds: clampSeconds(args.max_delay_seconds),
    enableAutoReply: args.enable_auto_reply !== false,
    conversationGuide: args.conversation_guide ? String(args.conversation_guide) : undefined,
    triggerPhrases,
    keywords: triggerPhrases,
    productName: args.product_name ? String(args.product_name) : undefined,
    price: args.price ? String(args.price) : undefined,
    closingLink: args.closing_link ? String(args.closing_link).trim() : undefined,
    salesScript: args.sales_script ? String(args.sales_script) : undefined,
    closingGoal: args.closing_goal
      ? (String(args.closing_goal) as AutomationConfig["closingGoal"])
      : undefined,
    stopOnDissatisfaction: args.stop_on_dissatisfaction !== false,
    stopOnUnknownQuestion: args.stop_on_unknown_question !== false,
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

  const qStart = args.quiet_hours_start != null ? Number(args.quiet_hours_start) : NaN;
  const qEnd = args.quiet_hours_end != null ? Number(args.quiet_hours_end) : NaN;
  if (Number.isFinite(qStart) && qStart >= 0 && qStart <= 23) {
    config.quietHoursStart = Math.round(qStart);
  }
  if (Number.isFinite(qEnd) && qEnd >= 0 && qEnd <= 23) {
    config.quietHoursEnd = Math.round(qEnd);
  }
  if (args.scheduled_start_at) {
    const raw = String(args.scheduled_start_at).trim();
    if (raw) config.scheduledStartAt = raw;
  }

  if (relanceEnabled && relanceDelays.length) {
    config.relance = {
      enabled: true,
      delaysDays: relanceDelays,
      hour:
        args.relance_hour != null && Number.isFinite(Number(args.relance_hour))
          ? Number(args.relance_hour)
          : undefined,
      messages: Array.isArray(args.relance_messages)
        ? args.relance_messages.map(String).filter(Boolean)
        : undefined,
    };
  }

  return config;
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

export async function executeTool(userId: number, name: string, args: Record<string, unknown>): Promise<string> {
  if (!LOCAL_TOOLS.has(name)) {
    if (!(await getEvolutionCredentials(userId))) {
      return JSON.stringify({
        error:
          "Evolution API non configurée. Demandez à l'utilisateur d'ouvrir « Connexions » et de connecter WhatsApp.",
      });
    }
    const connection = await testEvolutionConnection(userId);
    if (!connection.connected) {
      return JSON.stringify({
        error: `WhatsApp non connecté (état : ${connection.state}). ${connection.message} Impossible d'exécuter « ${name} » tant que WhatsApp n'est pas connecté — invitez l'utilisateur à scanner le QR code dans « Connexions ».`,
      });
    }
  }

  switch (name) {
    case "check_whatsapp_connection": {
      const result = await testEvolutionConnection(userId);
      return JSON.stringify({
        ...result,
        outboundToday: await countOutboundToday(userId),
        outboundLimit: await getEffectiveOutboundLimit(userId),
      });
    }

    case "list_whatsapp_groups": {
      const groups = await listWhatsAppGroups(userId);
      return JSON.stringify({
        count: groups.length,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          type: "groupe",
        })),
        hint: groups.length
          ? "Utilisez name pour identifier le groupe et id (@g.us) pour envoyer un message."
          : "Aucun groupe trouvé — vérifiez que WhatsApp est connecté.",
      });
    }

    case "list_whatsapp_channels": {
      const channels = await listWhatsAppChannels(userId);
      return JSON.stringify({
        count: channels.length,
        channels: channels.map((c) => ({
          id: c.id,
          name: c.name,
          type: "chaîne WhatsApp",
        })),
        hint: channels.length
          ? "Les chaînes utilisent un ID @newsletter. Les noms peuvent être absents selon la version Evolution API."
          : "Aucune chaîne détectée sur ce compte.",
      });
    }

    case "send_channel_message": {
      const channelId = String(args.channel_id ?? "").trim();
      const message = String(args.message ?? "").trim();
      if (!channelId || !message) {
        return JSON.stringify({ error: "channel_id et message sont requis." });
      }
      try {
        const result = await sendWhatsAppChannelMessage(userId, channelId, message);
        return JSON.stringify({
          success: true,
          channel_id: result.channelId,
          message_id: result.idMessage,
          hint: "Message publié dans la chaîne. Seuls les abonnés verront le contenu.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          success: false,
          error: msg,
          hint:
            "Si l'erreur mentionne un format invalide, vérifie l'ID via list_whatsapp_channels. La création de chaîne n'est pas supportée.",
        });
      }
    }

    case "create_whatsapp_group": {
      const subject = String(args.subject ?? "").trim();
      if (!subject) {
        return JSON.stringify({ error: "Le nom du groupe (subject) est requis." });
      }

      let participants: string[] = [];
      if (Array.isArray(args.participants)) {
        participants = args.participants.map((p) => String(p)).filter(Boolean);
      } else if (args.participants) {
        participants = [String(args.participants)];
      }

      if (participants.length === 0) {
        const contacts = await listContacts(userId, { limit: 10 });
        const pick = contacts.find((c) => c.status !== "stop");
        if (pick) participants = [pick.phone];
      }

      if (participants.length === 0) {
        return JSON.stringify({
          error:
            "WhatsApp exige au moins 1 participant pour créer un groupe. Indiquez un numéro (+229…) ou enregistrez un contact prospect d'abord.",
        });
      }

      try {
        const result = await createWhatsAppGroup(userId, {
          subject,
          participants,
          description: args.description ? String(args.description) : undefined,
          promoteParticipants: args.promote_participants === true,
        });
        return JSON.stringify({
          success: true,
          groupId: result.groupId,
          name: result.subject,
          participantsAdded: result.participantCount,
          message: `Groupe « ${result.subject} » créé (${result.groupId}). ${result.participantCount} participant(s) ajouté(s).`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "get_group_members": {
      const groupId = await resolveGroupId(userId, String(args.group_id ?? ""));
      const data = await getGroupMembers(userId, groupId);
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

    case "get_group_info": {
      try {
        const info = await getGroupInfo(userId, String(args.group_id ?? ""));
        return JSON.stringify({ success: true, group: info });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "update_group": {
      const groupId = String(args.group_id ?? "");
      const done: string[] = [];
      try {
        if (args.subject) {
          await updateGroupSubject(userId, groupId, String(args.subject));
          done.push(`nom → « ${String(args.subject)} »`);
        }
        if (typeof args.description === "string") {
          await updateGroupDescription(userId, groupId, args.description);
          done.push("description mise à jour");
        }
        if (args.picture) {
          await updateGroupPicture(userId, groupId, String(args.picture));
          done.push("photo mise à jour");
        }
        if (args.setting) {
          await updateGroupSetting(
            userId,
            groupId,
            String(args.setting) as "announcement" | "not_announcement" | "locked" | "unlocked"
          );
          done.push(`paramètre → ${String(args.setting)}`);
        }
        if (typeof args.ephemeral_seconds === "number") {
          await toggleGroupEphemeral(userId, groupId, args.ephemeral_seconds);
          done.push(
            args.ephemeral_seconds === 0
              ? "messages éphémères désactivés"
              : `messages éphémères → ${args.ephemeral_seconds}s`
          );
        }
        if (done.length === 0) {
          return JSON.stringify({ error: "Rien à modifier : fournir subject, description, picture, setting ou ephemeral_seconds." });
        }
        return JSON.stringify({ success: true, updated: done, message: `Groupe mis à jour : ${done.join(", ")}.` });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err), partiallyDone: done });
      }
    }

    case "manage_group_participants": {
      const action = String(args.action ?? "") as "add" | "remove" | "promote" | "demote";
      const participants = Array.isArray(args.participants)
        ? (args.participants as unknown[]).map((p) => String(p)).filter(Boolean)
        : [];
      if (!["add", "remove", "promote", "demote"].includes(action)) {
        return JSON.stringify({ error: "action invalide (add/remove/promote/demote)." });
      }
      try {
        await updateGroupParticipants(userId, String(args.group_id ?? ""), action, participants);
        const labels = { add: "ajoutés", remove: "retirés", promote: "promus admin", demote: "rétrogradés" };
        return JSON.stringify({
          success: true,
          action,
          count: participants.length,
          message: `${participants.length} participant(s) ${labels[action]}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "group_invite": {
      const action = String(args.action ?? "");
      try {
        switch (action) {
          case "get_code": {
            const url = await getGroupInviteCode(userId, String(args.group_id ?? ""));
            return JSON.stringify({ success: true, inviteUrl: url, message: `Lien d'invitation : ${url}` });
          }
          case "revoke_code": {
            const url = await revokeGroupInviteCode(userId, String(args.group_id ?? ""));
            return JSON.stringify({ success: true, inviteUrl: url, message: `Lien révoqué. Nouveau lien : ${url}` });
          }
          case "info": {
            const info = await getGroupInviteInfo(userId, String(args.invite_code ?? ""));
            return JSON.stringify({ success: true, group: info });
          }
          case "accept": {
            const result = await acceptGroupInvite(userId, String(args.invite_code ?? ""));
            return JSON.stringify({
              success: result.accepted,
              groupJid: result.groupJid,
              message: result.accepted
                ? `Invitation acceptée. Groupe rejoint : ${result.groupJid}`
                : "Invitation non acceptée.",
            });
          }
          case "send": {
            const numbers = Array.isArray(args.numbers)
              ? (args.numbers as unknown[]).map((n) => String(n)).filter(Boolean)
              : [];
            await sendGroupInvite(
              userId,
              String(args.group_id ?? ""),
              numbers,
              args.description ? String(args.description) : undefined
            );
            return JSON.stringify({
              success: true,
              message: `Invitation envoyée à ${numbers.length} numéro(s).`,
            });
          }
          default:
            return JSON.stringify({ error: "action invalide (get_code/revoke_code/info/accept/send)." });
        }
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "leave_group": {
      try {
        await leaveWhatsAppGroup(userId, String(args.group_id ?? ""));
        return JSON.stringify({ success: true, message: "Groupe quitté." });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "list_personal_contacts": {
      const limit = Math.min(Number(args.limit) || 50, 100);
      const contacts = await listPersonalContacts(userId, limit);
      return JSON.stringify({ count: contacts.length, contacts });
    }

    case "get_chat_history": {
      const recipient = String(args.recipient ?? "");
      const count = Math.min(Number(args.count) || 30, 100);
      const data = await getChatHistory(userId, recipient, count);
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
      const messages = await listIncomingMessages(userId, {
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
      const contact = await saveContact(userId, {
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
      const contacts = await listContacts(userId, {
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
      const contact = await setContactAutoReply(userId, phone, enabled);
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
      const contact = await blockContact(userId, phone);
      let waNote = "";
      try {
        await updateWhatsAppBlockStatus(userId, contact.phone, true);
        waNote = " Bloqué aussi sur WhatsApp.";
      } catch (err) {
        waNote = ` (blocage WhatsApp non appliqué : ${err instanceof Error ? err.message : String(err)})`;
      }
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        message: `⛔ Contact ${chatIdToDisplay(contact.phone)} passé en STOP. Aucun envoi possible vers lui.${waNote}`,
      });
    }

    case "unblock_contact": {
      const phone = String(args.phone ?? "");
      const contact = await unblockContact(userId, phone);
      let waNote = "";
      try {
        await updateWhatsAppBlockStatus(userId, contact.phone, false);
        waNote = " Débloqué aussi sur WhatsApp.";
      } catch (err) {
        waNote = ` (déblocage WhatsApp non appliqué : ${err instanceof Error ? err.message : String(err)})`;
      }
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        message: `Contact ${chatIdToDisplay(contact.phone)} débloqué (statut : ${contact.status}).${waNote}`,
      });
    }

    case "send_presence": {
      const recipient = String(args.recipient ?? "");
      const presence = String(args.presence ?? "composing") as
        | "composing"
        | "recording"
        | "available"
        | "unavailable"
        | "paused";
      const durationMs = Number(args.duration_ms) || 3000;
      try {
        const chatId = await resolveRecipient(userId, recipient);
        await sendWhatsAppPresence(userId, chatId, presence, durationMs);
        const labels: Record<string, string> = {
          composing: "en train d'écrire",
          recording: "en train d'enregistrer",
          available: "en ligne",
          unavailable: "hors ligne",
          paused: "en pause",
        };
        return JSON.stringify({
          success: true,
          chatId,
          presence,
          message: `Présence « ${labels[presence] ?? presence} » envoyée à ${chatIdToDisplay(chatId)}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "check_whatsapp_number": {
      const numbers = Array.isArray(args.numbers)
        ? (args.numbers as unknown[]).map((n) => String(n)).filter(Boolean)
        : [];
      if (numbers.length === 0) return JSON.stringify({ error: "Fournir au moins un numéro." });
      try {
        const results = await checkWhatsAppNumbers(userId, numbers);
        return JSON.stringify({
          success: true,
          results: results.map((r) => ({
            number: r.number,
            exists: r.exists,
            jid: r.jid,
            display: r.jid ? chatIdToDisplay(r.jid) : `+${r.number}`,
          })),
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "get_contact_profile_picture": {
      try {
        const chatId = await resolveRecipient(userId, String(args.recipient ?? ""));
        const { url } = await fetchProfilePictureUrl(userId, chatId);
        return JSON.stringify({
          success: true,
          chatId,
          display: chatIdToDisplay(chatId),
          profilePictureUrl: url,
          message: url
            ? `Photo de profil de ${chatIdToDisplay(chatId)} récupérée.`
            : `Aucune photo de profil accessible pour ${chatIdToDisplay(chatId)} (masquée ou absente).`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "get_contact_profile": {
      try {
        const chatId = await resolveRecipient(userId, String(args.recipient ?? ""));
        const profile = await fetchContactProfile(userId, chatId);
        return JSON.stringify({
          success: true,
          chatId,
          display: chatIdToDisplay(chatId),
          profile,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "get_contact_business_profile": {
      try {
        const chatId = await resolveRecipient(userId, String(args.recipient ?? ""));
        const profile = await fetchContactBusinessProfile(userId, chatId);
        return JSON.stringify({
          success: true,
          chatId,
          display: chatIdToDisplay(chatId),
          isBusiness: profile != null,
          businessProfile: profile,
          message: profile
            ? `Profil business de ${chatIdToDisplay(chatId)} récupéré.`
            : `${chatIdToDisplay(chatId)} n'est pas un compte WhatsApp Business (ou profil non accessible).`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "get_contact_presence": {
      try {
        if (args.recipient) {
          const chatId = await resolveRecipient(userId, String(args.recipient));
          const p = getContactPresence(userId, chatId);
          const presence = Array.isArray(p) ? null : p;
          return JSON.stringify({
            success: true,
            chatId,
            display: chatIdToDisplay(chatId),
            presence: presence?.presence ?? null,
            updatedAt: presence?.updatedAt ?? null,
            message: presence
              ? `Dernière présence de ${chatIdToDisplay(chatId)} : ${presence.presence}.`
              : `Aucune présence connue pour ${chatIdToDisplay(chatId)}. Envoie d'abord send_presence pour t'abonner, puis réessaie.`,
          });
        }
        const all = getContactPresence(userId);
        const list = Array.isArray(all) ? all : all ? [all] : [];
        return JSON.stringify({
          success: true,
          count: list.length,
          presences: list.map((p) => ({
            chatId: p.chatId,
            display: chatIdToDisplay(p.chatId),
            presence: p.presence,
            updatedAt: p.updatedAt,
          })),
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "update_my_profile": {
      const name = args.name ? String(args.name) : undefined;
      const status = typeof args.status === "string" ? String(args.status) : undefined;
      const picture = args.picture ? String(args.picture) : undefined;
      const removePic = args.remove_picture === true;
      if (!name && status === undefined && !picture && !removePic) {
        return JSON.stringify({ error: "Rien à modifier : fournir name, status, picture ou remove_picture." });
      }
      const done: string[] = [];
      try {
        if (name) {
          await updateProfileName(userId, name);
          done.push(`nom → « ${name} »`);
        }
        if (status !== undefined) {
          await updateProfileStatus(userId, status);
          done.push(`statut → « ${status} »`);
        }
        if (removePic) {
          await removeProfilePicture(userId);
          done.push("photo de profil supprimée");
        } else if (picture) {
          await updateProfilePicture(userId, picture);
          done.push("photo de profil mise à jour");
        }
        return JSON.stringify({
          success: true,
          updated: done,
          message: `Profil mis à jour : ${done.join(", ")}.`,
        });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
          partiallyDone: done,
        });
      }
    }

    case "get_privacy_settings": {
      try {
        const settings = await fetchPrivacySettings(userId);
        return JSON.stringify({ success: true, privacy: settings });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "update_privacy_settings": {
      const keys = ["readreceipts", "profile", "status", "online", "last", "groupadd"] as const;
      const settings: Record<string, string> = {};
      for (const k of keys) {
        if (typeof args[k] === "string" && args[k]) settings[k] = String(args[k]);
      }
      if (Object.keys(settings).length === 0) {
        return JSON.stringify({ error: "Aucun paramètre fourni à modifier." });
      }
      try {
        const merged = await updatePrivacySettings(userId, settings);
        return JSON.stringify({
          success: true,
          changed: settings,
          privacy: merged,
          message: `Confidentialité mise à jour : ${Object.entries(settings).map(([k, v]) => `${k}=${v}`).join(", ")}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "send_whatsapp_message": {
      const recipient = String(args.recipient ?? "");
      const message = String(args.message ?? "");
      const replyTo = args.reply_to_message_id ? String(args.reply_to_message_id) : undefined;
      const mentions = Array.isArray(args.mentions)
        ? (args.mentions as unknown[]).map((m) => String(m)).filter(Boolean)
        : undefined;
      const mentionEveryone = args.mention_everyone === true;
      const linkPreview =
        typeof args.link_preview === "boolean" ? (args.link_preview as boolean) : undefined;
      const delayMs = Number(args.delay_ms);
      try {
        const chatId = await resolveRecipient(userId, recipient);

        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({
              error: `Ce contact est en STOP. Aucun message ne sera envoyé. Demandez à l'utilisateur de le débloquer si vraiment nécessaire.`,
            });
          }
        }

        const textOptions: {
          quoted?: { id: string; remoteJid?: string; fromMe?: boolean };
          mentioned?: string[];
          mentionsEveryOne?: boolean;
          linkPreview?: boolean;
          delay?: number;
        } = {};
        if (replyTo) textOptions.quoted = { id: replyTo, remoteJid: chatId, fromMe: false };
        if (mentions && mentions.length > 0) textOptions.mentioned = mentions;
        if (mentionEveryone) textOptions.mentionsEveryOne = true;
        if (typeof linkPreview === "boolean") textOptions.linkPreview = linkPreview;
        if (Number.isFinite(delayMs) && delayMs > 0) textOptions.delay = delayMs;

        const result = await sendWhatsAppMessage(userId, chatId, message, {
          textOptions: Object.keys(textOptions).length > 0 ? textOptions : undefined,
        });
        if (chatId.endsWith("@c.us")) {
          try {
            await setContactAutoReply(userId, chatId, true);
            await saveContact(userId, {
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
          outboundToday: await countOutboundToday(userId),
          outboundLimit: await getEffectiveOutboundLimit(userId),
          message: isGroup
            ? `Message envoyé dans le groupe à ${nowFr()}`
            : `Message envoyé à ${chatIdToDisplay(result.chatId)} à ${nowFr()}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "send_whatsapp_reaction": {
      const recipient = String(args.recipient ?? "");
      const messageId = String(args.message_id ?? "").trim();
      const emoji = String(args.emoji ?? "");
      const fromMe = args.from_me === true;
      if (!messageId) return JSON.stringify({ error: "message_id requis." });
      try {
        const chatId = await resolveRecipient(userId, recipient);
        const result = await sendWhatsAppReaction(userId, chatId, messageId, emoji, { fromMe });
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          idMessage: result.idMessage,
          reaction: emoji,
          sentAt: nowFr(),
          message: emoji
            ? `Réaction ${emoji} envoyée à ${nowFr()}`
            : `Réaction retirée à ${nowFr()}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "send_whatsapp_poll": {
      const recipient = String(args.recipient ?? "");
      const question = String(args.question ?? "").trim();
      const options = Array.isArray(args.options)
        ? (args.options as unknown[]).map((o) => String(o)).filter((s) => s.trim())
        : [];
      const selectableCount = Number(args.selectable_count) || 1;
      const delayMs = Number(args.delay_ms);
      if (!question) return JSON.stringify({ error: "La question du sondage est requise." });
      if (options.length < 2) return JSON.stringify({ error: "Un sondage nécessite au moins 2 options." });
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppPoll(userId, chatId, {
          name: question,
          values: options,
          selectableCount,
          delay: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : undefined,
        });
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          idMessage: result.idMessage,
          sentAt: nowFr(),
          message: `📊 Sondage envoyé (${options.length} options) à ${nowFr()}. Les votes apparaîtront dans les messages entrants.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "send_whatsapp_list": {
      const recipient = String(args.recipient ?? "");
      const title = String(args.title ?? "").trim();
      const description = String(args.description ?? "").trim();
      const buttonText = String(args.button_text ?? "").trim();
      const footerText = args.footer_text ? String(args.footer_text) : undefined;
      const delayMs = Number(args.delay_ms);
      const sections = Array.isArray(args.sections)
        ? (args.sections as Array<Record<string, unknown>>).map((s) => ({
            title: String(s.title ?? ""),
            rows: Array.isArray(s.rows)
              ? (s.rows as Array<Record<string, unknown>>).map((r) => ({
                  title: String(r.title ?? ""),
                  description: r.description ? String(r.description) : undefined,
                  rowId: r.rowId ? String(r.rowId) : undefined,
                }))
              : [],
          }))
        : [];
      if (!title || !buttonText) return JSON.stringify({ error: "title et button_text sont requis." });
      if (sections.length === 0) return JSON.stringify({ error: "Au moins une section est requise." });
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppList(userId, chatId, {
          title,
          description,
          buttonText,
          footerText,
          sections,
          delay: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : undefined,
        });
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          idMessage: result.idMessage,
          sentAt: nowFr(),
          note: "Liste interactive (expérimental) — le rendu dépend de la version WhatsApp du destinataire.",
          message: `📋 Liste « ${title} » envoyée à ${nowFr()}.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "send_whatsapp_sticker": {
      const recipient = String(args.recipient ?? "");
      const sticker = String(args.sticker ?? "").trim();
      const delayMs = Number(args.delay_ms);
      if (!sticker) return JSON.stringify({ error: "La source du sticker (URL ou base64) est requise." });
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppSticker(userId, chatId, sticker, {
          delay: Number.isFinite(delayMs) && delayMs > 0 ? delayMs : undefined,
        });
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          idMessage: result.idMessage,
          sentAt: nowFr(),
          message: `Sticker envoyé à ${nowFr()}.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
      }
    }

    case "send_whatsapp_media": {
      const recipient = String(args.recipient ?? "");
      const media = String(args.media ?? "").trim();
      const type = String(args.type ?? "") as "image" | "video" | "document";
      if (!media) return JSON.stringify({ error: "La source du média (URL ou base64) est requise." });
      if (!["image", "video", "document"].includes(type)) {
        return JSON.stringify({ error: "type invalide (image, video ou document)." });
      }
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppMedia(userId, chatId, {
          url: media,
          type,
          caption: args.caption ? String(args.caption) : undefined,
          fileName: args.file_name ? String(args.file_name) : undefined,
          mimetype: args.mimetype ? String(args.mimetype) : undefined,
        });
        const isGroup = chatId.endsWith("@g.us");
        const kind = type === "image" ? "Image" : type === "video" ? "Vidéo" : "Document";
        const dest = isGroup ? "dans le groupe" : `à ${chatIdToDisplay(result.chatId)}`;
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          isGroup,
          idMessage: result.idMessage,
          confirmed: result.confirmed,
          sentAt: nowFr(),
          message: result.confirmed
            ? `${kind} envoyé(e) ${dest} à ${nowFr()}.`
            : `${kind} envoyé(e) ${dest} à ${nowFr()}. (Evolution n'a pas renvoyé de confirmation dans les temps pour ce média volumineux — c'est normal, le fichier est bien parti. Ne PAS annoncer d'échec ni réessayer l'envoi.)`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "send_whatsapp_voice": {
      const recipient = String(args.recipient ?? "");
      const audio = String(args.audio ?? "").trim();
      if (!audio) return JSON.stringify({ error: "La source audio (URL ou base64) est requise." });
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppVoice(userId, chatId, audio);
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          isGroup,
          idMessage: result.idMessage,
          sentAt: nowFr(),
          message: `Note vocale envoyée ${isGroup ? "dans le groupe" : `à ${chatIdToDisplay(result.chatId)}`} à ${nowFr()}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "send_location": {
      const recipient = String(args.recipient ?? "");
      const latitude = Number(args.latitude);
      const longitude = Number(args.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return JSON.stringify({ error: "latitude et longitude valides requises." });
      }
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppLocation(userId, chatId, {
          latitude,
          longitude,
          name: args.name ? String(args.name) : undefined,
          address: args.address ? String(args.address) : undefined,
        });
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          isGroup,
          idMessage: result.idMessage,
          sentAt: nowFr(),
          message: `Localisation envoyée ${isGroup ? "dans le groupe" : `à ${chatIdToDisplay(result.chatId)}`} à ${nowFr()}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "send_contact": {
      const recipient = String(args.recipient ?? "");
      const fullName = String(args.full_name ?? "").trim();
      const phone = String(args.phone ?? "").trim();
      if (!fullName || !phone) {
        return JSON.stringify({ error: "full_name et phone sont requis." });
      }
      try {
        const chatId = await resolveRecipient(userId, recipient);
        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({ error: "Ce contact est en STOP. Aucun envoi possible." });
          }
        }
        const result = await sendWhatsAppContact(userId, chatId, {
          fullName,
          phone,
          organization: args.organization ? String(args.organization) : undefined,
          email: args.email ? String(args.email) : undefined,
          url: args.url ? String(args.url) : undefined,
        });
        const isGroup = chatId.endsWith("@g.us");
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          display: isGroup ? chatId : chatIdToDisplay(result.chatId),
          isGroup,
          idMessage: result.idMessage,
          sentAt: nowFr(),
          message: `Contact « ${fullName} » envoyé ${isGroup ? "dans le groupe" : `à ${chatIdToDisplay(result.chatId)}`} à ${nowFr()}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "send_whatsapp_status": {
      const message = String(args.message ?? "").trim();
      const backgroundColor = args.background_color ? String(args.background_color) : undefined;
      const statusType = String(args.type ?? "text").toLowerCase();
      const media = args.media ? String(args.media).trim() : "";
      const font = args.font ? String(args.font) : undefined;
      const participants = Array.isArray(args.participants)
        ? (args.participants as unknown[]).map((p) => String(p)).filter(Boolean)
        : undefined;
      try {
        let result: { idMessage: string; audienceCount: number; confirmed: boolean };
        if (statusType === "image" || statusType === "video" || statusType === "audio") {
          if (!media) {
            return JSON.stringify({ error: `Le champ media (URL ou base64) est requis pour un statut ${statusType}.` });
          }
          result = await sendWhatsAppMediaStatus(userId, {
            type: statusType,
            content: media,
            caption: message || undefined,
            backgroundColor,
            participants,
          });
        } else {
          result = await sendWhatsAppTextStatus(userId, message, {
            backgroundColor,
            font,
            participants,
          });
        }
        const label = statusType === "text" ? `« ${message.slice(0, 80)}${message.length > 80 ? "…" : ""} »` : `statut ${statusType}`;
        return JSON.stringify({
          success: true,
          idMessage: result.idMessage,
          audienceCount: result.audienceCount,
          confirmed: result.confirmed,
          publishedAt: nowFr(),
          message: result.confirmed
            ? `✅ Statut WhatsApp publié pour ${result.audienceCount} contact(s) : ${label}`
            : `✅ Statut WhatsApp publié pour ${result.audienceCount} contact(s) : ${label}. (Evolution n'a pas renvoyé de confirmation dans les temps — c'est un comportement connu de cette version, le statut est bien en ligne. Ne PAS annoncer d'échec.)`,
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
      const chats = await listWhatsAppChats(userId, count);
      const typeLabel: Record<string, string> = {
        user: "contact",
        group: "groupe",
        channel: "chaîne",
        broadcast: "statuts",
      };
      return JSON.stringify({
        count: chats.length,
        chats: chats.map((c) => ({
          id: c.id,
          name: c.name,
          display: c.type === "user" && isLikelyPhoneJid(c.id) ? chatIdToDisplay(normalizeGroupParticipantId(c.id)) : c.name,
          type: typeLabel[c.type] ?? c.type,
          archive: c.archive,
        })),
      });
    }

    case "mark_chat_read": {
      const chatId = await resolveRecipient(userId, String(args.chat_id ?? ""));
      const idMessage = args.id_message ? String(args.id_message) : undefined;
      const result = await markChatRead(userId, chatId, idMessage);
      return JSON.stringify({
        success: true,
        chatId,
        setRead: result.setRead,
        message: `Chat ${chatIdToDisplay(chatId)} marqué comme lu.`,
      });
    }

    case "mark_chat_unread": {
      const messageId = String(args.message_id ?? "").trim();
      if (!messageId) return JSON.stringify({ error: "message_id requis." });
      try {
        const chatId = await resolveRecipient(userId, String(args.chat_id ?? ""));
        await markChatUnread(userId, chatId, messageId, { fromMe: args.from_me === true });
        return JSON.stringify({
          success: true,
          chatId,
          message: `Chat ${chatIdToDisplay(chatId)} marqué comme non lu.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "archive_chat": {
      const messageId = String(args.message_id ?? "").trim();
      if (!messageId) return JSON.stringify({ error: "message_id requis." });
      const archive = args.archive !== false;
      try {
        const chatId = await resolveRecipient(userId, String(args.chat_id ?? ""));
        await archiveChat(userId, chatId, messageId, archive, { fromMe: args.from_me === true });
        return JSON.stringify({
          success: true,
          chatId,
          archived: archive,
          message: `Chat ${chatIdToDisplay(chatId)} ${archive ? "archivé" : "désarchivé"}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "edit_message": {
      const messageId = String(args.message_id ?? "").trim();
      const newText = String(args.new_text ?? "").trim();
      if (!messageId) return JSON.stringify({ error: "message_id requis." });
      if (!newText) return JSON.stringify({ error: "new_text requis." });
      try {
        const chatId = await resolveRecipient(userId, String(args.recipient ?? ""));
        const result = await editWhatsAppMessage(userId, chatId, messageId, newText);
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          idMessage: result.idMessage,
          editedAt: nowFr(),
          message: `Message modifié à ${nowFr()}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "delete_message": {
      const messageId = String(args.message_id ?? "").trim();
      if (!messageId) return JSON.stringify({ error: "message_id requis." });
      try {
        const chatId = await resolveRecipient(userId, String(args.recipient ?? ""));
        const result = await deleteWhatsAppMessage(userId, chatId, messageId, {
          fromMe: args.from_me !== false,
          participant: args.participant ? String(args.participant) : undefined,
        });
        return JSON.stringify({
          success: true,
          chatId: result.chatId,
          deletedAt: nowFr(),
          message: `Message supprimé pour tout le monde à ${nowFr()}.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "get_message_media": {
      const messageId = String(args.message_id ?? "").trim();
      if (!messageId) return JSON.stringify({ error: "message_id requis." });
      try {
        const media = await getMessageMediaBase64(userId, messageId, {
          convertToMp4: args.convert_to_mp4 === true,
        });
        const dataUrl = `data:${media.mimetype};base64,${media.base64}`;
        return JSON.stringify({
          success: true,
          mediaType: media.mediaType,
          mimetype: media.mimetype,
          fileName: media.fileName,
          dataUrl,
          message: `Média récupéré (${media.mediaType}, ${media.mimetype}). Utilisable comme URL data: pour ré-envoi.`,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "search_messages": {
      try {
        const recipientArg = args.recipient ? String(args.recipient) : undefined;
        const recipient =
          recipientArg && recipientArg !== "status@broadcast"
            ? await resolveRecipient(userId, recipientArg)
            : recipientArg;
        const results = await searchWhatsAppMessages(userId, {
          recipient,
          query: args.query ? String(args.query) : undefined,
          count: Number(args.count) || undefined,
        });
        return JSON.stringify({
          success: true,
          count: results.length,
          messages: results.map((m) => ({
            idMessage: m.idMessage,
            chatId: m.chatId,
            display: chatIdToDisplay(m.chatId),
            fromMe: m.fromMe,
            text: m.text,
            typeMessage: m.typeMessage,
            timestamp: m.timestamp,
          })),
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "list_green_incoming_messages": {
      const raw = await getLastIncomingMessages(userId);
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
      const groupId = await resolveGroupId(userId, String(args.group_id ?? ""));
      const message = String(args.message ?? "");
      const maxMembers = Math.min(Math.max(Number(args.max_members) || 30, 1), 50);
      const result = await messageGroupMembers(userId, groupId, message, { maxMembers, delayMs: 4000 });
      return JSON.stringify({
        groupName: result.groupName,
        sentCount: result.sent.length,
        errorCount: result.errors.length,
        skipped: result.skipped,
        sent: result.sent.map((s) => ({ ...s, display: chatIdToDisplay(s.chatId) })),
        errors: result.errors,
        outboundToday: await countOutboundToday(userId),
        outboundLimit: await getEffectiveOutboundLimit(userId),
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

      const chatId = await resolveRecipient(userId, recipientRaw);
      if (chatId.endsWith("@c.us")) {
        const existing = await getContact(userId, chatId);
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

      const job = await scheduleMessage(userId, {
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
      const jobs = await listScheduledMessages(userId, {
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
        const job = await cancelScheduledMessage(userId, id);
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
      const bilan = await getDailyBilan(userId, args.date ? String(args.date) : undefined);
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
      const thread = await getContactThread(userId, phone, limit);
      const contact = await getContact(
        userId,
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
      await saveBusinessProfile(userId, {
        ownerName: args.owner_name !== undefined ? String(args.owner_name) : undefined,
        offer: args.offer !== undefined ? String(args.offer) : undefined,
        price: args.price !== undefined ? String(args.price) : undefined,
      });
      const s = await getAppSettings(userId);
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
      const s = await getAppSettings(userId);
      return JSON.stringify({
        ownerName: s.business_owner_name || null,
        offer: s.business_offer || null,
        price: s.business_price || null,
        configured: Boolean(s.business_owner_name || s.business_offer),
      });
    }

    case "create_automation": {
      const type = String(args.type ?? "") as AutomationType;
      if (!["group_prospect", "contact_prospect", "keyword_sales", "custom_followup"].includes(type)) {
        return JSON.stringify({ error: "type invalide." });
      }

      const config = buildAutomationConfigFromArgs(args, type);

      // Interdit de stocker des crochets dans les textes de campagne (ils finiraient chez les prospects).
      const badFields = findPlaceholderFields([
        { label: "initial_message", value: config.initialMessage },
        { label: "conversation_guide", value: config.conversationGuide },
        { label: "product_name", value: config.productName },
        { label: "price", value: config.price },
        { label: "closing_link", value: config.closingLink },
        { label: "sales_script", value: config.salesScript },
        ...(config.relance?.messages ?? []).map((m, i) => ({ label: `relance_messages[${i}]`, value: m })),
        ...(config.abVariants ?? []).map((v) => ({ label: `ab_variants.${v.id}`, value: v.message })),
        ...(config.sequenceSteps ?? []).map((s, i) => ({ label: `sequence_steps[${i}]`, value: s.message })),
      ]);
      if (badFields.length) {
        return JSON.stringify({
          error:
            `Texte avec crochets interdit (${badFields.join(", ")}). ` +
            `Demande d'abord à l'utilisateur les vraies valeurs (prix en FCFA, lien réel…) et réessaie SANS aucun […].`,
        });
      }

      const needsSaleInfo = type === "keyword_sales" || Boolean(config.closingGoal);
      if (needsSaleInfo && !config.price?.trim()) {
        return JSON.stringify({
          error:
            "Prix manquant. Avant de créer la campagne, demande le prix exact (ex. 15000 FCFA) et passe-le dans price — jamais [prix].",
        });
      }
      if (
        (config.closingGoal === "appointment" ||
          config.closingGoal === "payment" ||
          config.closingGoal === "link") &&
        !config.closingLink?.trim()
      ) {
        return JSON.stringify({
          error:
            "Lien manquant (closing_link). Pour un objectif RDV / paiement / lien, exige l'URL réelle auprès de l'utilisateur avant de créer la campagne.",
        });
      }
      {
        if (
          needsAppointmentLink({
            closingGoal: config.closingGoal,
            conversationGuide: config.conversationGuide,
            initialMessage: config.initialMessage,
            closingLink: config.closingLink,
            productName: config.productName,
          })
        ) {
          return JSON.stringify({
            error:
              "Objectif rendez-vous détecté sans closing_link. Demande d'abord le lien de réservation (Calendly, Google Agenda, autre URL) puis réessaie avec closing_goal=appointment et closing_link=URL.",
          });
        }
      }
      if (config.initialMessage && hasTemplatePlaceholders(config.initialMessage)) {
        return JSON.stringify({
          error: "initial_message contient des crochets. Remplace-les par de vraies valeurs.",
        });
      }

      if (type === "contact_prospect") {
        if (!args.initial_message) {
          return JSON.stringify({ error: "contact_prospect requiert initial_message." });
        }
        const rawContacts = Array.isArray(args.contacts)
          ? args.contacts.map(String).map((s) => s.trim()).filter(Boolean)
          : [];
        if (!rawContacts.length) {
          return JSON.stringify({
            error: "contact_prospect requiert au moins un contact (numéro, chatId ou nom).",
          });
        }
        try {
          await requireEvolutionConnected(userId, "la création d'une campagne de prospection de contacts");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
        const resolved: Array<{ id: string; label?: string }> = [];
        const failed: string[] = [];
        for (const raw of rawContacts) {
          try {
            const id = await resolveRecipient(userId, raw);
            if (id.endsWith("@g.us")) {
              failed.push(`${raw} (c'est un groupe — utilise group_prospect)`);
              continue;
            }
            if (!resolved.some((r) => r.id === id)) {
              resolved.push({ id, label: /^[\d+\s\-().]+$/.test(raw) ? undefined : raw });
            }
          } catch {
            failed.push(raw);
          }
        }
        if (!resolved.length) {
          return JSON.stringify({
            error: `Aucun contact résolu. Non trouvés : ${failed.join(", ")}. Donne des numéros (+229…) ou des noms exacts présents dans les contacts.`,
          });
        }
        config.contactTargets = resolved;
        if (failed.length) {
          config.followUpInstructions = undefined;
        }
        const auto = await createAutomation(userId, {
          name: String(args.name ?? "Prospection contacts"),
          type,
          config,
          summary: args.summary ? String(args.summary) : undefined,
          budgetFcfa: args.budget_fcfa ? Number(args.budget_fcfa) : 0,
          status: "draft",
        });
        return JSON.stringify({
          success: true,
          automationId: auto.id,
          name: auto.name,
          type: auto.type,
          status: auto.status,
          config: auto.config,
          resolvedContacts: resolved.length,
          unresolved: failed,
          message: `Campagne « ${auto.name} » créée en brouillon (#${auto.id}) avec ${resolved.length} contact(s).${failed.length ? ` Non résolus : ${failed.join(", ")}.` : ""} Prochaine étape : simulation puis activate_automation après confirmation.`,
          simulationHint:
            "Propose une simulation : joue le prospect et déroule le début de conversation en chat uniquement.",
          completedAt: nowFr(),
        });
      }

      if (type === "group_prospect") {
        if (!args.group_id || !args.initial_message) {
          return JSON.stringify({
            error: "group_prospect requiert group_id et initial_message.",
          });
        }
        try {
          await requireEvolutionConnected(userId, "la création d'une campagne de prospection groupe");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
        const groupId = await resolveGroupId(userId, String(args.group_id));
        // listWhatsAppGroups est mis en cache — évite un 2e aller-retour Evolution.
        const groups = await listWhatsAppGroups(userId);
        const matched = groups.find((g) => g.id === groupId);
        config.groupId = groupId;
        config.groupName = matched?.name ?? String(args.group_id);
      }

      if (type === "keyword_sales") {
        const phrases = config.triggerPhrases ?? [];
        if (!phrases.length) {
          return JSON.stringify({
            error: "keyword_sales requiert trigger_phrases (mot/phrase exact).",
          });
        }
      }

      const auto = await createAutomation(userId, {
        name: String(args.name ?? "Campagne"),
        type,
        config,
        summary: args.summary ? String(args.summary) : undefined,
        budgetFcfa: args.budget_fcfa ? Number(args.budget_fcfa) : 0,
        status: "draft",
      });

      return JSON.stringify({
        success: true,
        automationId: auto.id,
        name: auto.name,
        type: auto.type,
        status: auto.status,
        config: auto.config,
        summary: auto.summary,
        message: `Campagne « ${auto.name} » créée en brouillon (#${auto.id}). Prochaine étape : simulation puis activate_automation après confirmation.`,
        simulationHint:
          "Propose une simulation : joue le prospect et déroule le début de conversation en chat uniquement.",
        completedAt: nowFr(),
      });
    }

    case "activate_automation": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      const detail = await getAutomationDetail(userId, id);
      if (!detail) {
        return JSON.stringify({ error: `Campagne #${id} introuvable.` });
      }
      if (detail.automation.status === "active") {
        return JSON.stringify({ error: "Campagne déjà active.", automationId: id });
      }
      if (!["draft", "paused"].includes(detail.automation.status)) {
        return JSON.stringify({
          error: `Impossible d'activer depuis le statut « ${detail.automation.status} ».`,
        });
      }

      const auto = detail.automation;
      if (
        (auto.type === "keyword_sales" || auto.config.mode === "inbound_closing") &&
        !auto.config.price?.trim()
      ) {
        return JSON.stringify({
          error:
            "Impossible d'activer : prix manquant dans la campagne. Demande le prix exact à l'utilisateur, mets-le à jour via update_automation_config (price), puis réessaie.",
        });
      }
      if (
        (auto.config.closingGoal === "appointment" ||
          auto.config.closingGoal === "payment" ||
          auto.config.closingGoal === "link") &&
        !auto.config.closingLink?.trim()
      ) {
        return JSON.stringify({
          error:
            "Impossible d'activer : lien (closing_link) manquant. Demande l'URL réelle, mets à jour la config, puis réessaie.",
        });
      }
      if (
        needsAppointmentLink({
          closingGoal: auto.config.closingGoal,
          conversationGuide: auto.config.conversationGuide,
          initialMessage: auto.config.initialMessage,
          closingLink: auto.config.closingLink,
          productName: auto.config.productName,
        })
      ) {
        return JSON.stringify({
          error:
            "Impossible d'activer : objectif RDV sans lien de réservation. Demande l'URL, update_automation_config(closing_goal=appointment, closing_link=…), puis réessaie.",
        });
      }
      if (auto.config.initialMessage && hasTemplatePlaceholders(auto.config.initialMessage)) {
        return JSON.stringify({
          error:
            "Impossible d'activer : le premier message contient encore des crochets […]. Corrige-le avec de vraies valeurs.",
        });
      }
      let targetsAdded = 0;
      if (auto.type === "group_prospect") {
        if (!auto.config.groupId || !auto.config.initialMessage) {
          return JSON.stringify({ error: "groupId ou initialMessage manquant dans la config." });
        }
        try {
          await updateAutomationStatus(userId, id, "active");
          targetsAdded = await bootstrapGroupProspectTargets(userId, id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: `Activation échouée : ${msg}`, automationId: id });
        }
      } else if (auto.type === "contact_prospect") {
        if (!auto.config.initialMessage || !auto.config.contactTargets?.length) {
          return JSON.stringify({ error: "initialMessage ou contacts manquants dans la config." });
        }
        try {
          await requireEvolutionConnected(userId, "l'activation de la campagne");
          await updateAutomationStatus(userId, id, "active");
          targetsAdded = await bootstrapContactProspectTargets(userId, id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: `Activation échouée : ${msg}`, automationId: id });
        }
      } else {
        await updateAutomationStatus(userId, id, "active");
      }

      const fresh = await getAutomationDetail(userId, id);
      return JSON.stringify({
        success: true,
        automationId: id,
        status: "active",
        targetsAdded,
        stats: fresh?.automation.stats,
        message: `Campagne #${id} « ${auto.name} » activée.${targetsAdded ? ` ${targetsAdded} membre(s) chargé(s).` : ""}`,
        completedAt: nowFr(),
      });
    }

    case "update_automation_config": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      const detail = await getAutomationDetail(userId, id);
      if (!detail) {
        return JSON.stringify({ error: `Campagne #${id} introuvable.` });
      }

      const current = detail.automation.config;
      const merged: AutomationConfig = { ...current };

      if (args.initial_message) merged.initialMessage = String(args.initial_message);
      if (args.conversation_guide) merged.conversationGuide = String(args.conversation_guide);
      if (Array.isArray(args.trigger_phrases)) {
        merged.triggerPhrases = args.trigger_phrases.map(String);
        merged.keywords = merged.triggerPhrases;
      }
      if (args.product_name) merged.productName = String(args.product_name);
      if (args.price) merged.price = String(args.price);
      if (args.closing_link) merged.closingLink = String(args.closing_link).trim();
      if (args.sales_script) merged.salesScript = String(args.sales_script);
      if (args.closing_goal) {
        merged.closingGoal = String(args.closing_goal) as AutomationConfig["closingGoal"];
      }
      if (args.max_members != null) merged.maxMembers = Number(args.max_members);
      if (args.quiet_hours_start != null && Number.isFinite(Number(args.quiet_hours_start))) {
        merged.quietHoursStart = Math.round(Number(args.quiet_hours_start));
      }
      if (args.quiet_hours_end != null && Number.isFinite(Number(args.quiet_hours_end))) {
        merged.quietHoursEnd = Math.round(Number(args.quiet_hours_end));
      }
      if (args.scheduled_start_at != null) {
        const raw = String(args.scheduled_start_at).trim();
        merged.scheduledStartAt = raw || undefined;
      }

      if (args.relance_enabled != null || args.relance_delays_days != null) {
        const enabled = args.relance_enabled === true;
        const delays = Array.isArray(args.relance_delays_days)
          ? args.relance_delays_days.map((d) => Number(d))
          : current.relance?.delaysDays ?? [];
        merged.relance = enabled
          ? {
              enabled: true,
              delaysDays: delays,
              hour: args.relance_hour != null ? Number(args.relance_hour) : current.relance?.hour,
              messages: Array.isArray(args.relance_messages)
                ? args.relance_messages.map(String)
                : current.relance?.messages,
            }
          : { enabled: false, delaysDays: [] };
      }

      const badFields = findPlaceholderFields([
        { label: "initial_message", value: merged.initialMessage },
        { label: "conversation_guide", value: merged.conversationGuide },
        { label: "product_name", value: merged.productName },
        { label: "price", value: merged.price },
        { label: "closing_link", value: merged.closingLink },
        { label: "sales_script", value: merged.salesScript },
        ...(merged.relance?.messages ?? []).map((m, i) => ({ label: `relance_messages[${i}]`, value: m })),
      ]);
      if (badFields.length) {
        return JSON.stringify({
          error: `Texte avec crochets interdit (${badFields.join(", ")}). Demande les vraies valeurs et réessaie sans […].`,
        });
      }

      const updated = await updateAutomationConfig(userId, id, merged);
      return JSON.stringify({
        success: true,
        automationId: id,
        config: updated?.config,
        message: `Campagne #${id} mise à jour.`,
      });
    }

    case "delete_automation": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      const ok = await deleteAutomation(userId, id);
      if (!ok) {
        return JSON.stringify({ error: `Campagne #${id} introuvable.` });
      }
      return JSON.stringify({
        success: true,
        automationId: id,
        message: `Campagne #${id} supprimée.`,
      });
    }

    case "list_prospected_contacts": {
      const automationId = args.automation_id != null ? Number(args.automation_id) : undefined;
      const limit = args.limit != null ? Number(args.limit) : 200;
      const contacts = await listProspectedContacts(userId, {
        automationId: Number.isFinite(automationId) ? automationId : undefined,
        limit,
      });
      return JSON.stringify({
        count: contacts.length,
        contacts: contacts.map((c) => ({
          campaignId: c.automationId,
          campaignName: c.automationName,
          phone: c.targetId,
          display: chatIdToDisplay(c.targetId),
          name: c.targetLabel,
          status: c.status,
          lastActionAt: c.lastActionAt,
        })),
      });
    }

    case "list_automations": {
      const status = args.status ? (String(args.status) as AutomationStatus) : undefined;
      const list = await listAutomations(userId, status ? { status, limit: 50 } : { limit: 50 });
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
      const detail = await getAutomationDetail(userId, id);
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
      const updated =
        status === "paused"
          ? await pauseAutomation(userId, id)
          : status === "active"
            ? await resumeAutomation(userId, id)
            : await updateAutomationStatus(userId, id, status);
      if (!updated) {
        return JSON.stringify({ error: `Automatisation #${id} introuvable.` });
      }
      return JSON.stringify({
        success: true,
        automationId: id,
        status: updated.status,
        message:
          status === "paused"
            ? `Automatisation #${id} en pause — plus aucun message automatique (file, relances, réponses).`
            : `Automatisation #${id} → ${status}.`,
      });
    }

    case "show_campaign_simulation": {
      const rawTurns = Array.isArray(args.turns) ? args.turns : [];
      if (rawTurns.length < 3 || rawTurns.length > 4) {
        return JSON.stringify({
          error: "La simulation doit contenir exactement 3 ou 4 messages (turns).",
        });
      }
      const lines: string[] = [];
      for (const raw of rawTurns) {
        if (!raw || typeof raw !== "object") {
          return JSON.stringify({ error: "Chaque turn doit avoir speaker + text." });
        }
        const turn = raw as { speaker?: string; name?: string; text?: string };
        const speaker = String(turn.speaker ?? "").toLowerCase();
        const text = String(turn.text ?? "").trim();
        if (!text) return JSON.stringify({ error: "Un message de la simulation est vide." });
        if (hasTemplatePlaceholders(text)) {
          return JSON.stringify({
            error: "Crochets [ ] interdits dans la simulation. Utilise les vraies valeurs (prix, lien…).",
          });
        }
        if (speaker === "toi") {
          lines.push(`Toi → « ${text} »`);
        } else if (speaker === "prospect") {
          const name = String(turn.name ?? "Prospect").trim() || "Prospect";
          lines.push(`${name} → « ${text} »`);
        } else {
          return JSON.stringify({ error: "speaker doit être « toi » ou « prospect »." });
        }
      }
      const display =
        lines.join("\n") +
        "\n\n---\n" +
        "*(Simulation courte — 3 à 4 messages max.)*\n\n" +
        "Dis-moi concrètement :\n" +
        "• ce qui te convient\n" +
        "• ce que tu veux changer (ton, accroche, CTA, prix, lien…)\n\n" +
        "Ou réponds « c'est bon » si on peut passer à l'activation.";
      return JSON.stringify({
        success: true,
        display,
        turns: rawTurns.length,
        message: "Simulation prête. Affiche le champ display tel quel à l'utilisateur.",
      });
    }

    case "create_group_rule": {
      const groupId = await resolveGroupId(userId, String(args.group_id ?? ""));
      const keywords = Array.isArray(args.keywords)
        ? args.keywords.map((k) => String(k).trim()).filter(Boolean)
        : [];
      const replyGuide = String(args.reply_guide ?? "").trim();
      if (!keywords.length || !replyGuide) {
        return JSON.stringify({ error: "keywords et reply_guide requis." });
      }
      const group = await findGroupByNameOrId(userId, groupId);
      const rule = await createGroupReplyRule(userId, {
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
