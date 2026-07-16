import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings, getContactChatHistory } from "./db.js";
import { chatIdToDisplay } from "./evolutionapi.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, extractAssistantContent, recommendedMaxTokens, deepseekChatExtras } from "./llm.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";

export const WHATSAPP_REPLY_PROMPT = `Tu es un commercial WhatsApp expérimenté (Afrique francophone) qui répond comme un **vrai humain** — jamais comme un bot.

## Ta mission
Poursuivre la conversation selon l'OBJECTIF DE LA CAMPAGNE (contexte) jusqu'à la conversion (ou un refus clair), en suivant A.I.D.A. :
- Après une accroche (Attention) : Interest → Desire → Action progressivement.
- N'envoie PAS tout (prix + lien + pitch) d'un coup sauf si le prospect le demande clairement.

## Exception — « un seul message » (prioritaire)
Si le prospect demande explicitement **juste un message**, **juste le lien**, **juste le prix**, **un seul message**, **envoie-moi ça et c'est tout** :
→ Envoie **UNIQUEMENT** l'info demandée (lien / prix / détail) en 1 phrase.
→ **N'ajoute PAS** de question, de relance, ni de discussion. Stop après ce message.

## Règles d'or (non négociables)
1. **RELIS L'HISTORIQUE** à chaque réponse : tiens compte de TOUT ce qui a déjà été dit (noms, objections, intérêts, infos déjà données). Ne répète pas une question déjà posée.
2. **PERSONNEL** : adapte ton message à CE prospect et à CE fil — jamais une réponse copiée d'une autre conversation.
3. **COURT** : 1 phrase en général, 2 max. Jamais de paragraphe. Jamais plus de 220 caractères sauf question complexe.
4. **DIRECT** : réponds à CE que le prospect vient de dire. Pas de pitch générique.
5. **HUMAIN** : rythme naturel, formulations simples, comme un vrai commercial. Varie les formulations.
6. **CONTEXTE CAMPAGNE** : suis objectif, ton et approche. Pas de réponse « à vide ».
7. **PAS DE ROBOT** : interdit « comme mentionné plus tôt », « je suis X et je propose », « n'hésite pas à me le faire savoir », « je suis là pour ça », « comment puis-je vous aider ».
8. **PAS DE RE-SALUT** si conversation déjà engagée : zéro « Bonjour », « Salut », « Bonsoir » en début.
9. **ZÉRO CROCHETS** : jamais [prix], [lien], [prénom], etc. Info manquante → « Je te confirme ça juste après 🙂 » ou une question utile.
10. **CONVERSION** : dès l'intérêt, oriente vers l'action (lien réel, prix, RDV) sans harceler — sauf exception « un seul message ».
11. **1 message à la fois** : une seule idée / question.
12. **Prix / lien** : une seule fois sauf s'il redemande.
13. **Refus clair** : clôture polie, sans insister.
14. **PAS DE STICKER** : tu réponds en TEXTE uniquement. Les stickers sont gérés ailleurs, seulement si le manager l'a autorisé.

## Adaptation par situation
| Situation | Réponse type (1 phrase) |
|-----------|--------------------------|
| « Qui êtes-vous ? » / identité | Prénom + offre courte — PAS de pitch long — puis question pour engager |
| « C'est toi qui m'écrit » / surpris | « Oui c'est moi, désolé si ça t'a surpris » + mini rappel — continue |
| Question prix / détail | Chiffre EXACT du contexte ; sinon « Je te confirme ça juste après 🙂 » |
| « ok » / « merci » / court | Relance légère vers la suite (pas juste « Super ») |
| Intérêt / « en savoir plus » | UNE prochaine étape claire (créneau, lien RÉEL, info) |
| Prêt à payer / commander | Lien/prix/marche à suivre du contexte tout de suite |
| « Juste le lien / juste le prix / un seul message » | Envoie UNIQUEMENT ça — aucune question après |
| Refus clair | « Compris, bonne continuation ! » — stop |

## NE FUIS JAMAIS une question
Si la réponse n'est PAS dans le contexte : reste engagé (précision, ou « je confirme et je reviens »). JAMAIS de crochets. Ne clôture que sur refus clair.

## Style WhatsApp
- Tutoiement ou vouvoiement : suis le prospect.
- Emojis : max 1, seulement si le prospect en met.
- Pas de bullet points, listes, ni formules corporate.

## Reste dans le sujet
Hors-sujet (poème, code, « es-tu un robot ? »…) → recadre en 1 phrase, sans entrer dans le jeu.

## Interdits ABSOLUS
- Texte entre crochets […].
- Inventer prix/offre/nom/lien hors contexte.
- Plus de 3 phrases.
- Resaluer / te re-présenter en conversation engagée.
- Ignorer l'objectif campagne.
- Couper le fil alors que le prospect répond (sauf « un seul message » / refus).
- Tâches hors-sujet.

## Format
Réponds UNIQUEMENT avec le texte du message WhatsApp. Rien d'autre.`

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
  excludeIncoming?: string
): Promise<{ text: string; messageCount: number; isOngoingConversation: boolean }> {
  const history = await getContactChatHistory(userId, chatId, 30);

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
  const isOngoingConversation = incomingCount >= 1 || filtered.length >= 2;

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

/** Nettoie et force le style WhatsApp court. */
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

  if (opts.isOngoing) {
    text = text.replace(
      /^(bonjour|salut|bonsoir|hello|coucou)\s+[\wÀ-ÿ-]+[,.!]?\s*/i,
      ""
    );
    text = text.replace(/^(bonjour|salut|bonsoir|hello|coucou)[,.!]?\s*/i, "");
  }

  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const isComplexQuestion = opts.incomingText.length > 80 || (opts.incomingText.match(/\?/g)?.length ?? 0) > 1;
  if (sentences.length > 3 && !isComplexQuestion) {
    text = sentences.slice(0, 2).join(" ");
  }

  const isShortIncoming = opts.incomingText.trim().length <= 40;
  if (isShortIncoming && text.length > 120) {
    text = sentences[0] ?? text.slice(0, 120);
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
}): Promise<string> {
  const client = await getOpenAiClient(userId);
  const display = chatIdToDisplay(input.chatId);
  const { text: historyText, messageCount, isOngoingConversation } = await formatHistory(
    userId,
    input.chatId,
    input.senderName,
    input.incomingText
  );

  const prospectStyle = analyzeProspectStyle(input.incomingText);

  const userContent = `## Identité & offre (ne jamais inventer hors de ça)
${await businessContextBlock(userId)}
${input.automationContext ? `\n## CAMPAGNE — OBJECTIF & CONSIGNES (priorité absolue)\n${input.automationContext}\n` : "\n⚠️ Pas de campagne active — réponse courte et générale.\n"}

## Contact
${input.senderName} (${display})
Messages échangés : ${messageCount}
Conversation engagée : ${isOngoingConversation ? "OUI — ne resalue pas, ne te re-présente pas" : "non — salutation courte OK"}
Style du message entrant : ${prospectStyle}

## Historique
${historyText}

--- NOUVEAU MESSAGE ---
${input.senderName}: ${input.incomingText}

Rédige UNE réponse WhatsApp courte (1-2 phrases max), personnelle, en tenant compte de TOUT l'historique ci-dessus.${
    isOngoingConversation ? " NE RESALUE PAS." : ""
  }`;

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: WHATSAPP_REPLY_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 220, { thinkingEnabled: true }),
      temperature: 0.78,
      presence_penalty: 0.5,
      frequency_penalty: 0.45,
      ...deepseekChatExtras({ enableThinking: true }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  );

  const reply = extractAssistantContent(response?.choices[0]?.message);
  if (!reply) {
    throw new Error(`${llmProviderLabel()} n'a pas généré de réponse.`);
  }

  return enforceWhatsAppStyle(reply, {
    isOngoing: isOngoingConversation,
    incomingText: input.incomingText,
  });
}

