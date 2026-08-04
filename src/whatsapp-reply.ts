import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings, getContactChatHistory } from "./db.js";
import { chatIdToDisplay } from "./evolutionapi.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, extractAssistantContent, recommendedMaxTokens, mistralChatExtras } from "./llm.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";
import {
  isAffirmingPendingSendOffer,
  ensurePendingLinkInReply,
} from "./lead-scoring.js";
import { shouldSilenceAfterFarewell } from "./stop-policy.js";

export const WHATSAPP_REPLY_PROMPT = `Tu es un commercial WhatsApp expérimenté (Afrique francophone) qui répond comme un **vrai humain** — jamais comme un bot.

## Raisonnement (prioritaire — c'est comme ça que tu gères l'inattendu)
À CHAQUE message, dans cet ordre :
1. Relis ton **dernier message sortant** + ce que le prospect vient de répondre.
2. Déduis son intention (accord, refus, confusion, question, objection, hors-sujet, info utile…).
3. Réponds à **CETTE** intention, en restant sur la mission campagne — pas de script générique, pas de question inventée hors fil.
4. Si c'est inattendu : clarifie ou recadre en 1 phrase humaine. **JAMAIS** de reset (te re-présenter, cold opener, « je suis allé trop vite + je suis X », changer de sujet).
5. Si tu as **proposé** quelque chose (lien, détail, envoi) et qu'il dit oui / ok / d'accord → **exécute** (envoie le lien / l'info), ne clôture pas.

Tu dois pouvoir t'en sortir seul face à des réponses imprévues. Les exemples ci-dessous sont des **intentions**, pas des phrases à recopier.

## Ta mission
Poursuivre la conversation selon l'OBJECTIF DE LA CAMPAGNE jusqu'à la conversion (ou un refus clair), en suivant A.I.D.A. :
- Après une accroche (Attention) : Interest → Desire → Action progressivement.
- N'envoie PAS tout (prix + lien + pitch) d'un coup sauf si le prospect le demande clairement.
- **Même mission d'un bout à l'autre** : seuls les mots varient.
- **Pas fade** : personnalité légère OK. Interdit le style fiche LinkedIn / checklist.

## Exception — « un seul message »
Si le prospect demande **juste** le lien / le prix / un seul message :
→ Envoie UNIQUEMENT l'info demandée. Pas de question ni de relance.

## Règles d'or
1. **HISTORIQUE d'abord** : tout ce qui a déjà été dit compte. Ne répète pas une question déjà posée.
2. **DIRECT** : réponds à CE qu'il vient de dire, dans le cadre campagne.
3. **COURT** : 1-2 phrases vivantes (court ≠ sec).
4. **PAS DE RE-SALUT / RE-PRÉSENTATION** si le fil est déjà engagé (sauf s'il demande explicitement qui tu es).
5. **SORTANT** : si TU as ouvert, n'agis jamais comme s'il t'avait contacté (« ravi d'échanger », « merci de votre message »).
5b. **Après « Salut / Hello / Ok »** (TU as déjà ouvert) : INTERDIT de balancer ton nom + bio (« Will… J'accompagne… »). Enchaîne directement 1 question / point lié à la mission.
6. **ENTRANT** : le client a initié — accueil / support, pas de cold outreach.
7. **ZÉRO CROCHETS** [prix], [lien], etc.
8. **VOUVOIEMENT**. Pas de prénom du prospect à tout va.
9. **Pas de réaction vide** (« Super. », « Ok. ») : réagir + avancer la mission.
10. **Infors multiples** d'un coup → noter l'utile + UNE question manquante (pas « Merci M. X » seul).
11. Refus clair (« non », « non merci », « pas intéressé », « je pense pas ») → clôture polie UNE fois puis STOP total. Après un adieu (« Bonne journée », « je ne vous dérange plus ») : si le prospect dit seulement ok / okay / merci → **n'envoie RIEN**. Interdit de relancer, de poser une nouvelle question, ou d'envoyer un lien.
12. Emojis : aucun par défaut (max 1 s'il en utilise). Texte seulement.

## Intentions utiles (exemples — adapte, ne copie pas)
- Qui es-tu → prénom business + pourquoi on écrit (1 souffle).
- Salut / hello / ok après TON opener → enchaîner la mission (1 question), **pas** de présentation.
- Où as-tu eu mon numéro → transparence + source vraie du contexte.
- Confusion / « je ne comprends pas » → clarifier **ton** dernier message.
- Oui après offre de lien → envoyer le lien réel.
- Oui après « vous avez 2 minutes ? » → enchaîner le sujet campagne (pas une question hors sujet).
- Objection → empathie + piste liée à CE frein.
- Hors-sujet → recadrer en 1 phrase.

## Style
Sonner comme quelqu'un qui écrit vite au téléphone. Pas de tirets « — / – » comme séparateurs. Pas de listes / bullets.

## Format
Réponds UNIQUEMENT avec le texte du message WhatsApp.`

