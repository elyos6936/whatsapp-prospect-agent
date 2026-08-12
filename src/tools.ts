import type OpenAI from "openai";
import {
  getEvolutionCredentials,
  getChatHistory,
  getGroupMembers,
  getLastIncomingMessages,
  createWhatsAppGroup,
  findGroupByNameOrId,
  suggestGroupsByName,
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
  listAdminWhatsAppGroups,
  assertUserIsGroupAdmin,
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
  canonicalizePhoneDigits,
  isPhoneLikeLabel,
  resolveWhatsAppDisplayName,
  phoneDigitsVariants,
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
  getAutomation,
  getAutomationDetail,
  getAppSettings,
  getContact,
  getContactThread,
  getDailyBilan,
  getOutreachQuotaSnapshot,
  tryConsumeTrialGroupExtract,
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
  updateAutomationConfig,
  updateAutomationMeta,
  findReusableAutomation,
  linkAutomationToThread,
  automationBelongsToThread,
  threadHasCampaign,
  getAgentThread,
  haltAutomationMessaging,
  resumeAutomationMessaging,
  deleteAutomation,
  listProspectedContacts,
  listActiveAutomations,
  type AutomationType,
  type ContactStatus,
  type AutomationConfig,
  unblockContact,
} from "./db.js";
import { getContactPresence } from "./notifications.js";
import {
  formatAttentionOpenerWarning,
  isValidAttentionOpener,
  outboundVariantsOutOfFrame,
  validateOutboundAbVariants,
} from "./opener-frame.js";
import { findPlaceholderFields, hasTemplatePlaceholders } from "./outbound-sanitize.js";
import { formatCampaignSimulationDisplay, type SimulationTurn } from "./campaign-simulation.js";
import {
  buildAutomationVisualPlan,
  formatPlanDisplay,
  type AutomationVisualPlan,
} from "./automation-plan.js";
import { ANTI_BAN, defaultRelanceConfig } from "./anti-ban.js";
import {
  CALENDLY_REAUTH_MESSAGE,
  GOOGLE_SHEETS_REAUTH_MESSAGE,
  TALLY_REAUTH_MESSAGE,
  TYPEFORM_REAUTH_MESSAGE,
  getValidCalendlyAccessToken,
  getValidGoogleSheetsToken,
  getValidTallyApiKey,
  getValidTypeformAccessToken,
} from "./integrations/access.js";
import {
  CalendlyAuthError,
  fetchCalendlyBookings,
  fetchCalendlyContacts,
  fetchCalendlyEventTypes,
  fetchCalendlyUser,
} from "./integrations/calendly.js";
import {
  GOOGLE_SHEETS_PROVIDER,
  GoogleAuthError,
  fetchSpreadsheetValues,
} from "./integrations/google.js";
import {
  TallyAuthError,
  fetchTallyForms,
  fetchTallyResponses,
  resolveTallyFormId,
} from "./integrations/tally.js";
import {
  TypeformAuthError,
  fetchTypeformForms,
  fetchTypeformResponses,
} from "./integrations/typeform.js";
import {
  getUserIntegration,
  listConnectedSheets,
} from "./integrations-db.js";
import {
  estimateProspectCountFromArgs,
  recommendOutboundGaps,
} from "./campaign-spacing.js";
import { detectStickerConsent } from "./sticker-consent.js";
import { parseThirdPartyNotificationArgs } from "./third-party-notification.js";
import {
  formatVerticalContactList,
  formatVerticalGroupList,
  formatVerticalMemberList,
  userFacingError,
} from "./user-facing.js";
import {
  findCampaignMemoryByName,
  getCampaignMemory,
  getLinkedCampaignMemory,
  listCampaignMemories,
  memoryToQuietHours,
  memoryToneLabel,
  parseMemoryHints,
  extractUsefulLinkFromText,
  setThreadCampaignMemory,
} from "./campaign-memory.js";
import {
  activityWindowToQuietHours,
  quietHoursToActivityWindow,
  resolveInboundQuietHours,
  resolveOutboundQuietHours,
} from "./quiet-hours.js";

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
        "Liste les groupes WhatsApp (noms + IDs @g.us). " +
        "Pour diffusion groupes (fil Groupes) : passe admin_only=true — uniquement les groupes où le compte est admin. " +
        "Sinon : UNIQUEMENT si l'utilisateur demande explicitement la liste (« liste mes groupes »).",
      parameters: {
        type: "object",
        properties: {
          admin_only: {
            type: "boolean",
            description:
              "Si true : uniquement les groupes où le compte WhatsApp connecté est administrateur.",
          },
        },
        additionalProperties: false,
      },
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
      description:
        "Liste UNIQUEMENT les membres d'un groupe WhatsApp (ID @g.us ou nom). " +
        "Ne sert PAS à envoyer ni programmer un message dans le groupe — pour ça : send_whatsapp_message / schedule_whatsapp_message. " +
        "Si l'utilisateur demande N membres seulement (ex. « deux membres »), passe limit=N.",
      parameters: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "ID du groupe (xxx@g.us) OU nom du groupe (ex. Automax)",
          },
          limit: {
            type: "number",
            description:
              "Nombre max de membres à renvoyer (ex. 2 si l'utilisateur demande « deux membres »). Omit = tous.",
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
      description:
        "Gère les participants d'un groupe : ajouter, retirer, promouvoir admin, rétrograder. " +
        "group_id = nom du groupe (jamais demander l'ID @g.us à l'utilisateur).",
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
        "Enregistre ou met à jour un contact de prospection (base Klanvio) : numéro, nom, notes, statut. " +
        "Si Google Contacts est connecté, crée aussi la fiche dans Google Contacts avec le nom WhatsApp. " +
        "Lis googleContactsSynced dans la réponse : si false, dis clairement que Google n'a PAS reçu le contact — ne dis jamais « synchronisé ». " +
        "Si not_connected, invite à connecter Réglages → Intégrations → Google Contacts. " +
        "CRITIQUE : phone = chatId/numéro EXACT du prospect (ex. 22996158855@c.us ou +22996158855). " +
        "Interdit d'inventer un numéro. Pour « enregistre ce prospect », utilise le target_id / contact_phone " +
        "de la campagne ou des messages — jamais un numéro approximatif. Si le nom WhatsApp est connu " +
        "(pushName / messages), passe-le dans name ; sinon l'outil le récupère automatiquement.",
      parameters: {
        type: "object",
        properties: {
          phone: {
            type: "string",
            description:
              "Numéro E.164 (+229…) ou chatId WhatsApp exact (229…@c.us). Jamais un numéro inventé.",
          },
          name: {
            type: "string",
            description:
              "Nom d'affichage (pushName WhatsApp de préférence). Si omis, récupéré depuis WhatsApp / messages.",
          },
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
          duration_ms: { type: "number", description: "Durée d'affichage en ms (défaut 3000, max 6000 anti-ban)" },
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
        "Envoie UN message texte WhatsApp. Destinataire : numéro personnel (+229…), chatId (@c.us), ID de groupe (@g.us), OU nom de groupe (ex. Automax). " +
        "Pour poster DANS un groupe maintenant, utiliser cet outil directement avec le nom du groupe — PAS get_group_members, PAS message_all_group_members. " +
        "Supporte aussi : répondre en citant un message (reply_to_message_id), mentionner des membres (mentions + @numéro dans le texte), mentionner tout le monde (mention_everyone, groupes), et l'aperçu de lien (link_preview).",
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
        "Programme l'envoi automatique d'un message WhatsApp à une personne OU DANS un groupe (recipient = nom du groupe ou @g.us). " +
        "Utiliser delay_minutes (ex. 2) OU send_at_local (ex. 06:30, heure locale). " +
        "Pour poster dans un groupe à heure fixe : cet outil — pas get_group_members.",
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
        "Bilan / rapport du jour (ou d'une date) : messages entrants/sortants, contacts, top conversations, programmés. Pour « bilan », « rapport », « combien de messages aujourd'hui ». NE remplace PAS get_outreach_status pour niveau / plafonds max.",
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
      name: "get_outreach_status",
      description:
        "Niveau outreach, essai, plafonds journaliers de NOUVEAUX fils (entrant/sortant) et restants aujourd'hui. OBLIGATOIRE pour « combien de messages max », « mon niveau », « mon quota », « combien puis-je envoyer ». Ne jamais inventer ces chiffres.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_conversation",
      description:
        "Relit la conversation d'un prospect pour CETTE automatisation uniquement (mémoire isolée). Ne mélange pas les échanges d'autres automatisations.",
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
      name: "list_campaign_memories",
      description:
        "Liste les mémoires de campagne (style / présentation / stickers / fenêtre). Utilise aussi pour proposer un changement de mémoire.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_campaign_memory",
      description:
        "Renvoie la mémoire explicitement liée à CE fil (pas le défaut compte). Si absente, l'utilisateur doit cliquer Mémoire dans le chat.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_campaign_memory",
      description:
        "Lie une mémoire de campagne à CE fil (par nom ou id). Ex. « utilise la mémoire Support chaleureux ». Préférer le bouton Mémoire côté UI.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nom de la mémoire (recherche souple)" },
          memory_id: { type: "number", description: "ID interne si connu" },
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
        "Envoie un STICKER WhatsApp (image WebP/PNG/JPEG, URL ou base64). À n'appeler QUE si l'utilisateur a explicitement autorisé les stickers dans la conversation (oui aux stickers). Sinon, demande d'abord son accord — ne jamais envoyer de sticker de façon autonome.",
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
      name: "list_typeform_forms",
      description:
        "Liste les formulaires Typeform du compte connecté (Réglages → Intégrations). " +
        "Ensuite utilise list_typeform_responses avec un form_id pour lire les soumissions. " +
        "Si non connecté, invite à reconnecter Typeform.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Nombre max de formulaires à retourner (défaut 50)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_typeform_responses",
      description:
        "Lit les réponses complétées d'un formulaire Typeform (form_id depuis list_typeform_forms) " +
        "et propose des leads téléphone (suggested_leads). " +
        "Si accès refusé : l'utilisateur doit Déconnecter puis reconnecter Typeform pour autoriser responses:read. " +
        "Pour prospecter : confirmer les numéros puis create_automation(contact_prospect) en brouillon.",
      parameters: {
        type: "object",
        properties: {
          form_id: {
            type: "string",
            description: "ID du formulaire Typeform",
          },
          page_size: {
            type: "number",
            description: "Nombre max de réponses (défaut 25, max 100)",
          },
        },
        required: ["form_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendly_event_types",
      description:
        "Liste les types d'événements Calendly du compte connecté (Réglages → Intégrations). " +
        "Ensuite utilise list_calendly_bookings pour lire les rendez-vous / invitees. " +
        "Si non connecté, invite à reconnecter Calendly.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Nombre max de types d'événements (défaut 50)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendly_bookings",
      description:
        "Lit les rendez-vous Calendly (scheduled events + invitees) et propose des leads téléphone " +
        "(suggested_leads) depuis le numéro SMS ou les questions custom. " +
        "Optionnel : filtrer par event_type_uri (depuis list_calendly_event_types).",
      parameters: {
        type: "object",
        properties: {
          event_type_uri: {
            type: "string",
            description: "URI du type d'événement Calendly (optionnel)",
          },
          limit: {
            type: "number",
            description: "Nombre max d'événements (défaut 25, max 50)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendly_contacts",
      description:
        "Liste le carnet Contacts Calendly (CRM Calendly, scope contacts:read). " +
        "Propose suggested_leads si un téléphone est présent. " +
        "Si accès refusé : Déconnecter puis reconnecter Calendly avec contacts:read.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Nombre max de contacts (défaut 50, max 100)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tally_forms",
      description:
        "Liste les formulaires Tally du compte connecté (clé API dans Réglages → Intégrations). " +
        "Chaque item a id + publicUrl (https://tally.so/r/{id}). " +
        "Ensuite list_tally_responses avec le champ id exact (pas le titre du formulaire).",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Nombre max de formulaires (défaut 50)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tally_responses",
      description:
        "Lit les soumissions d'un formulaire Tally et propose des leads téléphone (suggested_leads). " +
        "form_id = id exact depuis list_tally_forms, ou URL https://tally.so/r/XXXXXX. " +
        "Ne passe jamais le titre du formulaire comme form_id.",
      parameters: {
        type: "object",
        properties: {
          form_id: {
            type: "string",
            description:
              "ID Tally (ex. 3qEPdk) ou URL https://tally.so/r/… — depuis list_tally_forms.id / publicUrl",
          },
          page_size: {
            type: "number",
            description: "Nombre max de soumissions (défaut 25, max 100)",
          },
        },
        required: ["form_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_connected_sheets",
      description:
        "Liste les Google Sheets que l'utilisateur a connectés à Klanvio via le Picker " +
        "(Réglages → Intégrations). Pas tous les Sheets Drive — seulement ceux ajoutés. " +
        "Utilise ensuite read_google_sheet avec un spreadsheet_id.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_google_sheet",
      description:
        "Lit les lignes d'un Google Sheet connecté (headers + rows) et propose des leads " +
        "téléphone détectés (suggested_leads). spreadsheet_id DOIT provenir de list_connected_sheets. " +
        "Lecture seule. Pour prospecter : confirmer les numéros avec l'utilisateur puis " +
        "create_automation(contact_prospect) en brouillon — ne pas activer sans brief.",
      parameters: {
        type: "object",
        properties: {
          spreadsheet_id: {
            type: "string",
            description: "ID du Sheet (depuis list_connected_sheets)",
          },
          range: {
            type: "string",
            description: 'Plage A1 (ex. "A1:Z50" ou "Feuille1!A1:Z50"). Défaut A1:Z50',
          },
          max_rows: {
            type: "number",
            description: "Max lignes de données après l'en-tête (défaut 50, max 100)",
          },
        },
        required: ["spreadsheet_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_automation",
      description:
        "Crée OU met à jour une campagne WhatsApp en BROUILLON uniquement (jamais d'activation ici). " +
        "Si une autre campagne est déjà active : crée quand même le brouillon — NE PAS activer. " +
        "L'utilisateur lancera plus tard via activate_automation ou le bouton Activer (l'ancienne passera alors en pause). " +
        "Si l'utilisateur veut MODIFIER une campagne existante : passe automation_id — NE CRÉE PAS une nouvelle. " +
        "Sans automation_id, réutilise un brouillon du même type/groupe s'il existe.",
      parameters: {
        type: "object",
        properties: {
          automation_id: {
            type: "number",
            description:
              "ID de la campagne à MODIFIER. À fournir dès que l'utilisateur demande une modification / ajustement d'une campagne existante — ne crée pas de doublon.",
          },
          name: { type: "string", description: "Nom court de la campagne" },
          type: {
            type: "string",
            enum: [
              "group_prospect",
              "contact_prospect",
              "keyword_sales",
              "custom_followup",
              "group_broadcast",
            ],
            description:
              "group_prospect = DM membres d'un groupe ; contact_prospect = DM contacts ; keyword_sales = support entrant ; group_broadcast = publier dans des groupes (admin only), avec sequence_steps pour posts multi-jours",
          },
          summary: { type: "string", description: "Résumé en une phrase" },
          group_id: { type: "string", description: "ID ou nom du groupe (@g.us ou nom) — group_prospect" },
          group_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "group_broadcast : un ou plusieurs groupes (@g.us ou noms) où le compte est administrateur.",
          },
          contacts: {
            type: "array",
            items: { type: "string" },
            description:
              "contact_prospect : liste des contacts à prospecter (numéros +229…, chatId, ou noms exacts présents dans les contacts). 1 ou plusieurs.",
          },
          initial_message: {
            type: "string",
            description:
              "Premier message sortant = A.I.D.A. Attention (1-2 phrases, ≤200 car., ton d'adressage de la mémoire, SANS prénom du prospect). RECOMMANDÉ (pas imposé) : sans prix, sans lien, sans pitch complet — si l'utilisateur veut autre chose, avertis-le des risques puis respecte son choix (keep_opener_as_is). = accroche validée / référence simu ; les 5 ab_variants tournent à l'envoi. Pour group_broadcast : 1er post dans le(s) groupe(s).",
          },
          max_members: { type: "number", description: "Limite de membres pour group_prospect (défaut 30)" },
          max_per_day: {
            type: "number",
            description: "Nombre max de premiers messages envoyés par jour pour cette campagne (anti-blocage)",
          },
          min_delay_seconds: {
            type: "number",
            description:
              "Délai min entre envois (s). Si omis : auto selon volume (peu de prospects = plus court, beaucoup = plus long).",
          },
          max_delay_seconds: {
            type: "number",
            description:
              "Délai max entre envois (s). Si omis : auto selon volume de prospects (anti-blocage).",
          },
          stickers_enabled: {
            type: "boolean",
            description:
              "true UNIQUEMENT si l'utilisateur a explicitement accepté stickers/emojis. Défaut false = texte seul.",
          },
          third_party_notification_enabled: {
            type: "boolean",
            description:
              "true si l'utilisateur veut notifier un tiers (livreur, etc.) à chaque conversion. Défaut false.",
          },
          third_party_phone: {
            type: "string",
            description:
              "Numéro WhatsApp du tiers (+229…) — obligatoire si third_party_notification_enabled=true.",
          },
          third_party_role: {
            type: "string",
            description: "Rôle du tiers (ex. livreur, commercial terrain, assistant).",
          },
          third_party_context: {
            type: "string",
            description:
              "Consignes / infos à transmettre au tiers (adresse, produit, créneau, ton…). Message généré dynamiquement par l'IA.",
          },
          handoff_keywords: {
            type: "array",
            items: { type: "string" },
            description:
              "Mots/phrases qui stoppent l'IA et passent la main à l'humain (messages entrants). [] si l'utilisateur a dit non / aucun.",
          },
          quiet_hours_start: {
            type: "number",
            description:
              "Heure (0-23) de début des heures calmes (PAS d'envoi). Ex. activité 9h-18h → quiet_hours_start=18. Préfère send_window_* si l'utilisateur donne une fenêtre d'activité.",
          },
          quiet_hours_end: {
            type: "number",
            description:
              "Heure (0-23) de fin des heures calmes. Ex. activité 9h-18h → quiet_hours_end=9",
          },
          send_window_start: {
            type: "number",
            description:
              "Début fenêtre d'ACTIVITÉ (0-23) — ce que dit l'utilisateur (« de 6h à … »). Convertie automatiquement en quiet hours.",
          },
          send_window_end: {
            type: "number",
            description:
              "Fin fenêtre d'ACTIVITÉ (0-23) — (« … jusqu'à 15h »). Avec send_window_start : ex. 6→15 → quiet 15→6.",
          },
          inbound_wave_gap_minutes: {
            type: "number",
            description:
              "Closing entrant uniquement : minutes entre le début de deux vagues de 50 réponses (minimum 60, recommandé 120).",
          },
          inbound_batch_size: {
            type: "number",
            description: "Closing entrant : taille d'une vague (défaut 50, max 100).",
          },
          scheduled_start_at: {
            type: "string",
            description:
              "Date/heure de lancement différé (ISO 8601 ou 'YYYY-MM-DD HH:mm'). Omettre = dès activation.",
          },
          enable_auto_reply: {
            type: "boolean",
            description:
              "Ignoré : l'auto-reply est TOUJOURS forcé à true pour une campagne (activer/désactiver la campagne suffit).",
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
              "Mots/phrases EXACTS déclencheurs pour keyword_sales (ex. « je suis intéressé par ce produit »). Obligatoire SAUF si inbound_catch_all=true (peut être []).",
          },
          inbound_catch_all: {
            type: "boolean",
            description:
              "keyword_sales uniquement : true = gérer TOUS les messages privés WhatsApp (compte entier), sans phrase déclencheur. Groupes exclus. false/omit = mode phrases exactes.",
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
            description: "Délais en jours pour les relances (ex. [2, 5])",
          },
          relance_hour: { type: "number", description: "Heure d'envoi des relances (0-23)" },
          relance_messages: {
            type: "array",
            items: { type: "string" },
            description: "Messages de relance (sans crochets)",
          },
          budget_fcfa: { type: "number" },
          personalize_messages: {
            type: "boolean",
            description:
              "Micro-variation de wording par prospect. Ignoré (forcé false) dès que 5 ab_variants sont validés : on envoie alors le texte exact, seule la variante choisie change.",
          },
          stop_on_dissatisfaction: { type: "boolean" },
          stop_on_unknown_question: { type: "boolean" },
          ab_variants: {
            type: "array",
            items: { type: "object" },
            description:
              "Exactement 5 accroches Attention DISTINCTES validées avec l'utilisateur : [{id:'v1',message:'…'}, … {id:'v5',message:'…'}]. Obligatoire en prospection sortante. Même si l'utilisateur n'en choisit qu'une pour initial_message, tu DOIS passer les 5 textes — ne garde jamais un seul message.",
          },
          keep_opener_as_is: {
            type: "boolean",
            description:
              "true UNIQUEMENT après que l'utilisateur, averti des risques (lien / prix / pitch dans le 1er message), a confirmé vouloir garder son texte tel quel. Ne jamais mettre true de ta propre initiative.",
          },
          sequence_steps: {
            type: "array",
            items: { type: "object" },
            description:
              "Posts planifiés après le 1er message. group_broadcast : [{delayDays:1,message:'…'},{delayDays:3,message:'…'}]. Prospection DM : préférer relance / ne pas auto-enchaîner à l'opener.",
          },
          media_url: {
            type: "string",
            description:
              "URL publique photo/image produit (pièce jointe chat). Envoyée auto si le client demande une photo.",
          },
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
        "Lance une campagne en brouillon/pause/échouée UNIQUEMENT quand l'utilisateur est prêt (après simulation / confirmation explicite). " +
        "Si une autre campagne est active, elle passe automatiquement en pause. " +
        "Ne pas appeler juste après create_automation si une campagne tourne déjà — laisser le brouillon et attendre le feu vert.",
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
      description:
        "Modifie la config d'une campagne EXISTANTE (brouillon, active ou en pause). " +
        "À utiliser dès que l'utilisateur demande un changement (message, prix, lien, ton…) — " +
        "NE PAS appeler create_automation pour ça (évite les doublons).",
      parameters: {
        type: "object",
        properties: {
          automation_id: { type: "number" },
          initial_message: { type: "string" },
          conversation_guide: { type: "string" },
          trigger_phrases: { type: "array", items: { type: "string" } },
          inbound_catch_all: {
            type: "boolean",
            description:
              "true = gérer tous les messages privés (compte entier) ; false = revenir aux phrases déclencheurs",
          },
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
          min_delay_seconds: { type: "number" },
          max_delay_seconds: { type: "number" },
          stickers_enabled: {
            type: "boolean",
            description: "true seulement si l'utilisateur autorise stickers/emojis",
          },
          third_party_notification_enabled: {
            type: "boolean",
            description: "Activer/désactiver la notif WhatsApp à un tiers à la conversion",
          },
          third_party_phone: {
            type: "string",
            description: "Numéro du tiers (+229…)",
          },
          third_party_role: { type: "string", description: "Rôle du tiers (livreur, etc.)" },
          third_party_context: {
            type: "string",
            description: "Consignes / infos à transmettre au tiers",
          },
          handoff_keywords: {
            type: "array",
            items: { type: "string" },
            description:
              "Mots/phrases qui stoppent l'IA et passent la main à l'humain. [] pour désactiver.",
          },
          quiet_hours_start: {
            type: "number",
            description:
              "Début heures calmes (PAS d'envoi). Préfère send_window_* si l'utilisateur dit « fenêtre 6h–15h ».",
          },
          quiet_hours_end: { type: "number" },
          send_window_start: {
            type: "number",
            description:
              "Début fenêtre d'ACTIVITÉ (0-23). Ex. « 6h–15h » → send_window_start=6, send_window_end=15.",
          },
          send_window_end: {
            type: "number",
            description: "Fin fenêtre d'ACTIVITÉ (0-23).",
          },
          inbound_wave_gap_minutes: {
            type: "number",
            description: "Closing entrant : minutes entre vagues (min 60)",
          },
          inbound_batch_size: { type: "number" },
          scheduled_start_at: { type: "string" },
          media_url: {
            type: "string",
            description:
              "URL publique de la photo/image produit (ex. pièce jointe chat). Envoyée automatiquement si le client demande une photo.",
          },
          media_type: {
            type: "string",
            enum: ["image", "document", "audio"],
            description: "Type du média campagne (défaut image)",
          },
          ab_variants: {
            type: "array",
            items: { type: "object" },
            description: "Remplacer les 5 accroches Attention : [{id,message}, …] (exactement 5)",
          },
          keep_opener_as_is: {
            type: "boolean",
            description:
              "true UNIQUEMENT après que l'utilisateur, averti des risques (lien / prix / pitch dans le 1er message), a confirmé vouloir garder son texte tel quel. Ne jamais mettre true de ta propre initiative.",
          },
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
      description:
        "Liste les personnes déjà contactées par CETTE automatisation (fil courant). Ne montre pas les contacts d'autres automatisations.",
      parameters: {
        type: "object",
        properties: {
          automation_id: {
            type: "number",
            description: "Doit être l'automatisation liée à ce fil (défaut = fil courant)",
          },
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
        "À appeler quand l'utilisateur accepte/demande une simulation (1ʳᵉ fois), après une modif de config à re-visualiser, ou « refais la simulation ». " +
        "Affiche le fil UNIQUEMENT sur le téléphone à droite (6 ou 7 tours) — INTERDIT de coller Toi/Prospect dans le chat. Aucun envoi WhatsApp. " +
        "Le 1er message « toi » = accroche A.I.D.A. Attention (sans prix/lien). " +
        "Après l'outil, confirme en 1–2 phrases. Ne jamais annoncer « Voici comment… : » sans cet outil.",
      parameters: {
        type: "object",
        properties: {
          turns: {
            type: "array",
            description:
              "Exactement 6 ou 7 répliques alternées Toi / Prospect. Tour 1 toi = Attention seulement.",
            minItems: 6,
            maxItems: 7,
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
      name: "show_automation_plan",
      description:
        "Affiche le plan graphique de l'automatisation du fil courant (carte visuelle dans le chat). " +
        "À appeler après création / mise à jour d'une campagne, ou quand l'utilisateur demande le plan / le schéma / la vue d'ensemble. " +
        "Ne regarde PAS d'autres fils. Sans automation_id → utilise la campagne liée à ce fil.",
      parameters: {
        type: "object",
        properties: {
          automation_id: {
            type: "number",
            description: "ID de la campagne du fil (optionnel si déjà liée)",
          },
          intro: {
            type: "string",
            description: "Court texte d'intro avant la carte (1-2 phrases)",
          },
        },
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
  "get_outreach_status",
  "get_contact_conversation",
  "save_business_profile",
  "get_business_profile",
  "list_typeform_forms",
  "list_typeform_responses",
  "list_calendly_event_types",
  "list_calendly_bookings",
  "list_calendly_contacts",
  "list_tally_forms",
  "list_tally_responses",
  "list_connected_sheets",
  "read_google_sheet",
  "create_automation",
  "list_automations",
  "get_automation_report",
  "set_automation_status",
  "activate_automation",
  "update_automation_config",
  "delete_automation",
  "list_prospected_contacts",
  "show_campaign_simulation",
  "show_automation_plan",
  "create_group_rule",
]);

async function requireThreadAutomationId(
  userId: number,
  threadId: number,
  requestedId?: number
): Promise<{ ok: true; automationId: number } | { ok: false; error: string }> {
  const thread = await getAgentThread(userId, threadId);
  if (!thread) {
    return { ok: false, error: "Fil introuvable." };
  }
  const linked = thread.automation_id;
  if (requestedId != null && Number.isFinite(requestedId)) {
    if (!(await automationBelongsToThread(userId, threadId, requestedId))) {
      return {
        ok: false,
        error: `La campagne #${requestedId} n'appartient pas à ce fil. Impossible d'y accéder depuis cette automatisation.`,
      };
    }
    return { ok: true, automationId: requestedId };
  }
  if (!linked) {
    return {
      ok: false,
      error: "Aucune campagne liée à ce fil. Crée d'abord une automatisation ici (create_automation).",
    };
  }
  return { ok: true, automationId: linked };
}

/** Publier / programmer DANS un @g.us : uniquement sur fil purpose=groupes. */
async function assertGroupMessagingAllowed(
  userId: number,
  threadId: number,
  chatId: string
): Promise<string | null> {
  if (!chatId.endsWith("@g.us")) return null;
  const thread = await getAgentThread(userId, threadId);
  if (thread?.purpose === "groupes") return null;
  return (
    "Pour envoyer ou programmer un message DANS un groupe WhatsApp, " +
    "ouvre Nouvelle automatisation → Groupes WhatsApp. " +
    "Ici tu peux seulement lister les groupes ou en extraire les membres."
  );
}

async function persistVisualPlan(
  userId: number,
  automationId: number
): Promise<AutomationVisualPlan | null> {
  const auto = await getAutomation(userId, automationId);
  if (!auto) return null;
  const plan = buildAutomationVisualPlan(auto);
  await updateAutomationConfig(userId, automationId, {
    ...auto.config,
    visualPlan: plan,
  });
  return plan;
}

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

  // Nom de groupe (ex. Automax) — matching souple (tirets/espaces/casse)
  const group = await findGroupByNameOrId(userId, trimmed);
  if (group) return group.id;

  const suggestions = await suggestGroupsByName(userId, trimmed, 3).catch(() => []);
  const hint = suggestions.length
    ? ` Proches : ${suggestions.map((g) => `« ${g.name} »`).join(", ")}. Réessaie avec le nom exact (sans lister tous les groupes).`
    : " Indiquez un numéro (+229…), un chatId, ou un nom de groupe plus précis — n'affichez pas toute la liste des groupes.";
  throw new Error(`Destinataire introuvable : « ${trimmed} ».${hint}`);
}

async function resolveGroupId(userId: number, groupIdOrName: string): Promise<string> {
  const trimmed = groupIdOrName.trim();
  if (trimmed.endsWith("@g.us")) return trimmed;
  const group = await findGroupByNameOrId(userId, trimmed);
  if (!group) {
    const suggestions = await suggestGroupsByName(userId, trimmed, 3).catch(() => []);
    const hint = suggestions.length
      ? ` Proches : ${suggestions.map((g) => `« ${g.name} »`).join(", ")}. Utilise un de ces noms exacts — n'appelle pas list_whatsapp_groups.`
      : " Précise le nom — n'appelle pas list_whatsapp_groups sauf demande explicite de liste.";
    throw new Error(`Groupe introuvable : « ${trimmed} ».${hint}`);
  }
  return group.id;
}

function nowFr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function parseAbVariantsArg(
  raw: unknown
): Array<{ id: string; message: string }> | undefined {
  let value: unknown = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((v, i) => {
    if (typeof v === "string") return { id: `v${i + 1}`, message: v };
    const row = v as { id?: string; message?: string };
    return {
      id: row.id || `v${i + 1}`,
      message: String(row.message ?? ""),
    };
  });
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
  const relanceExplicitOff = args.relance_enabled === false;
  const relanceDelays = Array.isArray(args.relance_delays_days)
    ? args.relance_delays_days.map((d) => Number(d)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const isOutbound = type === "group_prospect" || type === "contact_prospect";
  const isGroupBroadcast = type === "group_broadcast";
  const clampSeconds = (v: unknown): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.max(30, Math.round(n));
  };

  const prospectCount = estimateProspectCountFromArgs(args);
  const scaled = recommendOutboundGaps(prospectCount);

  const config: AutomationConfig = {
    mode: isOutbound
      ? "outbound_prospect"
      : type === "keyword_sales"
        ? "inbound_closing"
        : isGroupBroadcast
          ? "group_broadcast"
          : undefined,
    initialMessage: args.initial_message ? String(args.initial_message) : undefined,
    maxMembers: args.max_members ? Number(args.max_members) : 30,
    maxPerDay:
      args.max_per_day != null && Number.isFinite(Number(args.max_per_day)) && Number(args.max_per_day) > 0
        ? Math.round(Number(args.max_per_day))
        : isOutbound || isGroupBroadcast
          ? ANTI_BAN.defaultCampaignMaxPerDay
          : undefined,
    minDelaySeconds:
      clampSeconds(args.min_delay_seconds) ??
      (isOutbound || isGroupBroadcast ? scaled.minDelaySeconds : undefined),
    maxDelaySeconds:
      clampSeconds(args.max_delay_seconds) ??
      (isOutbound || isGroupBroadcast ? scaled.maxDelaySeconds : undefined),
    enableAutoReply: !isGroupBroadcast, // diffusion groupe : pas d'auto-reply sur le @g.us
    conversationGuide: args.conversation_guide ? String(args.conversation_guide) : undefined,
    triggerPhrases,
    keywords: triggerPhrases,
    inboundCatchAll: type === "keyword_sales" && args.inbound_catch_all === true,
    productName: args.product_name ? String(args.product_name) : undefined,
    price: args.price ? String(args.price) : undefined,
    closingLink: args.closing_link ? String(args.closing_link).trim() : undefined,
    salesScript: args.sales_script ? String(args.sales_script) : undefined,
    closingGoal: args.closing_goal
      ? (String(args.closing_goal) as AutomationConfig["closingGoal"])
      : undefined,
    stopOnDissatisfaction: args.stop_on_dissatisfaction !== false,
    // Défaut OFF : une question sans info en config (prix…) ne doit pas couper un prospect engagé.
    stopOnUnknownQuestion: args.stop_on_unknown_question === true,
    personalizeMessages:
      // Avec 5 accroches validées : envoi exact (rotation seulement) — pas de paraphrase IA.
      (parseAbVariantsArg(args.ab_variants)?.length ?? 0) >= 2
        ? false
        : args.personalize_messages === false
          ? false
          : isOutbound
            ? true
            : args.personalize_messages === true,
    // Stickers/emojis OFF par défaut — uniquement si l'utilisateur a dit oui
    stickersEnabled: args.stickers_enabled === true,
    thirdPartyNotification: parseThirdPartyNotificationArgs(args),
    handoffKeywords: Array.isArray(args.handoff_keywords)
      ? args.handoff_keywords.map(String).map((s) => s.trim()).filter(Boolean)
      : undefined,
    abVariants: parseAbVariantsArg(args.ab_variants),
    sequenceSteps: Array.isArray(args.sequence_steps)
      ? (args.sequence_steps as Array<{ delayDays?: number; message?: string; condition?: string }>)
          .map((s) => ({
            delayDays: Math.max(1, Number(s.delayDays ?? 1) || 1),
            message: String(s.message ?? ""),
            condition: (s.condition as "no_reply" | "always") || "no_reply",
          }))
          .filter((s) => s.message.trim().length > 0)
      : undefined,
    mediaUrl: args.media_url ? String(args.media_url) : undefined,
    mediaType: args.media_type ? (String(args.media_type) as "image" | "document" | "audio") : undefined,
  };

  const activityQuiet = activityWindowToQuietHours(
    args.send_window_start != null ? Number(args.send_window_start) : undefined,
    args.send_window_end != null ? Number(args.send_window_end) : undefined
  );
  const qStart = args.quiet_hours_start != null ? Number(args.quiet_hours_start) : NaN;
  const qEnd = args.quiet_hours_end != null ? Number(args.quiet_hours_end) : NaN;
  if (activityQuiet) {
    config.quietHoursStart = activityQuiet.start;
    config.quietHoursEnd = activityQuiet.end;
  } else if (Number.isFinite(qStart) && Number.isFinite(qEnd)) {
    const quiet = isOutbound
      ? resolveOutboundQuietHours(qStart, qEnd)
      : resolveInboundQuietHours(qStart, qEnd);
    config.quietHoursStart = quiet.start;
    config.quietHoursEnd = quiet.end;
  } else if (isOutbound) {
    const quiet = resolveOutboundQuietHours(undefined, undefined);
    config.quietHoursStart = quiet.start;
    config.quietHoursEnd = quiet.end;
  } else if (type === "keyword_sales") {
    const quiet = resolveInboundQuietHours(
      Number.isFinite(qStart) ? qStart : undefined,
      Number.isFinite(qEnd) ? qEnd : undefined
    );
    config.quietHoursStart = quiet.start;
    config.quietHoursEnd = quiet.end;
  }

  const waveGap = args.inbound_wave_gap_minutes != null ? Number(args.inbound_wave_gap_minutes) : NaN;
  if (Number.isFinite(waveGap)) {
    config.inboundWaveGapMinutes = Math.max(60, Math.round(waveGap));
  } else if (type === "keyword_sales") {
    config.inboundWaveGapMinutes = 120;
  }
  const batchSize = args.inbound_batch_size != null ? Number(args.inbound_batch_size) : NaN;
  if (Number.isFinite(batchSize)) {
    config.inboundBatchSize = Math.min(100, Math.max(1, Math.round(batchSize)));
  } else if (type === "keyword_sales") {
    config.inboundBatchSize = 50;
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
          : ANTI_BAN.defaultRelanceHour,
      messages: Array.isArray(args.relance_messages)
        ? args.relance_messages.map(String).filter(Boolean)
        : [...ANTI_BAN.defaultRelanceMessages],
    };
  } else if (isOutbound && !relanceExplicitOff && !config.sequenceSteps?.length) {
    // Relances ON par défaut (anti-oubli) — sauf désactivation explicite
    config.relance = defaultRelanceConfig();
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

export async function executeTool(
  userId: number,
  threadId: number,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
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
      const adminOnly = args.admin_only === true;
      const groups = adminOnly
        ? await listAdminWhatsAppGroups(userId)
        : await listWhatsAppGroups(userId);
      const mapped = groups.map((g) => ({
          id: g.id,
          name: g.name,
          type: "groupe",
          ...(adminOnly ? { isAdmin: true as const } : {}),
      }));
      const cap = 40;
      const sliced = mapped.slice(0, cap);
      return JSON.stringify({
        count: mapped.length,
        adminOnly,
        groups: sliced,
        truncated: mapped.length > cap,
        display: formatVerticalGroupList(sliced.map((g) => ({ name: g.name, id: g.id }))),
        hint:
          mapped.length === 0
            ? adminOnly
              ? "Aucun groupe où vous êtes administrateur. Vous ne pouvez diffuser que dans les groupes que vous administrez."
              : "Aucun groupe trouvé — vérifiez que WhatsApp est connecté."
            : adminOnly
              ? "Groupes où le compte est admin uniquement. Présente le champ display. Pour créer une diffusion : create_automation(type=group_broadcast, group_ids=[…], initial_message=…)."
              : "N'affiche PAS ces groupes à l'utilisateur sauf s'il a demandé explicitement la liste. " +
                "Si demandé : présente le champ display tel quel (liste verticale). " +
                "Pour lister les membres d'un groupe nommé : get_group_members. " +
                "Pour ENVOYER ou PROGRAMMER un message dans le groupe : send_whatsapp_message / schedule_whatsapp_message (recipient = nom du groupe) — PAS get_group_members.",
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
      try {
      const groupId = await resolveGroupId(userId, String(args.group_id ?? ""));
      const trialGate = await tryConsumeTrialGroupExtract(userId, groupId);
      if (!trialGate.ok) {
        return JSON.stringify({
          error: trialGate.reason,
          code: "trial_group_extract_limit",
          limit: trialGate.limit,
        });
      }
      const data = await getGroupMembers(userId, groupId);
        const allMembers = data.participants.map((p) => ({
          id: p.id,
          display: chatIdToDisplay(p.id),
          name: p.name ?? null,
          isAdmin: p.isAdmin ?? false,
        }));
        const limRaw = args.limit != null ? Number(args.limit) : NaN;
        const limit =
          Number.isFinite(limRaw) && limRaw > 0
            ? Math.min(500, Math.max(1, Math.round(limRaw)))
            : undefined;
        const members = limit != null ? allMembers.slice(0, limit) : allMembers;
        const groupName = data.subject || String(args.group_id ?? "groupe");
        return JSON.stringify({
          groupId: data.groupId,
          name: groupName,
          size: data.size,
          shown: members.length,
          members,
          display: formatVerticalMemberList(groupName, members, { total: allMembers.length }),
          hint: "Présente le champ display tel quel à l'utilisateur (liste verticale numérotée). Respecte la limite demandée.",
        });
      } catch (err) {
        return JSON.stringify({ error: userFacingError(err) });
      }
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
      if (!participants.length) {
        return JSON.stringify({ error: "Indique au moins un numéro de participant." });
      }
      try {
        const groupRef = String(args.group_id ?? "").trim();
        if (!groupRef) {
          return JSON.stringify({
            error: "Indique le nom du groupe (pas besoin d'ID technique).",
          });
        }
        const groupId = await resolveGroupId(userId, groupRef);
        await updateGroupParticipants(userId, groupId, action, participants);
        const labels = { add: "ajoutés", remove: "retirés", promote: "promus admin", demote: "rétrogradés" };
        const resolved = await findGroupByNameOrId(userId, groupId).catch(() => null);
        return JSON.stringify({
          success: true,
          action,
          count: participants.length,
          groupName: resolved?.name || groupRef,
          message: `${participants.length} participant(s) ${labels[action]} dans « ${resolved?.name || groupRef} ».`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const soft = /introuvable|not found|admin|forbidden|403|401/i.test(msg)
          ? " Ne demande JAMAIS l'ID @g.us à l'utilisateur — propose un nom exact proche, ou vérifie qu'il est admin."
          : "";
        return JSON.stringify({ error: `${msg}${soft}` });
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
      const mapped = contacts.map((c) => ({
        name: c.name ?? null,
        phone: c.id,
        display: chatIdToDisplay(c.id),
      }));
      return JSON.stringify({
        count: mapped.length,
        contacts: mapped,
        display: formatVerticalContactList(mapped, "contacts WhatsApp"),
      });
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
      const statusRaw = args.status ? String(args.status) : undefined;
      if (statusRaw && !CONTACT_STATUSES.includes(statusRaw as ContactStatus)) {
        return JSON.stringify({
          error: `Statut invalide. Attendu : ${CONTACT_STATUSES.join(", ")}`,
        });
      }

      let chatId: string;
      try {
        chatId = await resolveRecipient(userId, String(args.phone ?? ""));
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Numéro invalide.",
        });
      }
      if (chatId.endsWith("@g.us") || chatId.endsWith("@lid")) {
        return JSON.stringify({
          error:
            "save_contact exige un numéro WhatsApp téléphone (@c.us), pas un groupe ni un @lid non résolu.",
        });
      }

      // Canoniser (ex. Bénin 22901…) puis vérifier que le numéro existe réellement sur WA
      const digits = canonicalizePhoneDigits(chatIdToNumber(chatId));
      chatId = `${digits}@c.us`;
      try {
        const variants = phoneDigitsVariants(chatId);
        const checks = await checkWhatsAppNumbers(userId, variants);
        const hit = checks.find((c) => c.exists && c.jid);
        if (!hit) {
          return JSON.stringify({
            error:
              `Ce numéro n'est pas sur WhatsApp (${chatIdToDisplay(chatId)}). ` +
              `Utilise le chatId exact du prospect (messages / campagne), sans inventer de numéro.`,
          });
        }
        const jidDigits = canonicalizePhoneDigits(chatIdToNumber(String(hit.jid)));
        if (jidDigits.length >= 8 && jidDigits.length <= 13) {
          chatId = `${jidDigits}@c.us`;
        }
      } catch (err) {
        // WhatsApp indisponible : n'autoriser que si le numéro est déjà connu en base / messages
        const known = await getContact(userId, chatId).catch(() => null);
        if (!known) {
          return JSON.stringify({
            error:
              `Impossible de vérifier le numéro (WhatsApp déconnecté ou erreur : ${
                err instanceof Error ? err.message : String(err)
              }). ` +
              `Passe le chatId exact déjà connu (ex. 22996158855@c.us).`,
          });
        }
      }

      const preferredName =
        args.name !== undefined && String(args.name).trim()
          ? String(args.name).trim()
          : undefined;
      const waName = await resolveWhatsAppDisplayName(userId, chatId, preferredName).catch(
        () => null,
      );
      const displayName =
        (waName && !isPhoneLikeLabel(waName) ? waName : null) ||
        (preferredName && !isPhoneLikeLabel(preferredName) ? preferredName : null) ||
        undefined;

      const contact = await saveContact(userId, {
        phone: chatId,
        name: displayName,
        notes: args.notes !== undefined ? String(args.notes) : undefined,
        status: statusRaw as ContactStatus | undefined,
        autoReply: typeof args.auto_reply === "boolean" ? args.auto_reply : undefined,
      });
      const { ensureGoogleContactBeforeSend } = await import("./integrations/google-contacts.js");
      const google = await ensureGoogleContactBeforeSend(userId, {
        phone: contact.phone,
        name: contact.name || displayName,
      });
      const googleNote =
        google.synced
          ? ` Google Contacts : OUI — fiche confirmée dans « Mes contacts » (${google.reason}).`
          : google.reason === "not_connected"
            ? " Google Contacts : NON — intégration non connectée (Réglages → Intégrations). Fiche Klanvio seulement."
            : google.reason === "token_revoked"
              ? " Google Contacts : NON — token révoqué, reconnecte l’intégration."
              : google.reason === "verify_failed" || google.reason === "create_empty"
                ? " Google Contacts : NON — création non confirmée par Google. Réessaie ou reconnecte."
                : ` Google Contacts : NON — échec (${google.reason || "error"}).`;
      return JSON.stringify({
        success: true,
        contact: formatContact(contact),
        googleContactsSynced: google.synced,
        googleContactsReason: google.reason ?? null,
        // Consigne agent : ne JAMAIS dire « synchronisé » si googleContactsSynced === false.
        message: `Contact ${chatIdToDisplay(contact.phone)}${
          contact.name ? ` (${contact.name})` : ""
        } enregistré dans Klanvio (statut : ${contact.status}).${googleNote}`,
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
      const mapped = contacts.map(formatContact);
      return JSON.stringify({
        count: mapped.length,
        contacts: mapped,
        display: formatVerticalContactList(
          mapped.map((c) => ({ name: c.name, phone: c.phone, display: c.display })),
          "contacts"
        ),
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

        if (chatId.endsWith("@g.us")) {
          const gate = await assertGroupMessagingAllowed(userId, threadId, chatId);
          if (gate) return JSON.stringify({ error: gate });
          await assertUserIsGroupAdmin(userId, chatId);
        }

        if (chatId.endsWith("@c.us")) {
          const existing = await getContact(userId, chatId);
          if (existing?.status === "stop") {
            return JSON.stringify({
              error: `Ce contact est en STOP. Aucun message ne sera envoyé. Demandez à l'utilisateur de le débloquer si vraiment nécessaire.`,
            });
          }
          const { isAwaitingProspectReply } = await import("./outbound-safety.js");
          const agentThread = await getAgentThread(userId, threadId);
          const scopedAutomationId = agentThread?.automation_id ?? null;
          if (await isAwaitingProspectReply(userId, chatId, scopedAutomationId)) {
            return JSON.stringify({
              error:
                "Un message a déjà été envoyé à ce prospect (dans cette automatisation) et il n'a pas encore répondu. " +
                "Interdit d'envoyer un second message tant qu'il n'a pas écrit. Attendez sa réponse (auto-reply).",
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
        const { getRecentAgentMessages } = await import("./db.js");
        const history = await getRecentAgentMessages(userId, threadId, 40);
        const consent = detectStickerConsent(
          history.map((m) => ({ role: m.role, content: m.content }))
        );
        if (consent === "no") {
          return JSON.stringify({
            error:
              "Emojis / réactions refusés par l'utilisateur. Réponds en texte uniquement.",
          });
        }
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

      // Enforcement runtime : jamais de sticker sans accord explicite
      try {
        const { getRecentAgentMessages } = await import("./db.js");
        const history = await getRecentAgentMessages(userId, threadId, 40);
        const consent = detectStickerConsent(
          history.map((m) => ({ role: m.role, content: m.content }))
        );
        if (consent !== "yes") {
          return JSON.stringify({
            error:
              "Stickers refusés ou non autorisés. Réponds en texte uniquement (l'utilisateur a dit non, ou n'a pas donné son accord).",
          });
        }
      } catch {
        return JSON.stringify({
          error: "Impossible de vérifier l'autorisation stickers — envoi annulé. Utilise un message texte.",
        });
      }

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
        if (chatId.endsWith("@g.us")) {
          await assertUserIsGroupAdmin(userId, chatId);
        }
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
      if (chatId.endsWith("@g.us")) {
        const gate = await assertGroupMessagingAllowed(userId, threadId, chatId);
        if (gate) return JSON.stringify({ error: gate });
        try {
          await assertUserIsGroupAdmin(userId, chatId);
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
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

    case "get_outreach_status": {
      const snap = await getOutreachQuotaSnapshot(userId);
      return JSON.stringify({
        ...snap,
        summary: snap.summaryForAgent,
      });
    }

    case "get_contact_conversation": {
      const phone = String(args.phone ?? "");
      if (!phone.trim()) {
        return JSON.stringify({ error: "Le numéro / chatId est requis." });
      }
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
      const agentThread = await getAgentThread(userId, threadId);
      const automationId = agentThread?.automation_id ?? null;
      const thread = await getContactThread(userId, phone, limit, automationId);
      const contact = await getContact(
        userId,
        phone.includes("@") ? phone.trim() : `${phone.replace(/\D/g, "")}@c.us`
      );
      return JSON.stringify({
        phone: contact?.phone ?? phone,
        display: chatIdToDisplay(contact?.phone ?? phone),
        name: contact?.name ?? null,
        status: contact?.status ?? null,
        automationId,
        count: thread.length,
        source: "messages (isolé par automatisation)",
        hint: automationId
          ? "Historique limité à cette automatisation — les échanges d'autres autos sont invisibles ici."
          : "Aucune automatisation liée à ce fil : historique global (epoch contact).",
        messages: thread.map((m) => ({
          id: m.id,
          direction: m.direction,
          sender: m.sender_name || (m.direction === "entrant" ? chatIdToDisplay(m.contact_phone) : "Moi"),
          body: m.body,
          at: m.created_at,
          automationId: m.automation_id,
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
        message: "Profil business enregistré. Les prochaines réponses auto l'utiliseront.",
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

    case "list_campaign_memories": {
      const memories = await listCampaignMemories(userId);
      return JSON.stringify({
        count: memories.length,
        memories: memories.map((m) => ({
          id: m.id,
          name: m.name,
          isDefault: m.isDefault,
          ownerName: m.ownerName || null,
          tone: memoryToneLabel(m.tone),
          formality: m.formality,
          stickersEnabled: m.stickersEnabled,
          sendWindow: `${m.sendWindowStart}h–${m.sendWindowEnd}h`,
        })),
        hint: "Cite les noms. Pour lier une mémoire à CE fil → set_campaign_memory, ou l'utilisateur clique sur Mémoire dans le chat.",
      });
    }

    case "get_active_campaign_memory": {
      const mem = await getLinkedCampaignMemory(userId, threadId);
      if (!mem) {
        return JSON.stringify({
          active: null,
          linkedToThread: false,
          message:
            "Aucune mémoire liée à ce fil. Demande à l'utilisateur de cliquer sur le bouton Mémoire pour en choisir ou en créer une avant de continuer.",
        });
      }
      return JSON.stringify({
        active: {
          id: mem.id,
          name: mem.name,
          instructions: mem.instructions,
          isDefault: mem.isDefault,
        },
        linkedToThread: true,
      });
    }

    case "set_campaign_memory": {
      const byId =
        args.memory_id != null && Number.isFinite(Number(args.memory_id))
          ? Number(args.memory_id)
          : null;
      let mem =
        byId != null ? await getCampaignMemory(userId, byId) : null;
      if (!mem && args.name) {
        mem = await findCampaignMemoryByName(userId, String(args.name));
      }
      if (!mem) {
        const all = await listCampaignMemories(userId);
        return JSON.stringify({
          error: "Mémoire introuvable.",
          available: all.map((m) => m.name),
        });
      }
      await setThreadCampaignMemory(userId, threadId, mem.id);
      return JSON.stringify({
        success: true,
        memory: { id: mem.id, name: mem.name },
        message: `Mémoire « ${mem.name} » active sur ce fil. Ne repose plus présentation / stickers / fenêtre / ton.`,
      });
    }

    case "list_typeform_forms": {
      try {
        const accessToken = await getValidTypeformAccessToken(userId);
        const forms = await fetchTypeformForms(accessToken);
        const limit =
          args.limit != null && Number.isFinite(Number(args.limit))
            ? Math.min(Math.max(1, Number(args.limit)), 100)
            : 50;
        const sliced = forms.slice(0, limit).map((f) => ({
          id: f.id,
          title: f.title,
          lastUpdatedAt: f.lastUpdatedAt ?? null,
        }));
        return JSON.stringify({
          connected: true,
          forms: sliced,
          count: sliced.length,
          total: forms.length,
          message:
            sliced.length === 0
              ? "Aucun formulaire Typeform sur ce compte."
              : `${sliced.length} formulaire(s). Utilise list_typeform_responses avec un form_id pour lire les soumissions.`,
        });
      } catch (err) {
        if (err instanceof TypeformAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: TYPEFORM_REAUTH_MESSAGE,
            code: "typeform_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur Typeform.",
          code: err instanceof TypeformAuthError ? err.code : "http",
        });
      }
    }

    case "list_typeform_responses": {
      const formId = String(args.form_id ?? "").trim();
      if (!formId) {
        return JSON.stringify({ error: "form_id requis (depuis list_typeform_forms)." });
      }
      const pageSize =
        args.page_size != null && Number.isFinite(Number(args.page_size))
          ? Number(args.page_size)
          : 25;
      try {
        const accessToken = await getValidTypeformAccessToken(userId);
        const data = await fetchTypeformResponses(accessToken, formId, pageSize);
        return JSON.stringify({
          formId: data.formId,
          totalItems: data.totalItems,
          returned: data.responses.length,
          responses: data.responses.map((r) => ({
            responseId: r.responseId,
            submittedAt: r.submittedAt,
            name: r.name,
            phone: r.phone,
            email: r.email,
            answers: r.answers.slice(0, 20),
          })),
          suggested_leads: data.suggestedLeads,
          hint:
            "Pour prospecter : confirme les numéros avec l'utilisateur, puis create_automation(type=contact_prospect, contacts=[…]) en brouillon — n'active pas sans brief.",
        });
      } catch (err) {
        if (err instanceof TypeformAuthError && err.code === "revoked") {
          return JSON.stringify({
            error:
              err.message.includes("responses:read")
                ? err.message
                : TYPEFORM_REAUTH_MESSAGE,
            code: "typeform_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur lecture réponses Typeform.",
          code: err instanceof TypeformAuthError ? err.code : "http",
        });
      }
    }

    case "list_calendly_event_types": {
      try {
        const accessToken = await getValidCalendlyAccessToken(userId);
        const me = await fetchCalendlyUser(accessToken);
        const types = await fetchCalendlyEventTypes(accessToken, me.uri);
        const limit =
          args.limit != null && Number.isFinite(Number(args.limit))
            ? Math.min(Math.max(1, Number(args.limit)), 100)
            : 50;
        const sliced = types.slice(0, limit).map((t) => ({
          uri: t.uri,
          uuid: t.uuid,
          name: t.name,
          schedulingUrl: t.schedulingUrl ?? null,
          active: t.active ?? null,
          duration: t.duration ?? null,
        }));
        return JSON.stringify({
          connected: true,
          event_types: sliced,
          count: sliced.length,
          total: types.length,
          message:
            sliced.length === 0
              ? "Aucun type d'événement Calendly sur ce compte."
              : `${sliced.length} type(s). Utilise list_calendly_bookings pour lire les RDV / invitees.`,
        });
      } catch (err) {
        if (err instanceof CalendlyAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: CALENDLY_REAUTH_MESSAGE,
            code: "calendly_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur Calendly.",
          code: err instanceof CalendlyAuthError ? err.code : "http",
        });
      }
    }

    case "list_calendly_bookings": {
      const eventTypeUri = String(args.event_type_uri ?? "").trim() || undefined;
      const limit =
        args.limit != null && Number.isFinite(Number(args.limit))
          ? Number(args.limit)
          : 25;
      try {
        const accessToken = await getValidCalendlyAccessToken(userId);
        const me = await fetchCalendlyUser(accessToken);
        const data = await fetchCalendlyBookings(accessToken, me.uri, {
          eventTypeUri,
          limit,
        });
        return JSON.stringify({
          totalEvents: data.totalEvents,
          returned: data.bookings.length,
          bookings: data.bookings.map((b) => ({
            eventUuid: b.eventUuid,
            eventName: b.eventName,
            startTime: b.startTime,
            name: b.name,
            phone: b.phone,
            email: b.email,
            answers: b.answers.slice(0, 12),
          })),
          suggested_leads: data.suggestedLeads,
          hint:
            "Pour prospecter : confirme les numéros avec l'utilisateur, puis create_automation(type=contact_prospect, contacts=[…]) en brouillon.",
        });
      } catch (err) {
        if (err instanceof CalendlyAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: CALENDLY_REAUTH_MESSAGE,
            code: "calendly_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur lecture RDV Calendly.",
          code: err instanceof CalendlyAuthError ? err.code : "http",
        });
      }
    }

    case "list_calendly_contacts": {
      const limit =
        args.limit != null && Number.isFinite(Number(args.limit))
          ? Number(args.limit)
          : 50;
      try {
        const accessToken = await getValidCalendlyAccessToken(userId);
        const me = await fetchCalendlyUser(accessToken);
        const data = await fetchCalendlyContacts(accessToken, {
          organizationUri: me.currentOrganization,
          limit,
        });
        return JSON.stringify({
          returned: data.contacts.length,
          contacts: data.contacts.map((c) => ({
            uri: c.uri,
            uuid: c.uuid,
            name: c.name,
            email: c.email,
            phone: c.phone,
            company: c.company ?? null,
            jobTitle: c.jobTitle ?? null,
          })),
          suggested_leads: data.suggestedLeads,
          hint:
            "Carnet Contacts Calendly. Confirme les numéros puis create_automation(type=contact_prospect) en brouillon.",
        });
      } catch (err) {
        if (err instanceof CalendlyAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: CALENDLY_REAUTH_MESSAGE,
            code: "calendly_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur lecture Contacts Calendly.",
          code: err instanceof CalendlyAuthError ? err.code : "http",
        });
      }
    }

    case "list_tally_forms": {
      try {
        const apiKey = await getValidTallyApiKey(userId);
        const forms = await fetchTallyForms(apiKey);
        const limit =
          args.limit != null && Number.isFinite(Number(args.limit))
            ? Math.min(Math.max(1, Number(args.limit)), 100)
            : 50;
        const sliced = forms.slice(0, limit).map((f) => ({
          id: f.id,
          name: f.name,
          publicUrl: f.publicUrl,
          status: f.status ?? null,
          updatedAt: f.updatedAt ?? null,
          numberOfSubmissions: f.numberOfSubmissions ?? null,
        }));
        return JSON.stringify({
          connected: true,
          forms: sliced,
          count: sliced.length,
          total: forms.length,
          message:
            sliced.length === 0
              ? "Aucun formulaire Tally sur ce compte."
              : `${sliced.length} formulaire(s). Utilise list_tally_responses avec forms[].id (ou publicUrl), jamais le titre.`,
        });
      } catch (err) {
        if (err instanceof TallyAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: TALLY_REAUTH_MESSAGE,
            code: "tally_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur Tally.",
          code: err instanceof TallyAuthError ? err.code : "http",
        });
      }
    }

    case "list_tally_responses": {
      const formId = String(args.form_id ?? "").trim();
      if (!formId) {
        return JSON.stringify({
          error: "form_id requis (id ou URL depuis list_tally_forms).",
        });
      }
      const pageSize =
        args.page_size != null && Number.isFinite(Number(args.page_size))
          ? Number(args.page_size)
          : 25;
      try {
        const apiKey = await getValidTallyApiKey(userId);
        // Pré-résolution pour message d’erreur plus clair
        const resolved = await resolveTallyFormId(apiKey, formId);
        if (!resolved) {
          return JSON.stringify({
            error: `Formulaire introuvable pour « ${formId.slice(0, 80)} ». Relance list_tally_forms.`,
            code: "invalid",
          });
        }
        const data = await fetchTallyResponses(apiKey, resolved.id, pageSize);
        return JSON.stringify({
          formId: data.formId,
          formName: data.resolvedFormName ?? resolved.name,
          publicUrl: `https://tally.so/r/${data.formId}`,
          filterUsed: data.filterUsed ?? "completed",
          totalItems: data.totalItems,
          returned: data.responses.length,
          responses: data.responses.map((r) => ({
            submissionId: r.submissionId,
            submittedAt: r.submittedAt,
            name: r.name,
            phone: r.phone,
            email: r.email,
            answers: r.answers.slice(0, 20),
          })),
          suggested_leads: data.suggestedLeads,
          hint:
            "Pour prospecter : confirme les numéros avec l'utilisateur, puis create_automation(type=contact_prospect, contacts=[…]) en brouillon.",
        });
      } catch (err) {
        if (err instanceof TallyAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: TALLY_REAUTH_MESSAGE,
            code: "tally_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur lecture soumissions Tally.",
          code: err instanceof TallyAuthError ? err.code : "http",
        });
      }
    }

    case "list_connected_sheets": {
      const googleRow = await getUserIntegration(userId, GOOGLE_SHEETS_PROVIDER);
      if (!googleRow) {
        return JSON.stringify({
          connected: false,
          sheets: [],
          error: "Google Sheets non connecté. Invite l'utilisateur à Réglages → Intégrations → Connecter Google Sheets.",
          code: "google_reauth_required",
        });
      }
      const sheets = await listConnectedSheets(userId);
      return JSON.stringify({
        connected: true,
        email: googleRow.provider_email,
        sheets: sheets.map((s) => ({
          spreadsheetId: s.spreadsheetId,
          title: s.title,
          addedAt: s.addedAt,
        })),
        count: sheets.length,
        message:
          sheets.length === 0
            ? "Aucun Sheet connecté. L'utilisateur doit en ajouter via Réglages → Intégrations → Ajouter des feuilles."
            : `${sheets.length} Sheet(s) connecté(s). Utilise read_google_sheet avec un spreadsheet_id.`,
      });
    }

    case "read_google_sheet": {
      const spreadsheetId = String(args.spreadsheet_id ?? "").trim();
      if (!spreadsheetId) {
        return JSON.stringify({ error: "spreadsheet_id requis." });
      }
      const connected = await listConnectedSheets(userId);
      const meta = connected.find((s) => s.spreadsheetId === spreadsheetId);
      if (!meta) {
        return JSON.stringify({
          error:
            "Ce spreadsheet_id n'est pas dans les Sheets connectés. Appelle d'abord list_connected_sheets.",
          code: "sheet_not_connected",
        });
      }
      const range = String(args.range ?? "A1:Z50").trim() || "A1:Z50";
      const maxRows =
        args.max_rows != null && Number.isFinite(Number(args.max_rows))
          ? Number(args.max_rows)
          : 50;
      try {
        const accessToken = await getValidGoogleSheetsToken(userId);
        const data = await fetchSpreadsheetValues(accessToken, spreadsheetId, range, maxRows);
        return JSON.stringify({
          spreadsheetId,
          title: meta.title,
          range: data.range,
          headers: data.headers,
          rows: data.rows,
          totalRowsInSheet: data.totalRows,
          returnedRows: data.rows.length,
          suggested_leads: data.suggestedLeads,
          hint:
            "Pour prospecter : confirme les numéros avec l'utilisateur, puis create_automation(type=contact_prospect, contacts=[…]) en brouillon — n'active pas sans brief.",
        });
      } catch (err) {
        if (err instanceof GoogleAuthError && err.code === "revoked") {
          return JSON.stringify({
            error: GOOGLE_SHEETS_REAUTH_MESSAGE,
            code: "google_reauth_required",
          });
        }
        return JSON.stringify({
          error: err instanceof Error ? err.message : "Erreur lecture Sheet.",
          code: err instanceof GoogleAuthError ? err.code : "http",
        });
      }
    }

    case "create_automation": {
      const type = String(args.type ?? "") as AutomationType;
      if (!["group_prospect", "contact_prospect", "keyword_sales", "custom_followup", "group_broadcast"].includes(type)) {
        return JSON.stringify({ error: "type invalide." });
      }

      const agentThreadForPurpose = await getAgentThread(userId, threadId);
      const threadPurpose = agentThreadForPurpose?.purpose ?? null;
      if (threadPurpose === "support" && type !== "keyword_sales") {
        return JSON.stringify({
          error:
            "Ce fil est en mode Support client : utilise uniquement type=keyword_sales (mode inbound_closing). " +
            "Pas de prospection sortante (contact_prospect / group_prospect) ni group_broadcast ici. " +
            "Pour tout le compte WhatsApp : inbound_catch_all=true. Pour des phrases exactes : trigger_phrases.",
        });
      }
      if (
        threadPurpose === "prospection" &&
        (type === "keyword_sales" || type === "custom_followup" || type === "group_broadcast")
      ) {
        return JSON.stringify({
          error:
            "Ce fil est en mode Prospection : utilise type=contact_prospect ou group_prospect. " +
            "Pour du support, crée une nouvelle automatisation Support. Pour publier dans des groupes : Nouvelle automatisation → Groupes WhatsApp.",
        });
      }
      if (threadPurpose === "groupes" && type !== "group_broadcast") {
        return JSON.stringify({
          error:
            "Ce fil est en mode Groupes WhatsApp : utilise uniquement type=group_broadcast. " +
            "Pour prospecter des membres en DM ou du support, crée une nouvelle automatisation avec le bon type.",
        });
      }

      const explicitAutomationId =
        args.automation_id != null && Number.isFinite(Number(args.automation_id))
          ? Number(args.automation_id)
          : undefined;

      if (!explicitAutomationId && (await threadHasCampaign(userId, threadId))) {
        const thread = await getAgentThread(userId, threadId);
        return JSON.stringify({
          error: `Ce fil gère déjà une automatisation (#${thread?.automation_id ?? "?"}). Cliquez sur « Nouvelle automatisation » dans la barre latérale pour en créer une autre.`,
        });
      }

      // Isolation : une mémoire doit être explicitement liée à ce fil
      const linkedMem = await getLinkedCampaignMemory(userId, threadId);
      if (!linkedMem) {
        return JSON.stringify({
          error:
            "Aucune mémoire n'est connectée à cette automatisation. Demande à l'utilisateur de cliquer sur le bouton Mémoire en haut du chat pour en choisir ou en créer une, puis réessaie.",
          code: "memory_required",
        });
      }

      if (explicitAutomationId) {
        const belongs = await automationBelongsToThread(userId, threadId, explicitAutomationId);
        if (!belongs) {
          return JSON.stringify({
            error: `La campagne #${explicitAutomationId} n'appartient pas à ce fil. Utilisez « Nouvelle automatisation » pour une autre campagne.`,
          });
        }
      }

      const config = buildAutomationConfigFromArgs(args, type);
      const isOutbound = type === "group_prospect" || type === "contact_prospect";

      // Seed depuis la mémoire liée à ce fil (ne remplace pas ce que l'outil a déjà fourni)
      try {
        const mem = linkedMem;
        if (mem) {
          const hints = parseMemoryHints(mem.instructions);
          if (args.stickers_enabled === undefined) {
            config.stickersEnabled = hints.stickersEnabled || mem.stickersEnabled;
          }
          if (args.quiet_hours_start == null && args.quiet_hours_end == null) {
            const q = memoryToQuietHours(mem);
            config.quietHoursStart = q.quietHoursStart;
            config.quietHoursEnd = q.quietHoursEnd;
          }
          // Lien mémoire AVANT bake du guide (évite RDV sans URL → blocage)
          if (!config.closingLink?.trim()) {
            const fromMem = extractUsefulLinkFromText(mem.instructions);
            if (fromMem) config.closingLink = fromMem;
          }
          // Prix : mémoire liée + profil business (évite « Prix manquant… passe-le dans price »)
          if (!config.price?.trim()) {
            const fromMem =
              mem.instructions.match(
                /(?:prix|tarif|montant)\s*[:=]?\s*([^\n.]{0,40}?\b\d[\d\s.,]{1,12}\s*(?:fcfa|f\b|€|euros?)?)/i,
              )?.[1] ||
              mem.instructions.match(/\b(\d[\d\s.,]{2,12}\s*(?:fcfa|f\b|€|euros?))\b/i)?.[1];
            const cleaned = fromMem?.replace(/\s+/g, " ").trim();
            if (cleaned && !/\[indiquer/i.test(cleaned)) {
              config.price = cleaned.slice(0, 80);
            }
          }
          if (!config.price?.trim()) {
            try {
              const { getAppSettings } = await import("./db.js");
              const s = await getAppSettings(userId);
              const bp = (s.business_price || "").trim();
              if (bp) config.price = bp.slice(0, 80);
            } catch {
              /* ignore */
            }
          }
          if (!config.productName?.trim()) {
            const offerHit =
              mem.instructions.match(
                /(?:produit|offre|service)\s*[:=]\s*([^\n]{3,120})/i,
              )?.[1] || null;
            const cleaned = offerHit?.replace(/[\[\]]/g, "").trim();
            if (cleaned && !/^décrire|^indiquer/i.test(cleaned)) {
              config.productName = cleaned.slice(0, 120);
            }
          }
          const { bakeConversationGuideFromMemory } = await import("./campaign-sync.js");
          config.conversationGuide = bakeConversationGuideFromMemory(
            mem,
            config.conversationGuide
          );
          // keyword_sales : cadre Support prioritaire (la mémoire est souvent écrite pour la prospection).
          if (type === "keyword_sales") {
            const { buildSupportConversationGuide } = await import("./support-flow.js");
            const frame = buildSupportConversationGuide({
              catchAll: Boolean(config.inboundCatchAll),
              triggers: (config.triggerPhrases || config.keywords || []).map(String),
              handoffKeywords: config.handoffKeywords,
              productHint: config.productName,
              price: config.price,
              link: config.closingLink,
              closingGoal: config.closingGoal,
            });
            const existing = (config.conversationGuide || "").trim();
            config.conversationGuide = existing.includes("CADRE SUPPORT CLIENT")
              ? existing
              : existing
                ? `${frame}\n---\n${existing}`
                : frame;
          }
          const owner = (hints.ownerName || mem.ownerName).trim();
          if (owner) {
            await saveBusinessProfile(userId, { ownerName: owner }).catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }

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
          error: userFacingError(
            "Prix manquant. Avant de créer la campagne, demande le prix exact (ex. 15000 FCFA) et passe-le dans price — jamais [prix].",
          ),
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
            config.closingGoal === "appointment"
              ? "Il me manque encore ton lien de réservation (Calendly, Google Agenda ou une autre URL). Colle-le ici."
              : "Il me manque encore le lien à envoyer aux prospects. Colle l'URL complète ici.",
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
              "Il me manque encore ton lien de réservation (Calendly, Google Agenda ou une autre URL). Colle-le ici, puis on continue.",
          });
        }
      }
      if (config.initialMessage && hasTemplatePlaceholders(config.initialMessage)) {
        return JSON.stringify({
          error: "initial_message contient des crochets. Remplace-les par de vraies valeurs.",
        });
      }
      // Hors cadre A.I.D.A. : on avertit et on demande l'accord, on n'impose pas.
      const openerFrameConfirmed =
        Boolean(args.keep_opener_as_is) || Boolean(args.ab_variants_from_chat);
      if (
        type !== "group_broadcast" &&
        type !== "keyword_sales" &&
        config.initialMessage &&
        !openerFrameConfirmed &&
        !isValidAttentionOpener(config.initialMessage)
      ) {
        return JSON.stringify({
          needsUserConfirmation: true,
          warning: formatAttentionOpenerWarning("initial_message", config.initialMessage),
        });
      }
      const abVariantsParsed = parseAbVariantsArg(args.ab_variants);
      const abVariantsExplicit = Boolean(abVariantsParsed);
      // Pré-contrôle si ab_variants est fourni (évite un merge inutile)
      if (isOutbound && abVariantsExplicit) {
        const early = validateOutboundAbVariants(abVariantsParsed!);
        if (early) return JSON.stringify({ error: early });
        if (!openerFrameConfirmed) {
          const offFrame = outboundVariantsOutOfFrame(abVariantsParsed!);
          if (offFrame) {
            return JSON.stringify({
              needsUserConfirmation: true,
              warning: formatAttentionOpenerWarning(
                `ab_variants.${offFrame.id}`,
                offFrame.message
              ),
            });
          }
        }
      }

      /** Persist draft — update existing if reusable, else create. */
      const persistDraft = async (
        cfg: AutomationConfig,
        extra?: { resolvedCount?: number; unresolved?: string[] }
      ): Promise<string> => {
        const explicitId =
          args.automation_id != null && Number.isFinite(Number(args.automation_id))
            ? Number(args.automation_id)
            : undefined;
        const reusable = await findReusableAutomation(userId, type, {
          automationId: explicitId,
          groupId: cfg.groupId,
          name: args.name ? String(args.name) : undefined,
          threadId,
        });

        const name = String(args.name ?? reusable?.name ?? "Campagne");
        const summary = args.summary ? String(args.summary) : reusable?.summary ?? undefined;
        const budget = args.budget_fcfa ? Number(args.budget_fcfa) : reusable?.budget_fcfa ?? 0;

        // Fusion : garde les champs non fournis de la campagne existante
        const merged: AutomationConfig = reusable
          ? {
              ...reusable.config,
              ...cfg,
              enableAutoReply: true,
              // Ne pas écraser group/contacts si absents du nouvel appel
              groupId: cfg.groupId ?? reusable.config.groupId,
              groupName: cfg.groupName ?? reusable.config.groupName,
              contactTargets: cfg.contactTargets ?? reusable.config.contactTargets,
              initialMessage: cfg.initialMessage ?? reusable.config.initialMessage,
              conversationGuide: cfg.conversationGuide ?? reusable.config.conversationGuide,
              abVariants: cfg.abVariants ?? reusable.config.abVariants,
            }
          : { ...cfg, enableAutoReply: true };

        // Toujours 5 variantes en sortant (après merge) — empêche de ne garder que initial_message
        if (isOutbound) {
          const abErr = validateOutboundAbVariants(merged.abVariants);
          if (abErr) return JSON.stringify({ error: abErr });
          if (!openerFrameConfirmed) {
            const offFrame = outboundVariantsOutOfFrame(merged.abVariants);
            if (offFrame) {
              return JSON.stringify({
                needsUserConfirmation: true,
                warning: formatAttentionOpenerWarning(
                  `ab_variants.${offFrame.id}`,
                  offFrame.message
                ),
              });
            }
          }
          merged.personalizeMessages = false;
        }

        if (reusable) {
          await updateAutomationConfig(userId, reusable.id, merged);
          await updateAutomationMeta(userId, reusable.id, {
            name,
            summary: summary ?? undefined,
            budgetFcfa: budget,
          });
          // Si active, renforcer auto-reply ; si pause, ne pas réactiver les contacts ici
          if (reusable.status === "active") {
            await resumeAutomationMessaging(userId, reusable.id);
          }
          await linkAutomationToThread(userId, threadId, reusable.id, name);
          const plan = await persistVisualPlan(userId, reusable.id);
          const fresh = await getAutomationDetail(userId, reusable.id);
          return JSON.stringify({
            success: true,
            updated: true,
            automationId: reusable.id,
            name: fresh?.automation.name,
            type: fresh?.automation.type,
            status: fresh?.automation.status,
            configSummary: {
              initialMessage: fresh?.automation.config.initialMessage ?? null,
              price: fresh?.automation.config.price ?? null,
              productName: fresh?.automation.config.productName ?? null,
              closingLink: fresh?.automation.config.closingLink ?? null,
              abVariantsCount: fresh?.automation.config.abVariants?.length ?? 0,
              guideChars: fresh?.automation.config.conversationGuide?.length ?? 0,
            },
            resolvedContacts: extra?.resolvedCount,
            unresolved: extra?.unresolved,
            plan: plan
              ? { title: plan.title, automationId: plan.automationId, type: plan.type }
              : undefined,
            planDisplay: plan
              ? formatPlanDisplay(
                  plan,
                  `« ${name} » est prêt. Veux-tu tester une **simulation** sur le téléphone avant de lancer ?`
            )
          : undefined,
            message: `« ${name} » mis à jour — pas de doublon. Prochaine étape : simulation sur le téléphone (show_campaign_simulation), puis lancement si tu valides.`,
            simulationHint:
              "Propose une simulation sur le téléphone via show_campaign_simulation (6-7 tours), sans WhatsApp réel.",
            completedAt: nowFr(),
          });
        }

        const auto = await createAutomation(userId, {
          name,
          type,
          config: merged,
          summary,
          budgetFcfa: budget,
          status: "draft",
        });
        await linkAutomationToThread(userId, threadId, auto.id, name);
        const plan = await persistVisualPlan(userId, auto.id);
        const otherActive = (await listActiveAutomations(userId)).filter((a) => a.id !== auto.id);
        const activeNote = otherActive.length
          ? ` Une campagne est déjà active (${otherActive.map((a) => `« ${a.name} »`).join(", ")}) — elle continue. Celle-ci reste en brouillon : active-la quand tu es prêt (dans le chat ou bouton Lancer) ; l'ancienne passera alors en pause.`
          : " Prochaine étape : simulation sur le téléphone, puis lancement après confirmation.";
        return JSON.stringify({
          success: true,
          updated: false,
          automationId: auto.id,
          name: auto.name,
          type: auto.type,
          status: "draft",
          configSummary: {
            initialMessage: auto.config.initialMessage ?? null,
            price: auto.config.price ?? null,
            productName: auto.config.productName ?? null,
            closingLink: auto.config.closingLink ?? null,
            abVariantsCount: auto.config.abVariants?.length ?? 0,
            guideChars: auto.config.conversationGuide?.length ?? 0,
          },
          resolvedContacts: extra?.resolvedCount,
          unresolved: extra?.unresolved,
          otherActiveCampaigns: otherActive.map((a) => ({ id: a.id, name: a.name })),
          keepAsDraft: true,
          doNotActivateYet: otherActive.length > 0,
          plan: plan
            ? { title: plan.title, automationId: plan.automationId, type: plan.type }
            : undefined,
          planDisplay: plan
            ? formatPlanDisplay(
                plan,
                otherActive.length
                  ? `« ${auto.name} » est en brouillon. Une autre campagne tourne encore — simule sur le téléphone, puis lance quand tu es prêt.`
                  : `« ${auto.name} » est prêt en brouillon. Veux-tu tester une **simulation** sur le téléphone avant le lancement ?`
              )
            : undefined,
          message: `« ${auto.name} » prêt en brouillon${
            extra?.resolvedCount != null ? ` avec ${extra.resolvedCount} contact(s)` : ""
          }.${extra?.unresolved?.length ? ` Non résolus : ${extra.unresolved.join(", ")}.` : ""}${activeNote}`,
          simulationHint:
            "Propose une simulation sur le téléphone via show_campaign_simulation (6-7 tours), sans WhatsApp réel.",
          completedAt: nowFr(),
        });
      };

      if (type === "contact_prospect") {
        if (!args.initial_message) {
          return JSON.stringify({
            error: userFacingError("contact_prospect requiert initial_message."),
          });
        }
        const rawContacts = Array.isArray(args.contacts)
          ? args.contacts.map(String).map((s) => s.trim()).filter(Boolean)
          : [];
        if (!rawContacts.length) {
          return JSON.stringify({
            error: userFacingError(
              "contact_prospect requiert au moins un contact (numéro, chatId ou nom).",
            ),
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
            let id = await resolveRecipient(userId, raw);
            if (id.endsWith("@g.us")) {
              failed.push(`${raw} (c'est un groupe — utilise group_prospect)`);
              continue;
            }
            // Canoniser + JID WhatsApp réel (évite 22901… / numéros inventés)
            try {
              const variants = phoneDigitsVariants(id);
              const checks = await checkWhatsAppNumbers(userId, variants);
              const hit = checks.find((c) => c.exists && c.jid);
              if (!hit) {
                failed.push(`${raw} (pas sur WhatsApp)`);
                continue;
              }
              const jidDigits = canonicalizePhoneDigits(chatIdToNumber(String(hit.jid)));
              if (jidDigits.length >= 8 && jidDigits.length <= 13) {
                id = `${jidDigits}@c.us`;
              }
            } catch {
              id = `${canonicalizePhoneDigits(chatIdToNumber(id))}@c.us`;
            }

            const hintLabel = /^[\d+\s\-().]+$/.test(raw) ? undefined : raw;
            const waName = await resolveWhatsAppDisplayName(userId, id, hintLabel).catch(
              () => null,
            );
            const label =
              (waName && !isPhoneLikeLabel(waName) ? waName : null) ||
              (hintLabel && !isPhoneLikeLabel(hintLabel) ? hintLabel : undefined);

            if (!resolved.some((r) => r.id === id)) {
              resolved.push({ id, label });
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
        return await persistDraft(config, {
          resolvedCount: resolved.length,
          unresolved: failed,
        });
      }

      if (type === "group_prospect") {
        if (!args.group_id || !args.initial_message) {
          return JSON.stringify({
            error: userFacingError("group_prospect requiert group_id et initial_message."),
          });
        }
        try {
          await requireEvolutionConnected(userId, "la création d'une campagne de prospection groupe");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
        const groupId = await resolveGroupId(userId, String(args.group_id));
        const groups = await listWhatsAppGroups(userId);
        const matched = groups.find((g) => g.id === groupId);
        config.groupId = groupId;
        config.groupName = matched?.name ?? String(args.group_id);
      }

      if (type === "group_broadcast") {
        if (!args.initial_message) {
          return JSON.stringify({
            error: userFacingError(
              "group_broadcast requiert initial_message (texte à publier dans les groupes).",
            ),
          });
        }
        const rawGroups = Array.isArray(args.group_ids)
          ? args.group_ids.map(String).filter(Boolean)
          : args.group_id
            ? [String(args.group_id)]
            : [];
        if (!rawGroups.length) {
          return JSON.stringify({
            error: userFacingError(
              "group_broadcast requiert group_ids (un ou plusieurs groupes où vous êtes admin). Utilise list_whatsapp_groups(admin_only=true).",
            ),
          });
        }
        try {
          await requireEvolutionConnected(userId, "la création d'une diffusion groupes");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
        const resolved: Array<{ id: string; label?: string }> = [];
        const failed: string[] = [];
        for (const raw of rawGroups) {
          try {
            const gid = await resolveGroupId(userId, raw);
            await assertUserIsGroupAdmin(userId, gid);
            const groups = await listWhatsAppGroups(userId);
            const matched = groups.find((g) => g.id === gid);
            resolved.push({ id: gid, label: matched?.name ?? raw });
          } catch (err) {
            failed.push(`${raw} (${err instanceof Error ? err.message : "erreur"})`);
          }
        }
        if (!resolved.length) {
          return JSON.stringify({
            error: `Aucun groupe admin résolu. ${failed.join(" · ")}`,
          });
        }
        config.groupTargets = resolved;
        config.mode = "group_broadcast";
        config.enableAutoReply = false;
        return await persistDraft(config, {
          resolvedCount: resolved.length,
          unresolved: failed,
        });
      }

      if (type === "keyword_sales") {
        const catchAll = config.inboundCatchAll === true;
        const phrases = config.triggerPhrases ?? [];
        if (!catchAll && !phrases.length) {
          return JSON.stringify({
            error: userFacingError(
              "keyword_sales requiert trigger_phrases (mot/phrase exact), " +
                "OU inbound_catch_all=true pour gérer tout le compte WhatsApp.",
            ),
          });
        }
        if (catchAll) {
          // Catch-all : pas de filtre par phrase (évite faux positifs)
          config.triggerPhrases = [];
          config.keywords = [];
        }
      }

      return await persistDraft(config);
    }

    case "activate_automation": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      if (!(await automationBelongsToThread(userId, threadId, id))) {
        return JSON.stringify({
          error: `La campagne #${id} n'appartient pas à ce fil. Utilisez « Nouvelle automatisation » pour en créer une autre.`,
        });
      }
      const memForActivate = await getLinkedCampaignMemory(userId, threadId);
      if (!memForActivate) {
        return JSON.stringify({
          error:
            "Aucune mémoire connectée à ce fil. Demande de cliquer sur Mémoire avant d'activer.",
          code: "memory_required",
        });
      }
      const { activateAutomationCore } = await import("./activate-automation.js");
      const result = await activateAutomationCore(userId, id, {
        source: "agent",
        allowWithoutSimulation: Boolean(args.allow_without_simulation),
      });
      if (!result.ok) {
        return JSON.stringify({ error: result.error, automationId: result.automationId ?? id });
      }
      const fresh = await getAutomationDetail(userId, id);
      return JSON.stringify({
        success: true,
        automationId: id,
        status: "active",
        targetsAdded: result.targetsAdded,
        autoReply: true,
        pausedOthers: result.pausedOthers ?? [],
        stats: fresh?.automation.stats,
        message: result.message,
        completedAt: nowFr(),
      });
    }

    case "update_automation_config": {
      let id = args.automation_id != null ? Number(args.automation_id) : NaN;
      if (!Number.isFinite(id)) {
        const threadBound = await requireThreadAutomationId(userId, threadId);
        if (!threadBound.ok) return JSON.stringify({ error: threadBound.error });
        id = threadBound.automationId;
      } else {
        const bound = await requireThreadAutomationId(userId, threadId, id);
        if (!bound.ok) return JSON.stringify({ error: bound.error });
      }
      const detail = await getAutomationDetail(userId, id);
      if (!detail) {
        return JSON.stringify({ error: `Campagne #${id} introuvable.` });
      }

      const current = detail.automation.config;
      const merged: AutomationConfig = { ...current };

      if (args.initial_message) merged.initialMessage = String(args.initial_message);
      if (args.conversation_guide) merged.conversationGuide = String(args.conversation_guide);
      const updatedAb = parseAbVariantsArg(args.ab_variants);
      if (updatedAb) {
        merged.abVariants = updatedAb.map((v, i) => ({
          id: v.id || `v${i + 1}`,
          message: String(v.message ?? ""),
        }));
      }
      if (args.personalize_messages === true) merged.personalizeMessages = true;
      if (args.personalize_messages === false) merged.personalizeMessages = false;
      // Variantes validées = texte exact (rotation seulement), sauf override explicite.
      if (
        Array.isArray(merged.abVariants) &&
        merged.abVariants.length >= 2 &&
        args.personalize_messages !== true
      ) {
        merged.personalizeMessages = false;
      }
      if (Array.isArray(args.trigger_phrases)) {
        merged.triggerPhrases = args.trigger_phrases.map(String);
        merged.keywords = merged.triggerPhrases;
      }
      if (args.inbound_catch_all === true) {
        merged.inboundCatchAll = true;
        merged.triggerPhrases = [];
        merged.keywords = [];
      } else if (args.inbound_catch_all === false) {
        merged.inboundCatchAll = false;
      }
      if (args.product_name) merged.productName = String(args.product_name);
      if (args.price) merged.price = String(args.price);
      if (args.closing_link) merged.closingLink = String(args.closing_link).trim();
      if (args.sales_script) merged.salesScript = String(args.sales_script);
      if (args.closing_goal) {
        merged.closingGoal = String(args.closing_goal) as AutomationConfig["closingGoal"];
      }
      if (args.max_members != null) merged.maxMembers = Number(args.max_members);
      if (args.min_delay_seconds != null && Number.isFinite(Number(args.min_delay_seconds))) {
        merged.minDelaySeconds = Math.max(30, Math.round(Number(args.min_delay_seconds)));
      }
      if (args.max_delay_seconds != null && Number.isFinite(Number(args.max_delay_seconds))) {
        merged.maxDelaySeconds = Math.max(
          merged.minDelaySeconds ?? 30,
          Math.round(Number(args.max_delay_seconds))
        );
      }
      if (args.stickers_enabled != null) {
        merged.stickersEnabled = args.stickers_enabled === true;
      }
      if (Array.isArray(args.handoff_keywords)) {
        merged.handoffKeywords = args.handoff_keywords
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      const thirdParty = parseThirdPartyNotificationArgs(args);
      if (thirdParty) {
        if (!thirdParty.enabled) {
          merged.thirdPartyNotification = { enabled: false, phone: "" };
        } else {
          merged.thirdPartyNotification = {
            enabled: true,
            phone: thirdParty.phone || merged.thirdPartyNotification?.phone || "",
            role: thirdParty.role ?? merged.thirdPartyNotification?.role,
            context: thirdParty.context ?? merged.thirdPartyNotification?.context,
          };
        }
      }
      if (
        args.send_window_start != null &&
        Number.isFinite(Number(args.send_window_start)) &&
        args.send_window_end != null &&
        Number.isFinite(Number(args.send_window_end))
      ) {
        const activityQuiet = activityWindowToQuietHours(
          Number(args.send_window_start),
          Number(args.send_window_end)
        );
        if (activityQuiet) {
          merged.quietHoursStart = activityQuiet.start;
          merged.quietHoursEnd = activityQuiet.end;
        }
      } else if (
        (args.quiet_hours_start != null && Number.isFinite(Number(args.quiet_hours_start))) ||
        (args.quiet_hours_end != null && Number.isFinite(Number(args.quiet_hours_end)))
      ) {
        const nextStart =
          args.quiet_hours_start != null && Number.isFinite(Number(args.quiet_hours_start))
            ? Math.round(Number(args.quiet_hours_start))
            : merged.quietHoursStart;
        const nextEnd =
          args.quiet_hours_end != null && Number.isFinite(Number(args.quiet_hours_end))
            ? Math.round(Number(args.quiet_hours_end))
            : merged.quietHoursEnd;
        const isOut =
          detail.automation.type === "contact_prospect" ||
          detail.automation.type === "group_prospect" ||
          detail.automation.type === "group_broadcast";
        const quiet = isOut
          ? resolveOutboundQuietHours(nextStart, nextEnd)
          : resolveInboundQuietHours(nextStart, nextEnd);
        merged.quietHoursStart = quiet.start;
        merged.quietHoursEnd = quiet.end;
      }
      if (args.inbound_wave_gap_minutes != null && Number.isFinite(Number(args.inbound_wave_gap_minutes))) {
        merged.inboundWaveGapMinutes = Math.max(60, Math.round(Number(args.inbound_wave_gap_minutes)));
      }
      if (args.inbound_batch_size != null && Number.isFinite(Number(args.inbound_batch_size))) {
        merged.inboundBatchSize = Math.min(100, Math.max(1, Math.round(Number(args.inbound_batch_size))));
      }
      if (args.scheduled_start_at != null) {
        const raw = String(args.scheduled_start_at).trim();
        merged.scheduledStartAt = raw || undefined;
      }
      if (args.media_url != null) {
        const url = String(args.media_url).trim();
        if (url) {
          merged.mediaUrl = url;
          merged.mediaType =
            args.media_type === "document" || args.media_type === "audio"
              ? (String(args.media_type) as "document" | "audio")
              : "image";
        } else {
          merged.mediaUrl = undefined;
          merged.mediaType = undefined;
        }
      } else if (args.media_type != null && merged.mediaUrl) {
        merged.mediaType =
          args.media_type === "document" || args.media_type === "audio"
            ? (String(args.media_type) as "document" | "audio")
            : "image";
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
        ...(merged.abVariants ?? []).map((v) => ({ label: `ab_variants.${v.id}`, value: v.message })),
      ]);
      if (badFields.length) {
          return JSON.stringify({
          error: `Texte avec crochets interdit (${badFields.join(", ")}). Demande les vraies valeurs et réessaie sans […].`,
        });
      }
      const isOutboundType =
        detail.automation.type === "contact_prospect" ||
        detail.automation.type === "group_prospect" ||
        merged.mode === "outbound_prospect";
      if (
        isOutboundType &&
        merged.initialMessage &&
        !args.keep_opener_as_is &&
        !isValidAttentionOpener(merged.initialMessage)
      ) {
        return JSON.stringify({
          needsUserConfirmation: true,
          warning: formatAttentionOpenerWarning("initial_message", merged.initialMessage),
        });
      }
      if (parseAbVariantsArg(args.ab_variants)) {
        const abErr = validateOutboundAbVariants(merged.abVariants);
        if (abErr) return JSON.stringify({ error: abErr });
        if (!args.keep_opener_as_is) {
          const offFrame = outboundVariantsOutOfFrame(merged.abVariants);
          if (offFrame) {
            return JSON.stringify({
              needsUserConfirmation: true,
              warning: formatAttentionOpenerWarning(
                `ab_variants.${offFrame.id}`,
                offFrame.message
              ),
            });
          }
        }
        merged.personalizeMessages = false;
      } else if (
        isOutboundType &&
        !(merged.abVariants ?? []).filter((v) => v.message?.trim()).length
      ) {
        // Sortant sans aucune variante en config : refuse de laisser un seul initial_message
        return JSON.stringify({
          error:
            "Cette campagne sortante n'a pas encore ses 5 ab_variants. " +
            "Passe ab_variants avec les 5 accroches validées dans le chat " +
            "(pas seulement initial_message).",
        });
      }

      const prevOpener = detail.automation.config.initialMessage?.trim() || "";
      const prevGuide = detail.automation.config.conversationGuide?.trim() || "";
      const nextOpener = merged.initialMessage?.trim() || "";
      const nextGuide = merged.conversationGuide?.trim() || "";

      const updated = await updateAutomationConfig(userId, id, {
        ...merged,
        enableAutoReply: detail.automation.status === "active" ? true : merged.enableAutoReply !== false,
        livePlaybook: merged.livePlaybook
          ? {
              ...merged.livePlaybook,
              updatedAt: new Date().toISOString(),
              openerSnapshot:
                merged.initialMessage || merged.livePlaybook.openerSnapshot,
              guideSnapshot:
                merged.conversationGuide || merged.livePlaybook.guideSnapshot,
            }
          : merged.livePlaybook,
      });

      // Si l'utilisateur a changé la fenêtre d'activité, aligne aussi la mémoire liée
      const windowChanged =
        (args.send_window_start != null && Number.isFinite(Number(args.send_window_start))) ||
        (args.send_window_end != null && Number.isFinite(Number(args.send_window_end))) ||
        (args.quiet_hours_start != null && Number.isFinite(Number(args.quiet_hours_start))) ||
        (args.quiet_hours_end != null && Number.isFinite(Number(args.quiet_hours_end)));
      if (windowChanged && updated?.config.quietHoursStart != null && updated.config.quietHoursEnd != null) {
        const activity = quietHoursToActivityWindow({
          start: updated.config.quietHoursStart,
          end: updated.config.quietHoursEnd,
        });
        try {
          const mem = await getLinkedCampaignMemory(userId, threadId);
          if (mem) {
            const { updateCampaignMemory } = await import("./campaign-memory.js");
            await updateCampaignMemory(userId, mem.id, {
              sendWindowStart: activity.sendWindowStart,
              sendWindowEnd: activity.sendWindowEnd,
            });
          }
        } catch {
          /* best effort */
        }
      }

      try {
        const { syncThreadAutomationFromMemory, patchPlaybookAfterConfigEdit } =
          await import("./campaign-sync.js");
        await syncThreadAutomationFromMemory(userId, threadId);
        await patchPlaybookAfterConfigEdit(userId, id, {
          opener: Boolean(nextOpener && nextOpener !== prevOpener),
          guide: Boolean(nextGuide && nextGuide !== prevGuide),
        });
      } catch {
        /* ignore */
      }
      if (detail.automation.status === "active") {
        await resumeAutomationMessaging(userId, id);
        if (windowChanged) {
          try {
            const { recheckPendingSendQueueAfterWindowChange } = await import("./send-queue.js");
            await recheckPendingSendQueueAfterWindowChange(userId, id);
          } catch {
            /* best effort */
          }
        }
      }
      const plan = await persistVisualPlan(userId, id);
      const quietStart = updated?.config.quietHoursStart;
      const quietEnd = updated?.config.quietHoursEnd;
      const activityWin =
        quietStart != null && quietEnd != null
          ? quietHoursToActivityWindow({ start: quietStart, end: quietEnd })
          : null;
      return JSON.stringify({
        success: true,
        automationId: id,
        configSummary: {
          initialMessage: updated?.config.initialMessage ?? null,
          price: updated?.config.price ?? null,
          productName: updated?.config.productName ?? null,
          closingLink: updated?.config.closingLink ?? null,
          closingGoal: updated?.config.closingGoal ?? null,
          abVariantsCount: updated?.config.abVariants?.length ?? 0,
          guideChars: updated?.config.conversationGuide?.length ?? 0,
          livePlaybookTurns: updated?.config.livePlaybook?.turns?.length ?? 0,
          quietHoursStart: quietStart ?? null,
          quietHoursEnd: quietEnd ?? null,
          sendWindow:
            activityWin != null
              ? `${activityWin.sendWindowStart}h–${activityWin.sendWindowEnd}h`
              : null,
        },
        plan: plan
          ? { title: plan.title, automationId: plan.automationId, type: plan.type }
          : undefined,
        // Pas de planDisplay : évite de re-coller le fence / re-simuler à chaque tweak.
        message:
          `Campagne « ${detail.automation.name} » mise à jour` +
          `${detail.automation.status === "active" ? " (auto-reply maintenu ON)" : ""}.` +
          (activityWin
            ? ` Fenêtre d'activité enregistrée : ${activityWin.sendWindowStart}h–${activityWin.sendWindowEnd}h.`
            : "") +
          ` Confirme UNIQUEMENT ce que configSummary.sendWindow / les champs changés indiquent — ` +
          `INTERDIT de dire « c'est bon » si success n'est pas true. ` +
          `Propose « refais la simulation » pour revoir le fil, ou « c'est bon » si déjà active.`,
      });
    }

    case "delete_automation": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      const bound = await requireThreadAutomationId(userId, threadId, id);
      if (!bound.ok) return JSON.stringify({ error: bound.error });
      const existing = await getAutomation(userId, id);
      const ok = await deleteAutomation(userId, id);
      if (!ok) {
        return JSON.stringify({ error: "Campagne introuvable." });
      }
      return JSON.stringify({
        success: true,
        automationId: id,
        message: `Campagne « ${existing?.name ?? "Automatisation"} » supprimée.`,
      });
    }

    case "list_prospected_contacts": {
      const requested =
        args.automation_id != null && Number.isFinite(Number(args.automation_id))
          ? Number(args.automation_id)
          : undefined;
      const bound = await requireThreadAutomationId(userId, threadId, requested);
      if (!bound.ok) return JSON.stringify({ error: bound.error });
      const limit = args.limit != null ? Number(args.limit) : 200;
      const contacts = await listProspectedContacts(userId, {
        automationId: bound.automationId,
        limit,
      });
      const mapped = contacts.map((c) => ({
        campaignId: c.automationId,
        campaignName: c.automationName,
        phone: c.targetId,
        display: chatIdToDisplay(c.targetId),
        name: c.targetLabel,
        status: c.status,
        lastActionAt: c.lastActionAt,
      }));
      return JSON.stringify({
        count: mapped.length,
        contacts: mapped,
        display: formatVerticalContactList(
          mapped.map((c) => ({ name: c.name, phone: c.phone, display: c.display })),
          "prospects contactés"
        ),
      });
    }

    case "list_automations": {
      const thread = await getAgentThread(userId, threadId);
      if (!thread?.automation_id) {
      return JSON.stringify({
          count: 0,
          automations: [],
          message: "Aucune campagne liée à ce fil. (Les autres automatisations ne sont pas visibles ici.)",
        });
      }
      const a = await getAutomation(userId, thread.automation_id);
      if (!a) {
        return JSON.stringify({ count: 0, automations: [] });
      }
      return JSON.stringify({
        count: 1,
        automations: [
          {
          id: a.id,
          name: a.name,
          type: a.type,
          status: a.status,
          summary: a.summary,
          stats: a.stats,
          budgetFcfa: a.budget_fcfa,
          createdAt: a.created_at,
          },
        ],
        message: "Seul le plan de ce fil est listé (isolation des automatisations).",
      });
    }

    case "get_automation_report": {
      const id = Number(args.automation_id);
      if (!Number.isFinite(id)) {
        return JSON.stringify({ error: "automation_id invalide." });
      }
      const bound = await requireThreadAutomationId(userId, threadId, id);
      if (!bound.ok) return JSON.stringify({ error: bound.error });
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
        configSummary: {
          initialMessage: automation.config.initialMessage ?? null,
          price: automation.config.price ?? null,
          productName: automation.config.productName ?? null,
          closingLink: automation.config.closingLink ?? null,
          closingGoal: automation.config.closingGoal ?? null,
          triggerPhrases: automation.config.triggerPhrases ?? automation.config.keywords ?? null,
          inboundCatchAll: automation.config.inboundCatchAll ?? false,
          abVariantsCount: automation.config.abVariants?.length ?? 0,
          guideChars: automation.config.conversationGuide?.length ?? 0,
          stickersEnabled: automation.config.stickersEnabled ?? false,
          quietHoursStart: automation.config.quietHoursStart ?? null,
          quietHoursEnd: automation.config.quietHoursEnd ?? null,
        },
        stats: automation.stats,
        budgetFcfa: automation.budget_fcfa,
        targetsTotal: targets.length,
        targetsPending: targets.filter((t) => t.status === "pending").length,
        targetsContacted: targets.filter((t) => t.status === "contacted").length,
        targetsReplied: targets.filter((t) => t.status === "replied").length,
        recentLogs: logs.slice(0, 8).map((l) => ({
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
      const bound = await requireThreadAutomationId(userId, threadId, id);
      if (!bound.ok) return JSON.stringify({ error: bound.error });
      let updated;
      if (status === "paused") {
        updated = await pauseAutomation(userId, id);
      } else if (status === "active") {
        // Via le core d'activation (gère aussi failed / bootstrap), pas un simple flip de statut
        const { activateAutomationCore } = await import("./activate-automation.js");
        const result = await activateAutomationCore(userId, id, { source: "agent" });
        if (!result.ok) {
          return JSON.stringify({ error: result.error, automationId: result.automationId ?? id });
        }
        updated = await getAutomation(userId, id);
      } else {
        // completed = coupe aussi auto-reply + file
        await haltAutomationMessaging(userId, id);
        const cur = await getAutomationDetail(userId, id);
        if (cur) {
          await updateAutomationConfig(userId, id, {
            ...cur.automation.config,
            enableAutoReply: false,
          });
        }
        updated = await updateAutomationStatus(userId, id, status);
      }
      if (!updated) {
        return JSON.stringify({ error: `Automatisation #${id} introuvable.` });
      }
      return JSON.stringify({
        success: true,
        automationId: id,
        status: updated.status,
        autoReply: updated.status === "active",
        message:
          status === "paused"
            ? `Campagne « ${updated.name} » désactivée — auto-reply OFF, plus aucun message automatique.`
            : status === "active"
              ? `Campagne « ${updated.name} » réactivée — auto-reply ON.`
              : `Campagne « ${updated.name} » terminée — auto-reply OFF.`,
      });
    }

    case "show_automation_plan": {
      const requested =
        args.automation_id != null && Number.isFinite(Number(args.automation_id))
          ? Number(args.automation_id)
          : undefined;
      const bound = await requireThreadAutomationId(userId, threadId, requested);
      if (!bound.ok) return JSON.stringify({ error: bound.error });
      const plan = await persistVisualPlan(userId, bound.automationId);
      if (!plan) {
        return JSON.stringify({ error: "Impossible de générer le plan." });
      }
      const intro = args.intro ? String(args.intro) : undefined;
      return JSON.stringify({
        success: true,
        automationId: bound.automationId,
        plan,
        display: formatPlanDisplay(plan, intro),
      });
    }

    case "show_campaign_simulation": {
      const rawTurns = Array.isArray(args.turns) ? args.turns : [];
      if (rawTurns.length < 6 || rawTurns.length > 7) {
        return JSON.stringify({
          error: "La simulation doit contenir exactement 6 ou 7 messages (turns).",
        });
      }
      const turns: SimulationTurn[] = [];
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
          turns.push({ speaker: "toi", text });
        } else if (speaker === "prospect") {
          turns.push({
            speaker: "prospect",
            name: String(turn.name ?? "Prospect").trim() || "Prospect",
            text,
          });
        } else {
          return JSON.stringify({ error: "speaker doit être « toi » ou « prospect »." });
        }
      }
      let display: string;
      try {
        display = formatCampaignSimulationDisplay(turns);
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Figé / sync : playbook → réponses WhatsApp prospects
      try {
        const { persistLivePlaybookForThread } = await import("./campaign-sync.js");
        await persistLivePlaybookForThread(userId, threadId, turns);
      } catch (err) {
        console.warn("[sim] persist playbook:", err);
      }
      return JSON.stringify({
        success: true,
        turns: turns.length,
        message:
          "Simulation prête (téléphone). Playbook synchronisé avec la campagne / réponses prospects. " +
          "Confirme en 1–2 phrases — le fil est sur le téléphone, ne le recolle pas dans le chat.",
        // display réservé à l'early-return agent (UI) — omis ici pour ne pas le réinjecter en boucle LLM
        display:
          "```klanvio-sim\n[Simulation compactée — affichée sur le téléphone.]\n```",
        _uiDisplay: display,
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