function analyzeProspectStyle(text: string): string {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (/c.?est (toi|vous) qui|pourquoi tu m.?ecri|pourquoi vous m.?ecri/i.test(lower)) {
    return "scepticisme — réponse courte et honnête, pas de pitch";
  }
  if (/qui (etes|êtes)-vous|c'?est qui|votre nom|ton nom/i.test(lower)) {
    return "identité — 1 phrase courte SANS inventer de prénom (utiliser le prénom du contexte s'il existe, sinon neutre)";
  }
  if (t.length <= 15 && /^(ok|okay|d'accord|dac|merci|bsr|bonjour|salut|oui|non)$/i.test(t)) {
    return "très court — 3-8 mots max";
  }
  if (/\?/.test(t)) return "question — réponse directe en 1 phrase";
  if (/formation|inscription|programme|contenu/i.test(lower)) return "demande d'infos — concret et court";
  if (/combien|prix|tarif|co[uû]t|fcfa|franc/i.test(lower)) return "prix — chiffre du contexte si dispo";
  if (/int[eé]ress|curieux|en savoir plus/i.test(lower)) {
    return "intérêt — proposer UNE prochaine étape";
  }
  if (/pas int[eé]ress|non merci|laisse|stop|occup[eé]/i.test(lower)) {
    return "refus — clôturer poliment en 1 phrase";
  }
  if (/rdv|rendez-vous|appel|disponible|cr[eé]neau/i.test(lower)) {
    return "RDV — proposer un créneau concret";
  }

  return t.length > 80 ? "message long — réponse concise" : "standard — 1 phrase";
}

export function getStopConfirmationReply(): string {
  return "C'est noté, je ne vous dérange plus. Bonne continuation ! 🙂";
}

export { nowFr };