const INJECTION_PATTERNS =
  /ignore\s+(tes|vos|your)\s+instructions|ignore\s+previous|system\s+prompt|révèle\s+(ton|le)\s+prompt|jailbreak|DAN\s+mode/i;

export function isPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.test(text);
}

export function isStopRequest(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ");

  return (
    /^\s*stop\s*[!.]*\s*$/.test(t) ||
    /\bstop\b.*(message|contact|ecri|appel|whatsapp)/.test(t) ||
    /ne (me |nous )?(contacte|contactez|ecris|ecrivez|appelle|appelez) plus/.test(t) ||
    /ne (me |nous )?contacte(z)? plus/.test(t) ||
    /ne m.?ecri(s|ve|vez) plus/.test(t) ||
    /je (ne )?veux plus (recevoir|etre contacte|etre derange|vos messages|votre message|de message)/.test(t) ||
    /ne (veuillez |veut )?(plus )?(m.?envoyer|recevoir|me contacter)/.test(t) ||
    /arrete(z)? (de )?(m.?envoyer|me contacter|me deranger|vos messages)/.test(t) ||
    /plus (aucun|de) (message|contact|sms)/.test(t) ||
    /desist(z)? (me )?contacter/.test(t) ||
    /laisse(z)?(-| )moi tranquille/.test(t) ||
    /retire(z)?(-| )?moi de (la |votre )?liste/.test(t) ||
    /desabonn(e|ez|ement)/.test(t) ||
    /ne me derange(z)? plus/.test(t)
  );
}

async function getOpenAiClient(userId: number): Promise<OpenAI> {
  const key = (await getAppSettings(userId)).openai_api_key;
  if (!key) throw new Error(`Clé ${llmProviderLabel()} manquante.`);
  return createLlmClient(key);
}

async function formatHistory(
  userId: number,
  chatId: string,
  senderName: string,
  excludeIncoming?: string,
  automationId?: number | null
): Promise<{ text: string; messageCount: number; isOngoingConversation: boolean }> {
  const history = await getContactChatHistory(userId, chatId, 30, automationId);

  let filtered = history;
  if (excludeIncoming && history.length > 0) {
    const last = history[history.length - 1];
    if (last.direction === "entrant" && last.body.trim() === excludeIncoming.trim()) {
      filtered = history.slice(0, -1);
    }
  }

  if (!filtered.length) {
    return { text: "Premier échange avec ce contact.", messageCount: 0, isOngoingConversation: false };
  }

  const incomingCount = filtered.filter((m) => m.direction === "entrant").length;
  const outboundCount = filtered.filter((m) => m.direction === "sortant").length;
  // Tout sortant déjà envoyé sur ce fil campagne = conversation engagée (pas de cold opener).
  const isOngoingConversation =
    incomingCount >= 1 || outboundCount >= 1 || filtered.length >= 2;

  const text = filtered
    .map((m) => {
      const who = m.direction === "entrant" ? senderName : "Moi (entrepreneur)";
      const time = m.created_at?.slice(11, 16) ?? "";
      return time ? `[${time}] ${who}: ${m.body}` : `${who}: ${m.body}`;
    })
    .join("\n");

  return { text, messageCount: filtered.length, isOngoingConversation };
}

/** Délai avant réponse auto (historique) — préférer getHumanReadDelayMs. */
export async function getAdaptiveReplyDelay(userId: number, chatId: string): Promise<number> {
  return getHumanReadDelayMs(userId, chatId);
}

/**
 * Délai « lecture » humain si le créneau anti-spam est libre.
 * Ongoing : 8–20 s · premier contact : 12–25 s.
 */
export async function getHumanReadDelayMs(userId: number, chatId: string): Promise<number> {
  const { isOngoingConversation } = await formatHistory(userId, chatId, "", undefined);
  if (isOngoingConversation) {
    return 8_000 + Math.floor(Math.random() * 12_000);
  }
  return 12_000 + Math.floor(Math.random() * 13_000);
}

