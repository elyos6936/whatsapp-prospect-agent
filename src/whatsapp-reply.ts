import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings, getContactChatHistory, saveAgentMessageForAutomation } from "./db.js";
import { chatIdToDisplay } from "./evolutionapi.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, extractAssistantContent, recommendedMaxTokens, llmChatExtras } from "./llm.js";
import { sanitizeOutboundWhatsAppText, ensureLeadingCapital, sanitizeInventedCampaignUrls } from "./outbound-sanitize.js";
import {
  sanitizeProspectFacingReply,
  safeFallbackWhatsAppReply,
  looksLikeInternalMonologue,
} from "./prospect-facing-sanitize.js";
import {
  isAffirmingPendingSendOffer,
  ensurePendingLinkInReply,
} from "./lead-scoring.js";
import { shouldSilenceAfterFarewell, isOutboundDiagnosticAsk } from "./stop-policy.js";
import { resolveReplyTone, toneInstruction, toneLabel } from "./reply-tone.js";
import { applyWhatsAppReplyGuard } from "./whatsapp-reply-guard.js";

export const WHATSAPP_REPLY_PROMPT = `Tu es un commercial WhatsApp expérimenté (Afrique francophone) qui répond comme un **vrai humain** — jamais comme un bot.

## SORTIE OBLIGATOIRE (CRITIQUE)
- Tu réfléchis EN SILENCE. N'écris JAMAIS ton analyse, ton plan, ni des phrases du type « Il vient de… », « Je reste transparent… », « puis je relance… ».
- Ta réponse = UNIQUEMENT le texte WhatsApp adressé au contact.
- TON = celui imposé par la consigne « TON DU FIL » (tutoiement ou vouvoiement) — jamais l'autre.
- Commence TOUJOURS par une majuscule.
- INTERDIT : notes internes, coaching, stratégie, « mission », « recadrer », parler du contact à la 3ᵉ personne.

## Comment traiter le message (silencieusement)
1. Relis ton dernier message sortant + sa réponse + l'historique utile.
2. Déduis son intention réelle dans CE fil (pas un script figé).
3. Réponds à CETTE intention, aligné sur l'objectif campagne — raisonnements humains, pas de checklist.
4. Inattendu → clarifie/recadre en 1 phrase. JAMAIS de reset (re-présentation, cold opener).
5. Si tu as proposé quelque chose et qu'il dit oui → exécute (lien / détail), ne clôture pas.
6. Les garde-fous serveur (refus / STOP / lien manquant) sont des filets étroits — le reste, c'est toi qui juges.

## Ta mission
Poursuivre selon l'OBJECTIF DE LA CAMPAGNE jusqu'à conversion ou refus clair.
- Mode SORTANT : logique A.I.D.A. (tu as initié).
- Mode ENTRANT : support / closing — le client a initié (voir addendum ENTRANT si présent).
- Pas tout envoyer d'un coup (prix + lien + pitch) sauf demande claire.
- Personnalité légère OK. Interdit style fiche LinkedIn.

## Exception — « un seul message »
Si le contact demande juste le lien / le prix / un seul message → uniquement l'info demandée.

## Règles d'or
1. HISTORIQUE d'abord — ne répète jamais une question déjà posée.
2. DIRECT — réponds à CE qu'il vient de dire.
3. COURT — 1-2 phrases vivantes.
4. PAS DE RE-SALUT / RE-PRÉSENTATION si le fil est engagé.
5. SORTANT : tu as ouvert — pas « merci de votre message ».
5b. Messages courts (ok/oui) : lis TON dernier message ; exécute ou avance — pas de bio.
6. ENTRANT : support, pas cold outreach — intérêt → offre concrète (prix/lien), PAS « quel type de tâche / secteur ».
7. ZÉRO CROCHETS [prix], [lien].
8. TON = celui imposé par « TON DU FIL ». Pas de prénom du contact à tout va.
9. Pas de réaction vide (« Super. ») : réagir + avancer.
10. Infos multiples → noter + UNE question manquante.
11. Refus intérêt → clôture polie. « Non » à une question de qualification → continue.
    Après adieu + ok/merci → n'envoie RIEN (géré côté serveur).
12. Emojis : aucun par défaut.

## Intentions (adapte, ne copie pas)
- Qui es-tu → prénom + pourquoi on écrit (sortant) / qui tu représentes (entrant).
- Où as-tu eu mon numéro → transparence + source vraie du contexte (phrase au contact, pas une note).
- Oui après offre de lien → envoyer le lien.
- Objection → empathie + piste liée au frein.

## Format
Réponds UNIQUEMENT avec le message WhatsApp. Aucune phrase avant ou après.
Commence par une majuscule.`

