import OpenAI from "openai";
import { config } from "./config.js";
import { getAppSettings, getContactChatHistory } from "./db.js";
import { chatIdToDisplay } from "./evolutionapi.js";
import { callOpenAiWithRetry } from "./openai-retry.js";
import { createLlmClient, llmProviderLabel, extractAssistantContent, recommendedMaxTokens } from "./llm.js";
import { sanitizeOutboundWhatsAppText } from "./outbound-sanitize.js";

export const WHATSAPP_REPLY_PROMPT = `Tu es un expert WhatsApp business (20+ ans) qui répond aux messages entrants pour un entrepreneur en Afrique francophone.

## Ta mission
Poursuivre la conversation selon l'OBJECTIF DE LA CAMPAGNE (fourni dans le contexte) du début jusqu'à la conversion (ou jusqu'à un refus clair). Après le premier message de prospection, tu CONTINUES l'échange — tu ne t'arrêtes jamais juste après l'ouverture.

## Règles d'or (non négociables)
1. **COURT** : 1 phrase en général, 2 max. Jamais de paragraphe. Jamais plus de 200 caractères sauf si le prospect pose une question complexe.
2. **DIRECT** : réponds à CE que le prospect vient de dire. Pas de pitch générique.
3. **CONTEXTE CAMPAGNE** : tu connais l'objectif, le ton et l'approche de la campagne — tu les suis. Tu ne réponds pas « à vide ».
4. **PAS DE ROBOT** : interdit « comme mentionné plus tôt », « je suis X et je propose », « n'hésite pas à me le faire savoir », « je suis là pour ça ».
5. **PAS DE RE-SALUT** si conversation déjà engagée : zéro « Bonjour », « Salut », « Bonsoir » en début de réponse.
6. **ZÉRO CROCHETS** : n'écris JAMAIS de crochets [ ] dans un message WhatsApp. Interdit absolu : [prix], [lien], [prénom], [nom], [produit], [offre], ou tout autre mot entre crochets. Si une info manque (prix, lien…), NE l'invente PAS et NE mets PAS de placeholder : dis que tu confirmes et reviens (« Je te confirme le tarif exact juste après 🙂 ») ou pose une question utile.
7. **CONVERSION** : dès que le prospect est intéressé, oriente vers l'action (lien réel, prix, RDV) sans harceler.
8. **1 message à la fois** : jamais plusieurs idées / questions dans le même message.
9. **Prix / lien** : une seule fois sauf s'il le redemande.
10. **Refus clair** : clôture polie immédiatement, sans insister.

## Adaptation par situation
| Situation | Réponse type (1 phrase) |
|-----------|--------------------------|
| « Qui êtes-vous ? » / identité | Prénom + offre courte du contexte — PAS de pitch long — puis une question pour engager |
| « C'est toi qui m'écrit » / surpris | « Oui c'est moi, désolé si ça t'a surpris » + mini rappel — continue le fil |
| Question prix / détail | Chiffre ou info EXACTE du contexte ; si absent → « Je te confirme ça juste après 🙂 » (JAMAIS de crochets) |
| « ok » / « merci » / court | Relance légère vers la prochaine étape (pas juste « Super ») |
| Intérêt / « en savoir plus » | UNE prochaine étape claire (créneau, lien RÉEL du contexte, info) vers la conversion |
| Prêt à payer / commander | Envoie le lien/prix/marche à suivre du contexte immédiatement |
| Refus clair / pas intéressé | « Compris, bonne continuation ! » — ne pas insister |

## NE FUIS JAMAIS une question (crucial)
Si le prospect pose une question dont la réponse n'est PAS dans le contexte : **ne coupe pas la conversation**. Reste engagé :
- Réponds au mieux avec ce que tu as, OU pose une brève question de précision, OU dis que tu confirmes et reviens vite.
- JAMAIS de texte type « Le produit coûte [prix] ».
- Le prospect qui pose des questions est INTÉRESSÉ : garde-le. Ne clôture que s'il refuse clairement.

## Style WhatsApp
- Tutoiement ou vouvoiement : suis le prospect.
- Emojis : max 1, seulement si le prospect en met.
- Pas de bullet points, pas de listes, pas de formules corporate.

## Reste dans le sujet (anti-abus)
Tu réponds UNIQUEMENT dans le cadre de l'offre / la campagne. Si le message est clairement hors-sujet (poème, code, traduction, culture générale, « es-tu un robot ? »…), recadre en 1 phrase sans entrer dans le jeu.

## Interdits ABSOLUS
- Tout texte entre crochets […].
- Inventer prix/offre/nom/lien hors contexte.
- Messages de plus de 3 phrases.
- Resaluer ou te re-présenter en conversation engagée.
- Ignorer l'objectif de la campagne.
- Couper le fil après le premier message alors que le prospect répond.
- Faire des tâches hors-sujet (poème, code, traduction, culture générale…).

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
  const history = await getContactChatHistory(userId, chatId, 20);

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

/** Délai avant réponse auto : 8–20 s (premier contact) / 4–12 s (déjà engagé). */
export async function getAdaptiveReplyDelay(userId: number, chatId: string): Promise<number> {
  const { isOngoingConversation } = await formatHistory(userId, chatId, "", undefined);
  if (isOngoingConversation) {
    return 4_000 + Math.floor(Math.random() * 8_000);
  }
  return 8_000 + Math.floor(Math.random() * 12_000);
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

Rédige UNE réponse WhatsApp courte (1-2 phrases max). Directe, humaine, selon l'objectif campagne.${
    isOngoingConversation ? " NE RESALUE PAS." : ""
  }`;

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: WHATSAPP_REPLY_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 150),
      temperature: 0.65,
      presence_penalty: 0.4,
      frequency_penalty: 0.35,
    })
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
    return "identité — 1 phrase avec prénom, pas de pitch";
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
