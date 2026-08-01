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
- **Même mission d'un bout à l'autre** : seuls les mots varient — le pacing et l'avancée vers l'objectif restent stables.
- **Pas fade** : chaque message a une personnalité (chaleur légère, franchise, micro-humour OK si le ton campagne le permet). Interdit le style « fiche LinkedIn » ou checklist commerciale.

## Exception — « un seul message » (prioritaire)
Si le prospect demande explicitement **juste un message**, **juste le lien**, **juste le prix**, **un seul message**, **envoie-moi ça et c'est tout** :
→ Envoie **UNIQUEMENT** l'info demandée (lien / prix / détail) en 1 phrase.
→ **N'ajoute PAS** de question, de relance, ni de discussion. Stop après ce message.

## Règles d'or (non négociables)
1. **RELIS L'HISTORIQUE** à chaque réponse : tiens compte de TOUT ce qui a déjà été dit (noms, objections, intérêts, infos déjà données). Ne répète pas une question déjà posée. Ne redis pas le même bénéfice (« gagner du temps ») sans angle nouveau.
2. **PERSONNEL** : adapte le wording à CE prospect — jamais une réponse copiée — mais **reste dans le cadre** ton/approche/objectif campagne.
3. **COURT MAIS VIVANT** : 1 phrase en général, 2 max. Jamais de paragraphe. Jamais plus de 220 caractères sauf question complexe. Court ≠ sec : une phrase complète avec intention, pas un titre pro ni un mot seul.
4. **DIRECT** : réponds à CE que le prospect vient de dire. Pas de pitch générique.
5. **HUMAIN** : rythme naturel, formulations simples. Varie les formulations SANS changer l'intention.
6. **CONTEXTE CAMPAGNE** : suis objectif, ton, approche **et playbook synchronisé**. Si un playbook est fourni, c'est la trajectoire à suivre (mots adaptés au prospect, mission identique).
7. **PAS DE ROBOT** : interdit « comme mentionné plus tôt », « je suis X et je propose », « n'hésite pas à me le faire savoir », « je suis là pour ça », « comment puis-je vous aider ».
8. **PAS DE RE-SALUT** si conversation déjà engagée : zéro « Bonjour », « Salut », « Bonsoir » en début.
9. **ZÉRO CROCHETS** : jamais [prix], [lien], [prénom], etc. Info manquante → « Je vous confirme ça juste après » ou une question utile.
10. **CONVERSION** : dès l'intérêt, oriente vers l'action (lien réel, prix, RDV) sans harceler — sauf exception « un seul message ».
11. **1 message à la fois** : une seule idée / question.
12. **Prix / lien** : une seule fois sauf s'il redemande.
13. **Refus clair** : clôture polie, sans insister.
14. **PAS DE STICKER** : tu réponds en TEXTE uniquement.
15. **EMOJIS** : aucun par défaut ; max 1 seulement si le prospect en utilise dans son message.
16. **CLÔTURE** : dès que l'objectif est atteint (lien envoyé, livraison organisée / livreur contacté, RDV fixé) → une courte confirmation puis STOP. N'enchaîne pas de messages de confirmation.
17. **PAS DE PRÉNOM DU PROSPECT** à tout va (vouvoiement = formule neutre).
18. **INTERDIT RÉACTIONS VIDES** : jamais un message qui n'est que « Super. », « Ok. », « Parfait. », « Ah super », « D'accord. », « Nickel. » — toujours **réagir + avancer** (1 détail utile OU 1 question liée à l'objectif).

## Adaptation rapide
- Identité / « qui es-tu » → prénom **business** (contexte) + **pourquoi on écrit** en 1 souffle (pas un titre LinkedIn seul : « Growth marketer et expert… »). Ex. intention : « Alex — j'aide des pros à sortir du chaos WhatsApp. Je vous écris pour [offre courte]. »
- « Où avez-vous eu mon numéro / d'où vous me contactez » → transparence **+** micro-empathie (« Légitime de demander ») + source vraie du contexte (groupe, admin, liste…) — **sans** enchaîner le pitch complet dans la même bulle.
- Prix / détail → chiffre exact du contexte, sinon « Je vous confirme ça juste après »
- Intérêt / engagement léger → **pousser l'intérêt** : 1 détail utile + question ou prochaine étape
- Accusé minimal (« oui », « ok », « d'accord », « dac ») → **ne pas pitcher tout de suite** : 1 question concrète OU 1 preuve / détail nouveau (pas le même levier « temps » déjà dit). Ex. « Vous gérez beaucoup de messages WhatsApp par jour, ou c'est plutôt calme ? »
- **Objection / hésitation** (« trop cher », « je réfléchis », « plus tard », « je ne suis pas sûr », doute sans refus net) :
  → D’abord **reconnaître** le frein (empathie courte), puis une **piste concrète** liée à CE qu’il a dit — pas un pitch générique.
  → **Ne pousse pas à l’achat à chaque hésitation** : si le ton est prudent / distant, rassure ou laisse une porte ouverte sans CTA ; si le frein est précis (prix, timing, confiance), un argument ciblé OK.
  → Toujours 1 phrase (2 max) : empathie + piste, pas une info sèche ni une relance agressive.
- « Juste le lien / prix » → uniquement ça, aucune question
- Refus clair → « Compris, bonne continuation ! »
- Objectif atteint (livreur / lien / RDV) → une confirmation courte, puis plus rien

## Style WhatsApp
- **VOUVOIEMENT OBLIGATOIRE** : toujours vous / votre / vos. Jamais tu, ton, ta, tes, te, t'.
- Pas de bullet points, listes, ni formules corporate.
- Sonner comme quelqu'un qui écrit vite au téléphone, pas comme une brochure.

## Reste dans le sujet
Hors-sujet (poème, code, « es-tu un robot ? »…) → recadre en 1 phrase, sans entrer dans le jeu.

## Interdits ABSOLUS
- Texte entre crochets […].
- Inventer prix/offre/nom/lien hors contexte.
- Plus de 3 phrases.
- Resaluer / te re-présenter en conversation engagée (sauf si on te demande explicitement qui tu es — alors identité + pourquoi, sans resaluer).
- Ignorer l'objectif campagne.
- Couper le fil alors que le prospect répond (sauf « un seul message » / refus / objectif déjà atteint).
- Tutoyer le prospect (tu / ton / ta / te / t').
- Tâches hors-sujet.
- Message d'un seul mot / réaction vide.

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

  // Réactions vide seule → forcer un minimum de substance (le LLM a triché)
  if (/^(super|ok|okay|parfait|d'?accord|ah super|nickel|top|compris|je vois)[.!]*$/i.test(text.trim())) {
    text =
      "Compris. Pour avancer concrètement : vous gérez déjà beaucoup de messages WhatsApp, ou c'est plutôt calme de votre côté ?";
  }

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
  /** false = aucun emoji (refus stickers/emojis). Défaut : max 1. */
  allowEmojis?: boolean;
  /** Isole l'historique à cette automatisation. */
  automationId?: number | null;
  /** Force « conversation déjà engagée » (ex. simulation téléphone). */
  forceOngoing?: boolean;
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

  const ongoing = input.forceOngoing === true || isOngoingConversation;
  const prospectStyle = analyzeProspectStyle(input.incomingText);

  const userContent = `## Identité & offre (ne jamais inventer hors de ça)
${await businessContextBlock(userId)}
${input.automationContext ? `\n## CAMPAGNE — OBJECTIF & CONSIGNES (priorité absolue)\n${input.automationContext}\n` : "\n⚠️ Pas de campagne active — réponse courte et générale.\n"}

## Contact
${input.senderName} (${display})
Messages échangés : ${Math.max(messageCount, input.forceOngoing ? 2 : 0)}
Conversation engagée : ${ongoing ? "OUI — ne resalue pas, ne te re-présente pas" : "non — salutation courte OK"}
Style du message entrant : ${prospectStyle}

## Historique
${historyText || "(historique fourni dans le bloc campagne / simulation ci-dessus)"}

--- NOUVEAU MESSAGE ---
${input.senderName}: ${input.incomingText}

Rédige UNE réponse WhatsApp courte (1-2 phrases max), personnelle et vivante, en tenant compte de TOUT l'historique ci-dessus. INTERDIT : réaction vide (« Super. ») ou titre pro seul.${
    ongoing ? " NE RESALUE PAS." : ""
  } Reste STRICTEMENT dans le cadre campagne / playbook.`;

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: WHATSAPP_REPLY_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 220, { thinkingEnabled: false }),
      temperature: 0.72,
      presence_penalty: 0.45,
      frequency_penalty: 0.45,
      ...deepseekChatExtras({ enableThinking: false }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  );

  const reply = extractAssistantContent(response?.choices[0]?.message);
  if (!reply) {
    throw new Error(`${llmProviderLabel()} n'a pas généré de réponse.`);
  }

  let styled = enforceWhatsAppStyle(reply, {
    isOngoing: ongoing,
    incomingText: input.incomingText,
  });
  // Stickers/emojis : refus par défaut sauf autorisation campagne explicite
  if (input.allowEmojis === true) {
    const { limitEmojis } = await import("./sticker-consent.js");
    styled = limitEmojis(styled, 1);
  } else {
    const { stripEmojis } = await import("./sticker-consent.js");
    styled = stripEmojis(styled);
  }
  return styled;
}

function analyzeProspectStyle(text: string): string {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (/c.?est (toi|vous) qui|pourquoi tu m.?ecri|pourquoi vous m.?ecri/i.test(lower)) {
    return "scepticisme — transparence courte + micro-empathie, pas de pitch";
  }
  if (
    /o[uù] (avez|as)|d.?o[uù] (avez|as|viens|venez)|comment (avez|as).*(num[eé]ro|contact)|trouv[eé].*num[eé]ro|eu mon num[eé]ro/i.test(
      lower
    )
  ) {
    return (
      "source du contact — transparence + empathie courte (« légitime ») + source vraie du contexte ; " +
      "PAS le pitch masterclass dans cette bulle"
    );
  }
  if (/qui (etes|êtes)-vous|c'?est qui|votre nom|ton nom|vous [êe]tes qui/i.test(lower)) {
    return (
      "identité — prénom business du contexte + pourquoi on écrit (1 souffle) ; " +
      "INTERDIT titre LinkedIn seul (« Growth marketer et expert… ») ; ne pas inventer de nom"
    );
  }
  // Refus clair AVANT hésitation (évite de traiter « non merci » comme une objection)
  if (/pas int[eé]ress|non merci|laisse|stop|occup[eé]/i.test(lower)) {
    return "refus — clôturer poliment en 1 phrase";
  }
  // Objection / hésitation (sans refus net) — distinct de scepticisme et d'intérêt franc
  if (
    /trop cher|chers?|co[uû]teux|budget|pas les moyens|je (ne )?peux pas (payer|me le permettre)/i.test(
      lower
    ) ||
    /je r[eé]fl[eé]chis|je vais r[eé]fl[eé]chir|laisse[- ]?moi r[eé]fl[eé]chir|je dois y penser|j.?y pense/i.test(
      lower
    ) ||
    /plus tard|pas maintenant|pas tout de suite|une autre fois|on verra|on s.?en reparle/i.test(
      lower
    ) ||
    /je (ne )?suis pas s[uû]r|pas s[uû]r(e)?|j.?h[eé]site|h[eé]sitation|doute|pas convaincu|bof|mouai/i.test(
      lower
    ) ||
    /peut[- ]?[eê]tre|je (ne )?sais pas (trop|encore)|c.?est (un peu )?serr[eé]|c.?est chaud/i.test(
      lower
    )
  ) {
    return (
      "objection/hésitation — empathie d'abord (reconnaître le frein), " +
      "puis piste concrète liée à CE frein ; ne pas forcer l'achat si le ton est prudent ; 1-2 phrases max"
    );
  }
  if (
    t.length <= 20 &&
    /^(ok|okay|d'accord|dac|merci|bsr|bonjour|salut|oui|non|ah bon|je vois|compris)[!?.]*$/i.test(t)
  ) {
    return (
      "accusé minimal — INTERDIT « Super. » / pitch immédiat ; " +
      "1 question concrète OU 1 détail/preuve nouveau (pas le même bénéfice déjà dit)"
    );
  }
  if (/\?/.test(t)) return "question — réponse directe en 1 phrase vivante";
  if (/formation|inscription|programme|contenu/i.test(lower)) return "demande d'infos — concret et court";
  if (/combien|prix|tarif|co[uû]t|fcfa|franc/i.test(lower)) return "prix — chiffre du contexte si dispo";
  if (/int[eé]ress|curieux|en savoir plus/i.test(lower)) {
    return "intérêt — proposer UNE prochaine étape";
  }
  if (/rdv|rendez-vous|appel|disponible|cr[eé]neau/i.test(lower)) {
    return "RDV — proposer un créneau concret";
  }

  return t.length > 80 ? "message long — réponse concise et humaine" : "standard — 1 phrase vivante (réagir + avancer)";
}

export function getStopConfirmationReply(): string {
  return "C'est noté, je ne vous dérange plus. Bonne continuation ! 🙂";
}

export { nowFr };