/** Injecté en system quand conversationMode=inbound — prioritaire sur AIDA sortant. */
export const SUPPORT_INBOUND_REPLY_ADDENDUM = `## MODE ENTRANT / SUPPORT (PRIORITAIRE)
- Le CLIENT a écrit en premier. Tu gères le compte / la boutique.
- Commence par une majuscule. Phrases propres.
- Si intérêt (« je suis intéressé », fautes OK) : remercie brièvement + présente prix / produit / next step en 1-2 phrases.
- Objectif livraison : après pointure/quantité, demande le LIEU DE LIVRAISON (quartier / ville). Ne saute pas cette étape.
- INTERDIT ABSOLU d'inventer une URL (example.com, faux lien commande). Envoie un lien SEULEMENT s'il est fourni dans la campagne.
- INTERDIT : « quel type de tâche », « secteur d'activité », discovery B2B, cold outreach, A.I.D.A. opener.
- Une seule question utile max — jamais une enquête.`;

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

  const cleaned = sanitizeProspectFacingReply(text.replace(/\s{2,}/g, " ").trim());
  if (!cleaned) return "";
  return ensureLeadingCapital(sanitizeOutboundWhatsAppText(cleaned));
}

function nowFr(): string {
  return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

async function businessContextBlock(
  userId: number,
  priceOverride?: string | null
): Promise<string> {
  const s = await getAppSettings(userId);
  const price = String(priceOverride ?? "").trim() || s.business_price?.trim();
  const lines = [
    `Prénom / nom à utiliser : ${s.business_owner_name || "(non configuré — ne pas inventer, ne pas mettre de crochets)"}`,
    `Offre / formation : ${s.business_offer || "(non configuré — ne pas inventer)"}`,
    price
      ? `Tarif (FCFA) : ${price}`
      : `Tarif (FCFA) : NON COMMUNIQUÉ — si on te demande le prix, dis que tu confirmes juste après. INTERDIT d'écrire [prix] ou tout autre crochet.`,
  ];
  return lines.join("\n");
}

function automationContextHasCampaignMemory(automationContext?: string | null): boolean {
  return /=== MÉMOIRE CAMPAGNE/i.test(automationContext?.trim() ?? "");
}

function automationContextHasActiveCampaign(automationContext?: string | null): boolean {
  return /=== CAMPAGNE ACTIVE/i.test(automationContext?.trim() ?? "");
}

/** Profil Réglages ≠ mémoire campagne : ne l'injecte pas quand une campagne/mémoire est active. */
async function buildWhatsAppSourceBlock(
  userId: number,
  automationContext?: string,
  priceOverride?: string | null
): Promise<string> {
  if (automationContextHasCampaignMemory(automationContext)) {
    return [
      "Source UNIQUE = bloc MÉMOIRE CAMPAGNE + consignes CAMPAGNE ci-dessous.",
      "INTERDIT d'utiliser le profil business (Réglages / onboarding) — il peut être obsolète ou différent.",
      "INTERDIT d'inventer nom, offre, prix ou lien absents de la mémoire / campagne.",
    ].join("\n");
  }
  if (automationContextHasActiveCampaign(automationContext)) {
    return [
      "Source = consignes CAMPAGNE ci-dessous uniquement (pas le profil Réglages).",
      "INTERDIT d'inventer hors campagne.",
    ].join("\n");
  }
  return businessContextBlock(userId, priceOverride);
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
  /** Objectif campagne (delivery → lieu ; link → URL réelle seulement). */
  closingGoal?: string | null;
  /**
   * Force le mode « oui → envoyer le lien » (ex. simulation où l'historique
   * n'est pas encore en base).
   */
  forceDeliverPendingLink?: boolean;
  /** Textes campagne / mémoire pour déduire le ton et whitelister les liens. */
  toneSources?: Array<string | null | undefined>;
  knownLinkSources?: Array<string | null | undefined>;
  /** Formalité mémoire (tu/vous) — prime sur l'accroche si aucun message déjà envoyé. */
  memoryFormality?: "tu" | "vous" | null;
  /** Tarif campagne (prioritaire sur le profil) — source unique pour le filet D. */
  configuredPrice?: string | null;
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
  const settings = await getAppSettings(userId);
  const configuredPrice =
    String(input.configuredPrice ?? "").trim() ||
    settings.business_price?.trim() ||
    "";

  const sentMessages = policyHistory
    .filter((m) => m.direction === "sortant")
    .map((m) => m.body);
  const tone = resolveReplyTone({
    sentMessages,
    memoryFormality: input.memoryFormality,
    campaignTexts: [
      ...(input.toneSources ?? []),
      input.automationContext,
    ],
  });
  const toneSystem = toneInstruction(tone);

  // Filet anti-relance : adieu déjà envoyé + ack court → silence (pas de LLM / pas de lien).
  if (shouldSilenceAfterFarewell(input.incomingText, policyHistory)) {
    return "";
  }

  const affirmingPendingSend =
    Boolean(input.closingLink?.trim()) &&
    (input.forceDeliverPendingLink === true ||
      isAffirmingPendingSendOffer(input.incomingText, policyHistory));

  const inbound = input.conversationMode === "inbound";
  const ongoing = input.forceOngoing === true || isOngoingConversation || inbound;
  const lastOut = [...policyHistory].reverse().find((m) => m.direction === "sortant");
  const lastOutSnippet = lastOut?.body?.trim().slice(0, 180) || "";
  const lastOutBody = lastOut?.body?.trim() || "";
  const shortAck =
    input.incomingText.trim().length <= 24 &&
    /^(salut|hello|bonjour|bonsoir|hey|hi|coucou|ok|okay|d'accord|dac|bsr|oui)[!?.…]*$/i.test(
      input.incomingText.trim()
    );
  /** Dernier message proposait déjà d'avancer → « ok » = exécuter, pas reposer une Q. */
  const lastOutWasForwardOffer =
    /\b(je (peux |vais )?(vous |te )?(montrer|expliquer|envoyer|partager)|voici (un |le )?exemple|justement[, ]|on peut |si vous voulez)\b/i.test(
      lastOutBody
    );
  const lastOutWasDiagnostic =
    !!lastOutBody && isOutboundDiagnosticAsk(lastOutBody);
  const softNoToDiagnostic =
    lastOutWasDiagnostic &&
    /^(non|nan|nn|nope)(\s|$)|non je (pense|crois)|pas vraiment|bof|mouais/i.test(
      input.incomingText.trim()
    );
  const askedQuestions = policyHistory
    .filter((m) => m.direction === "sortant")
    .flatMap((m) => m.body.match(/[^.!?\n]{8,}\?/g) ?? [])
    .map((q) => q.trim().replace(/\s+/g, " "))
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .slice(-6);
  const askedBlock =
    askedQuestions.length > 0
      ? `\n## Questions DÉJÀ posées (INTERDIT de les reformuler / répéter)\n- ${askedQuestions.join("\n- ")}\n`
      : "";

  // Filets critiques seulement — le reste = raisonnement IA sur l'historique.
  const hardOverride = softNoToDiagnostic
    ? `\n## GARDE-FOU (ne remplace pas ton jugement)\n` +
      `Sa réponse « ${input.incomingText.trim()} » porte sur ta question de qualification — ce n'est PAS un refus d'intérêt. ` +
      `INTERDIT de clôturer (« je ne vous dérange plus »). ` +
      `Lis l'historique, déduis ce que ça implique pour la mission, réponds naturellement (1-2 phrases).\n`
    : affirmingPendingSend
    ? `\n## GARDE-FOU\n` +
      `Tu as proposé d'envoyer le lien. Il dit « ${input.incomingText.trim()} » → inclus MAINTENANT l'URL campagne. Pas de clôture sans lien.\n`
    : !inbound && ongoing && shortAck && lastOutWasForwardOffer
      ? `\n## GARDE-FOU\n` +
        `Il accepte (« ${input.incomingText.trim()} ») alors que tu venais de proposer d'avancer : exécute la suite (pas de reset / re-présentation / question déjà posée).\n`
      : !inbound && ongoing && shortAck
        ? `\n## GARDE-FOU\n` +
          `Ack court (« ${input.incomingText.trim()} ») — pas de bio / re-présentation. Relis ton dernier message et avance intelligemment (point ou question NOUVELLE).\n`
        : inbound
          ? `\n## Mode ENTRANT (SUPPORT — prioritaire)\n` +
            `Le client a initié. Tu gères le compte / la boutique — PAS de cold outreach.\n` +
            `INTERDIT : « secteur d'activité », « quel type de tâche », discovery B2B, inventer une URL (example.com…).\n` +
            `Si intérêt : remercie + offre concrète (prix/produit) — majuscule en tête.\n` +
            `Si ack / quantité (« ok », « 1 ») : enchaîne la prochaine question utile (souvent le LIEU DE LIVRAISON) — jamais un faux lien.\n`
          : "";

  const userContent = `## Identité & offre
${await buildWhatsAppSourceBlock(userId, input.automationContext, configuredPrice)}
${input.automationContext ? `\n## CAMPAGNE — OBJECTIF & CONSIGNES\n${input.automationContext}\n` : "\n⚠️ Pas de campagne active — réponse courte et générale.\n"}
${hardOverride}${askedBlock}
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

Écris UNIQUEMENT le message WhatsApp au ${inbound ? "client" : "prospect"} (1-2 phrases, ${toneLabel(tone)}, majuscule en tête). Pas d'analyse, pas de plan, pas de « Il vient de… ».${
    affirmingPendingSend ? " Inclus l'URL campagne." : ""
  }${
    !inbound && ongoing && shortAck && !affirmingPendingSend
      ? lastOutWasForwardOffer
        ? " Exécute la suite proposée — pas de nouvelle question déjà vue."
        : " Pas de présentation / bio. Question ou point nouveau seulement."
      : ""
  }`;

  const inboundSystem = inbound ? SUPPORT_INBOUND_REPLY_ADDENDUM : undefined;

  const buildMessages = (extraSystem?: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] => [
    { role: "system", content: WHATSAPP_REPLY_PROMPT },
    { role: "system", content: toneSystem },
    ...(inboundSystem ? [{ role: "system" as const, content: inboundSystem }] : []),
    ...(extraSystem ? [{ role: "system" as const, content: extraSystem }] : []),
    { role: "user", content: userContent },
  ];

  const callReply = async (extraSystem?: string) => {
    const response = await callOpenAiWithRetry(() =>
      client.chat.completions.create({
        model: config.openaiModel,
        messages: buildMessages(extraSystem),
        max_tokens: recommendedMaxTokens(config.openaiModel, 220, {
          thinkingEnabled: false,
        }),
        temperature: 0.65,
        presence_penalty: 0.45,
        frequency_penalty: 0.45,
        ...llmChatExtras({ enableThinking: false }),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
    );
    const choice = response?.choices[0];
    let reply = extractAssistantContent(choice?.message);
    if (!reply) return "";
    if (choice?.finish_reason === "length" && !/[.!?…]$/.test(reply.trim())) {
      const trimmed = reply.trim();
      const lastSpace = trimmed.lastIndexOf(" ");
      if (lastSpace > 40) reply = trimmed.slice(0, lastSpace).trim();
    }
    return reply;
  };

  let reply = await callReply();
  if (!reply || looksLikeInternalMonologue(reply)) {
    console.warn(
      "[whatsapp-reply] monologue interne détecté — retry. Brut:",
      (reply || "").slice(0, 160)
    );
    reply = await callReply(
      "URGENT : ta sortie précédente était une NOTE INTERNE, pas un message WhatsApp. " +
        "Réécris UNIQUEMENT le texte adressé au prospect (vous/votre). " +
        "INTERDIT : « Il vient de… », « Je reste… », « puis je… », « mission », analyse."
    );
  }
  if (!reply || looksLikeInternalMonologue(reply)) {
    console.error(
      "[whatsapp-reply] monologue après retry — fallback sûr. Brut:",
      (reply || "").slice(0, 160)
    );
    reply = safeFallbackWhatsAppReply(input.incomingText);
  }

  let styled = enforceWhatsAppStyle(reply, {
    isOngoing: ongoing,
    incomingText: input.incomingText,
  });
  if (!styled || looksLikeInternalMonologue(styled)) {
    styled = safeFallbackWhatsAppReply(input.incomingText);
  }
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
  styled = sanitizeInventedCampaignUrls(styled, {
    allowedLink: input.closingLink,
    closingGoal: input.closingGoal,
    knownLinkSources: [
      ...(input.knownLinkSources ?? []),
      ...(input.toneSources ?? []),
      input.automationContext,
      input.closingLink,
    ],
  });
  {
    const guarded = applyWhatsAppReplyGuard(styled, {
      incomingText: input.incomingText,
      configuredPrice,
      history: policyHistory,
      closingGoal: input.closingGoal,
      closingLink: input.closingLink,
    });
    if (guarded.invented) {
      console.warn(`[whatsapp-reply] price-invented chat=${input.chatId}`);
    }
    if (guarded.injected) {
      console.warn(`[whatsapp-reply] price-injected chat=${input.chatId}`);
    }
    if (guarded.strippedRepeat) {
      console.warn(`[whatsapp-reply] price-repeat-stripped chat=${input.chatId}`);
    }
    if (guarded.strippedInvented) {
      console.warn(`[whatsapp-reply] price-invented-stripped chat=${input.chatId}`);
    }
    if (guarded.prematureClose) {
      console.warn(`[whatsapp-reply] premature-verbal-close chat=${input.chatId}`);
    }
    if (guarded.notes.length && input.automationId) {
      const note = guarded.notes.join(" ");
      await saveAgentMessageForAutomation(
        userId,
        input.automationId,
        "assistant",
        note
      ).catch(() => {});
    }
    styled = guarded.reply;
  }
  return styled;
}

export function getStopConfirmationReply(): string {
  return "C'est noté, je ne vous dérange plus. Bonne continuation ! 🙂";
}

export { nowFr };