/** Le client dump plusieurs infos utiles d'un coup (nom + lieu + horaire…). */
export function isInfoDenseProspectMessage(text: string): boolean {
  const t = text.trim();
  if (t.length < 35) return false;
  const clauses = t.split(/[.!?;\n]+/).map((s) => s.trim()).filter((s) => s.length > 6);
  const factSignals = [
    /\b(je m'?appelle|nom|m\.|mr\.?|mme)\b/i.test(t) ||
      /\b[A-ZÀ-Ÿ]{2,}(?:\s+[A-ZÀ-Ÿa-zà-ÿ'-]+){1,3}\b/.test(t),
    /\b(porto|cotonou|abomey|parakou|calo|ville|quartier|adresse|livr[ei]|chez moi|à domicile)\b/i.test(
      t
    ),
    /\b(\d{1,2}\s*h(?:\d{0,2})?|\d{1,2}:\d{2}|dispo|disponible|cr[eé]neau|apr[eè]s|avant)\b/i.test(
      t
    ),
    /\b(\+?\d[\d\s.-]{7,}\d)\b/.test(t),
    /\b(pointure|taille|couleur|mod[eè]le|paire)\b/i.test(t),
  ].filter(Boolean).length;
  return clauses.length >= 2 || factSignals >= 2;
}

/** Réponse qui ne fait que remercier / noter un nom — mission non avancée. */
function isBareThankYouOrNameAck(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 60) return false;
  if (/\?/.test(t)) return false;
  return (
    /^(merci|parfait|not[ée]|bien not[ée]|compris|d'?accord|ok|okay)([,.]?\s+(m\.|mr\.?|mme\.?|monsieur|madame))?\s*[\wÀ-ÿ'-]+[.!]?\s*$/i.test(
      t
    ) ||
    /^(merci|parfait|not[ée]|bien not[ée]|compris)[.!]?\s*$/i.test(t)
  );
}

/** « C'est qui ? » / qui êtes-vous — ne pas couper au prénom seul. */
function isIdentityQuestion(text: string): boolean {
  return /qui (etes|êtes)-vous|c'?est qui|votre nom|ton nom|vous [êe]tes qui/i.test(
    text.trim()
  );
}

/**
 * Nettoyage léger seulement — ne REMPLACE PAS la réponse du modèle par des templates.
 * L'IA doit raisonner ; on évite juste les artefacts évidents (tirets, cold opener mid-fil, coupe mot).
 */
function enforceWhatsAppStyle(
  raw: string,
  opts: { isOngoing: boolean; incomingText: string }
): string {
  let text = raw.trim();
  text = text.replace(/^["'«「]|["'»」]$/g, "");
  text = text.replace(/^```\w*\n?|\n?```$/g, "");
  text = text.replace(/^(voici (ma )?réponse|message|réponse)\s*:\s*/i, "");
  text = text.replace(/^\*\*.*?\*\*\s*:?\s*/s, "");

  text = text.replace(/\bcomme mentionn[ée] plus t[oô]t\b[,.]?\s*/gi, "");
  text = text.replace(/\bn'?h[ée]site(z)? pas [àa] me (le )?faire savoir\b[!.]?\s*/gi, "");
  text = text.replace(/\bje suis l[àa] pour [çc]a\b[!.]?\s*/gi, "");

  // Tirets « — / – / - » utilisés comme pause
  text = text.replace(/\s+[—–]\s+/g, ". ");
  text = text.replace(/\s+-\s+(?=[A-Za-zÀ-ÿ])/g, ". ");
  text = text.replace(/\.\s+([a-zà-ÿ])/g, (_, c: string) => `. ${c.toUpperCase()}`);
  text = text.replace(/\.\s*\./g, ".");
  text = text.replace(/\s{2,}/g, " ").trim();

  if (opts.isOngoing) {
    text = text.replace(
      /^(bonjour|salut|bonsoir|hello|coucou)\s+[\wÀ-ÿ-]+[,.!]?\s*/i,
      ""
    );
    text = text.replace(/^(bonjour|salut|bonsoir|hello|coucou)[,.!]?\s*/i, "");
    // Cold opener recollé mid-fil → retire le pattern, laisse le reste si présent
    if (
      /^(bonjour|salut|bonsoir).{0,40}(minute|instant|secondes?).{0,20}(accorder|consacrer|prendre)/i.test(
        text
      ) ||
      /^(bonjour|salut).{0,30}(allez-vous bien|comment allez-vous).{0,40}\?/i.test(text)
    ) {
      text = text
        .replace(
          /^(bonjour|salut|bonsoir).{0,80}?\?\s*/i,
          ""
        )
        .trim();
    }
    // Re-présentation type « je suis allé trop vite, je suis Alex… » → retire l'intro inutile
    text = text
      .replace(/pardon[,.]?\s*je suis all[eé] trop vite[.!]?\s*/gi, "")
      .replace(
        /je suis \w+[,.]?\s*(growth\s*)?marketer.{0,100}?(?:\.|!)\s*/gi,
        ""
      )
      .replace(/je (me )?pr[eé]sente\b[^.]{0,80}\.\s*/gi, "")
      .trim();
  }

  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const identityQ = isIdentityQuestion(opts.incomingText);
  const isComplexQuestion =
    identityQ ||
    opts.incomingText.length > 80 ||
    (opts.incomingText.match(/\?/g)?.length ?? 0) > 1;
  if (sentences.length > 3 && !isComplexQuestion) {
    text = sentences.slice(0, 2).join(" ");
  }

  const isShortIncoming = opts.incomingText.trim().length <= 40;
  if (isShortIncoming && text.length > 120 && !identityQ) {
    const kept = sentences.slice(0, 2).join(" ").trim();
    if (kept.length > 0 && kept.length <= 280) {
      text = kept;
    } else {
      const hard = text.slice(0, 220);
      const lastSpace = hard.lastIndexOf(" ");
      text = (lastSpace > 80 ? hard.slice(0, lastSpace) : hard).trim();
      if (!/[.!?…]$/.test(text)) {
        const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
        if (parts.length >= 2) text = parts.slice(0, -1).join(" ").trim();
      }
    }
  } else if (identityQ && sentences.length > 2) {
    text = sentences.slice(0, 2).join(" ");
  }

  // Filet étroit : dump d'infos + réponse « Merci M. X » seule → une phrase utile neutre
  if (isInfoDenseProspectMessage(opts.incomingText) && isBareThankYouOrNameAck(text)) {
    text =
      "Je note bien ces éléments. Pour finaliser, que me manque-t-il encore de votre côté ?";
  }

  return sanitizeOutboundWhatsAppText(text.replace(/\s{2,}/g, " ").trim());
}

function nowFr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

async function businessContextBlock(userId: number): Promise<string> {
  const s = await getAppSettings(userId);
  const price = s.business_price?.trim();
  const lines = [
    `Prénom / nom à utiliser : ${s.business_owner_name || "(non configuré — ne pas inventer, ne pas mettre de crochets)"}`,
    `Offre / formation : ${s.business_offer || "(non configuré — ne pas inventer)"}`,
    price
      ? `Tarif (FCFA) : ${price}`
      : `Tarif (FCFA) : NON COMMUNIQUÉ — si on te demande le prix, dis que tu confirmes juste après. INTERDIT d'écrire [prix] ou tout autre crochet.`,
  ];
  return lines.join("\n");
}

export async function generateWhatsAppReply(userId: number, input: {
  chatId: string;
  senderName: string;
  incomingText: string;
  automationContext?: string;
  /** false = aucun emoji (refus stickers/emojis). Défaut : max 1. */
  allowEmojis?: boolean;
  /** Isole l'historique à cette automatisation. */
  automationId?: number | null;
  /** Force « conversation déjà engagée » (ex. simulation téléphone). */
  forceOngoing?: boolean;
  /** Sortant (prospection) vs entrant (support / closing). */
  conversationMode?: "outbound" | "inbound";
  /** Lien campagne à livrer si le prospect dit oui à une offre d'envoi. */
  closingLink?: string | null;
  /**
   * Force le mode « oui → envoyer le lien » (ex. simulation où l'historique
   * n'est pas encore en base).
   */
  forceDeliverPendingLink?: boolean;
}): Promise<string> {
  const client = await getOpenAiClient(userId);
  const display = chatIdToDisplay(input.chatId);
  const { text: historyText, messageCount, isOngoingConversation } = await formatHistory(
    userId,
    input.chatId,
    input.senderName,
    input.incomingText,
    input.automationId
  );

  const policyHistory = await getContactChatHistory(
    userId,
    input.chatId,
    20,
    input.automationId
  );

  // Filet anti-relance : adieu déjà envoyé + ack court → silence (pas de LLM / pas de lien).
  if (shouldSilenceAfterFarewell(input.incomingText, policyHistory)) {
    return "";
  }

  const affirmingPendingSend =
    input.forceDeliverPendingLink === true ||
    isAffirmingPendingSendOffer(input.incomingText, policyHistory);

  const inbound = input.conversationMode === "inbound";
  const ongoing = input.forceOngoing === true || isOngoingConversation || inbound;
  const lastOut = [...policyHistory].reverse().find((m) => m.direction === "sortant");
  const lastOutSnippet = lastOut?.body?.trim().slice(0, 180) || "";
  const shortAck =
    input.incomingText.trim().length <= 24 &&
    /^(salut|hello|bonjour|bonsoir|hey|hi|coucou|ok|okay|d'accord|dac|bsr|oui)[!?.…]*$/i.test(
      input.incomingText.trim()
    );

  // Filets critiques seulement — le reste = raisonnement IA.
  // Jamais forcer « 1 question mission » ni un lien après un adieu (déjà filtré plus haut).
  const hardOverride = affirmingPendingSend
    ? `\n## ACTION REQUISE\n` +
      `Tu as proposé d'envoyer le lien. Le prospect dit « ${input.incomingText.trim()} ». ` +
      `Inclus MAINTENANT l'URL campagne du contexte. Pas de clôture sans lien.\n`
    : !inbound && ongoing && shortAck
      ? `\n## ACTION REQUISE\n` +
        `TU as déjà ouvert. Il répond juste « ${input.incomingText.trim()} ». ` +
        `INTERDIT : te présenter (nom + bio / « j'accompagne… »). Enchaîne 1 question liée à la mission.\n`
      : inbound
        ? `\n## Mode ENTRANT\nLe client a initié — support/closing, pas de cold outreach.\n`
        : "";

  const userContent = `## Identité & offre (ne jamais inventer hors de ça)
${await businessContextBlock(userId)}
${input.automationContext ? `\n## CAMPAGNE — OBJECTIF & CONSIGNES\n${input.automationContext}\n` : "\n⚠️ Pas de campagne active — réponse courte et générale.\n"}
${hardOverride}
## Contact
${input.senderName} (${display})
Messages échangés : ${Math.max(messageCount, input.forceOngoing || inbound ? 2 : 0)}
Conversation engagée : ${ongoing ? (inbound ? "OUI (entrant)" : "OUI — ne resalue pas, ne te re-présente pas") : "non — salutation courte OK"}
Mode : ${inbound ? "ENTRANT" : "SORTANT"}
${lastOutSnippet ? `Ton dernier message : « ${lastOutSnippet}${lastOut && lastOut.body.length > 180 ? "…" : ""} »\n` : ""}
## Historique
${historyText || "(historique fourni dans le bloc campagne / simulation ci-dessus)"}

--- NOUVEAU MESSAGE ---
${input.senderName}: ${input.incomingText}

Raisonne : que signifie sa réponse par rapport à TON dernier message ? Réponds en 1-2 phrases WhatsApp, mission campagne. Inattendu → clarifie/recadre, jamais de reset.${
    affirmingPendingSend ? " Inclus l'URL campagne." : ""
  }${
    !inbound && ongoing && shortAck && !affirmingPendingSend
      ? " Pas de présentation / bio."
      : ""
  }`;

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: WHATSAPP_REPLY_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 220, {
        thinkingEnabled: false,
      }),
      temperature: 0.65,
      presence_penalty: 0.45,
      frequency_penalty: 0.45,
      ...mistralChatExtras({ enableThinking: false }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  );

  const choice = response?.choices[0];
  let reply = extractAssistantContent(choice?.message);
  if (!reply) {
    throw new Error(`${llmProviderLabel()} n'a pas généré de réponse.`);
  }
  if (choice?.finish_reason === "length" && !/[.!?…]$/.test(reply.trim())) {
    const trimmed = reply.trim();
    const lastSpace = trimmed.lastIndexOf(" ");
    if (lastSpace > 40) reply = trimmed.slice(0, lastSpace).trim();
  }

  let styled = enforceWhatsAppStyle(reply, {
    isOngoing: ongoing,
    incomingText: input.incomingText,
  });
  if (input.allowEmojis === true) {
    const { limitEmojis } = await import("./sticker-consent.js");
    styled = limitEmojis(styled, 1);
  } else {
    const { stripEmojis } = await import("./sticker-consent.js");
    styled = stripEmojis(styled);
  }
  styled = ensurePendingLinkInReply(
    styled,
    input.closingLink,
    input.incomingText,
    input.forceDeliverPendingLink
      ? [
          ...policyHistory,
          {
            direction: "sortant",
            body: "Je vous envoie le lien tout de suite ?",
          },
        ]
      : policyHistory
  );
  return styled;
}

export function getStopConfirmationReply(): string {
  return "C'est noté, je ne vous dérange plus. Bonne continuation ! 🙂";
}

export { nowFr };
