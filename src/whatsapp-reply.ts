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
3. **COURT MAIS VIVANT** : 1-2 phrases. Jamais de paragraphe. Court ≠ sec : une phrase complète avec intention — **interdit** un mot seul ou un prénom seul quand la question demande du contexte (identité, objection…).
4. **DIRECT** : réponds à CE que le prospect vient de dire. Pas de pitch générique.
5. **HUMAIN** : rythme naturel, formulations simples. Varie les formulations SANS changer l'intention.
6. **CONTEXTE CAMPAGNE** : suis objectif, ton, approche et playbook comme **boussole** (mission / pacing). Le message RÉEL du prospect prime sur le prochain tour listé du playbook — n'applique PAS un script mot à mot si sa réponse diffère.
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
19. **SORTANT** : si TU as envoyé le 1er message, INTERDIT de parler comme un inbound (« ravi de pouvoir échanger », « merci de votre message », te présenter à neuf après un simple « salut »).
20. **ENTRANT (support / closing)** : si LE CLIENT a écrit en premier, INTERDIT l'intro prospection (« Bonjour, c'est X, je vous contacte au sujet de… »). Accueille / réponds à sa demande ; tu gères le compte, tu ne pitches pas comme un cold outreach.
21. **INFOS MULTIPLES** : si le client donne plusieurs infos d'un coup (nom + ville + horaire, taille + adresse…), tu notes **tout ce qui est utile** en 1 souffle et tu poses **UNE** question pour la prochaine info encore manquante. **INTERDIT** de répondre seulement « Merci M. X » / « Noté » / « Parfait » sans avancer la mission.

## Adaptation rapide
- Identité / « qui es-tu » → prénom **business** (contexte) + **pourquoi on écrit** en 1 souffle (pas un titre LinkedIn seul : « Growth marketer et expert… »). Ex. intention : « Alex, j'aide des pros à sortir du chaos WhatsApp. Je vous écris pour [offre courte]. »
- « Où avez-vous eu mon numéro / d'où vous me contactez » → transparence **+** micro-empathie (« Légitime de demander ») + source vraie du contexte (groupe, admin, liste…) — **sans** enchaîner le pitch complet dans la même bulle.
- Prix / détail → chiffre exact du contexte, sinon « Je vous confirme ça juste après »
- Intérêt / engagement léger → **pousser l'intérêt** : 1 détail utile + question ou prochaine étape
- Accusé minimal (« oui », « ok », « d'accord », « dac ») → **ne pas pitcher tout de suite** : 1 question concrète OU 1 preuve / détail nouveau (pas le même levier « temps » déjà dit). Ex. « Vous gérez beaucoup de messages WhatsApp par jour, ou c'est plutôt calme ? »
- **Salut / hello / bonjour court** alors que **TU as déjà ouvert** la conversation → enchaîne ton fil (répondre / avancer). **INTERDIT** de parler comme s'il t'avait contacté (« ravi de pouvoir échanger », « merci de m'écrire », te présenter à neuf). Tu as initié : continue.
- **Salut / hello / bonjour** en mode **ENTRANT** (client a initié) → accueil court + question utile produit (taille, modèle, besoin). **INTERDIT** « je vous contacte au sujet de… ».
- **Plusieurs infos d'un coup** (ex. « FAGNON Powell. Livraison Porto-Novo, dispo à 17h ») → « Je note [nom], [lieu], [horaire]. Pour finaliser : [prochaine info manquante] ? » — jamais un simple « Merci M. FAGNON. »
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
- **PAS DE TIRETS « — » / « – »** pour séparer deux idées (ex. « marketer – je vous écris »). Préfère un point ou une virgule : « Alex, growth marketer. Je vous écris pour… ».

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
- Tirets cadratin / demi-cadratin (— ou –) comme séparateur de phrases.

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

/** Accusé / salutation très courte du prospect. */
function isMinimalProspectAck(text: string): boolean {
  const t = text.trim();
  return (
    t.length <= 24 &&
    /^(salut|hello|bonjour|bonsoir|hey|hi|coucou|ok|okay|d'accord|dac|oui|non|bsr|merci)[!?.…]*$/i.test(
      t
    )
  );
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

function fallbackAfterInfoDump(): string {
  return (
    "Je note bien ces éléments. Pour finaliser la livraison, j'aurais encore besoin du point exact (quartier / repère) et d'un numéro pour que le livreur vous joigne."
  );
}

/** Intro type inbound alors qu'on a déjà ouvert (bug playbook). */
function isFalseInboundIntro(text: string): boolean {
  return /ravi (de )?(pouvoir )?[eé]changer|heureux de (pouvoir )?[eé]changer|merci de (m.?avoir |votre |m.?écrire|m.?ecrire)|(suite|gr[aâ]ce) [aà] votre (message|demande|contact)|je me pr[eé]sente/i.test(
    text
  );
}

/** Pitch offre trop tôt après un accusé minimal. */
function isEarlyOfferPitch(text: string): boolean {
  return /je (vous )?(propose|contacte|pr[eé]sente)|je vous [eé]cris (pour|parce)|j['']accompagne|solutions? d['']automatisation|automatisations? concr[eè]tes|pour aider les|gagner du temps|notre (offre|formation|programme|solution)|je suis .{0,40} et je/i.test(
    text
  );
}

/** « C'est qui ? » / qui êtes-vous — ne pas couper au prénom seul. */
function isIdentityQuestion(text: string): boolean {
  return /qui (etes|êtes)-vous|c'?est qui|votre nom|ton nom|vous [êe]tes qui/i.test(
    text.trim()
  );
}

function fallbackAfterMinimalAck(incoming: string): string {
  if (/^(ok|okay|d'accord|dac|oui)[!?.…]*$/i.test(incoming.trim())) {
    return "Compris. Pour situer : vous gérez plutôt ça en solo, ou avec une petite équipe ?";
  }
  return "Ça va de mon côté, merci. Vous êtes plutôt freelance / petite boîte, ou une équipe plus large ?";
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

  // Tirets « — / – / - » utilisés comme pause entre deux idées (pas les traits d'union)
  text = text.replace(/\s+[—–]\s+/g, ". ");
  text = text.replace(/\s+-\s+(?=[A-Za-zÀ-ÿ])/g, ". ");
  text = text.replace(/\.\s+([a-zà-ÿ])/g, (_, c: string) => `. ${c.toUpperCase()}`);
  text = text.replace(/\.\s*\./g, ".");
  text = text.replace(/\s{2,}/g, " ").trim();

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
    // Interdit de recoller un opener froid en milieu de fil
    if (
      /^(bonjour|salut|bonsoir).{0,40}(minute|instant|secondes?).{0,20}(accorder|consacrer|prendre)/i.test(
        text
      ) ||
      /^(bonjour|salut).{0,30}(allez-vous bien|comment allez-vous).{0,40}\?/i.test(text)
    ) {
      text =
        "Pour en revenir à ce dont on parlait : souhaitez-vous que je vous envoie le détail concret / le lien ?";
    }
  }

  // Garde-fou dur : playbook qui force une intro inbound / un pitch trop tôt
  if (opts.isOngoing && isMinimalProspectAck(opts.incomingText)) {
    if (isFalseInboundIntro(text) || isEarlyOfferPitch(text)) {
      text = fallbackAfterMinimalAck(opts.incomingText);
    }
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

  // Court entrant : limite douce — JAMAIS couper au milieu d'un mot
  // (ex. « sans y passer des he » au lieu de « heures »).
  const isShortIncoming = opts.incomingText.trim().length <= 40;
  if (isShortIncoming && text.length > 120 && !identityQ) {
    const kept = sentences.slice(0, 2).join(" ").trim();
    if (kept.length > 0 && kept.length <= 280) {
      text = kept;
    } else {
      // Coupe au dernier espace avant 220 car. — jamais slice brut
      const hard = text.slice(0, 220);
      const lastSpace = hard.lastIndexOf(" ");
      text = (lastSpace > 80 ? hard.slice(0, lastSpace) : hard).trim();
      // Si on a coupé une phrase incomplète (pas de ponctuation finale), retire le dernier fragment
      if (!/[.!?…]$/.test(text)) {
        const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
        if (parts.length >= 2) text = parts.slice(0, -1).join(" ").trim();
      }
    }
  } else if (identityQ && sentences.length > 2) {
    text = sentences.slice(0, 2).join(" ");
  }

  // Après éventuelle coupe : toujours bloquer un simple « Merci M. X » si le client a dumpé des infos
  if (isInfoDenseProspectMessage(opts.incomingText) && isBareThankYouOrNameAck(text)) {
    text = fallbackAfterInfoDump();
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

  const inbound = input.conversationMode === "inbound";
  const ongoing = input.forceOngoing === true || isOngoingConversation || inbound;
  const prospectStyle = analyzeProspectStyle(input.incomingText, {
    conversationMode: input.conversationMode,
  });
  const minimalAck = isMinimalProspectAck(input.incomingText);
  const infoDense = isInfoDenseProspectMessage(input.incomingText);

  const hardOverride =
    // Prospection sortante : un dump commande/livraison hors mission ≠ basculer en support livraison.
    !inbound && infoDense
      ? `\n## PRIORITÉ ABSOLUE (écrase le playbook)\n` +
        `Mode SORTANT (prospection). Le prospect a écrit un long message (souvent hors-sujet / commande / livraison) : « ${input.incomingText.trim().slice(0, 280)} ».\n` +
        `INTERDIT : confirmer une livraison, un RDV de réception, un montant cash, ou traiter ce message comme ta mission si ce n'est PAS l'objectif campagne.\n` +
        `En 1-2 phrases : accusé court si besoin + RECADRE vers l'objectif campagne (masterclass / offre / lien) avec UNE question liée.\n` +
        `INTERDIT : cold opener (« Bonjour, vous avez une minute… ») si le fil est déjà engagé.\n`
      : infoDense
      ? `\n## PRIORITÉ ABSOLUE (écrase le playbook)\n` +
        `Le client vient de donner PLUSIEURS infos d'un coup : « ${input.incomingText.trim()} ».\n` +
        `INTERDIT : répondre seulement « Merci », « Merci M. X », « Noté », « Parfait » sans avancer.\n` +
        `En 1-2 phrases : confirme TOUTES les infos utiles (nom, lieu, horaire, taille…) + pose UNE question pour la prochaine info encore manquante vers l'objectif campagne.\n`
      : inbound && minimalAck
      ? `\n## PRIORITÉ ABSOLUE (écrase le playbook)\n` +
        `Mode ENTRANT : le client vient d'écrire « ${input.incomingText.trim()} ». Il a initié.\n` +
        `INTERDIT : intro prospection (« Bonjour, c'est X, je vous contacte au sujet de… »), pitcher l'offre comme un opener.\n` +
        `Réponds en 1-2 phrases : accueil court + demande concrète (besoin / taille / modèle) liée à l'offre campagne.\n`
      : ongoing && minimalAck && !inbound
      ? `\n## PRIORITÉ ABSOLUE (écrase le playbook)\n` +
        `TU as déjà ouvert la conversation. Le prospect répond juste « ${input.incomingText.trim()} ».\n` +
        `INTERDIT : te présenter, « ravi de pouvoir échanger », « merci de votre message », pitcher l'offre, cold opener (« Bonjour, vous avez une minute… »).\n` +
        `Réponds en 1 phrase naturelle qui continue TON fil (réagir + 1 question concrète liée à l'objectif).\n`
      : inbound
        ? `\n## CADRE ENTRANT\n` +
          `Le client a contacté le compte. Tu gères le support / closing — pas de cold outreach.\n` +
          `INTERDIT de commencer par « je vous contacte au sujet de… ».\n`
        : "";

  const userContent = `## Identité & offre (ne jamais inventer hors de ça)
${await businessContextBlock(userId)}
${input.automationContext ? `\n## CAMPAGNE — OBJECTIF & CONSIGNES\n${input.automationContext}\n` : "\n⚠️ Pas de campagne active — réponse courte et générale.\n"}
${hardOverride}
## Contact
${input.senderName} (${display})
Messages échangés : ${Math.max(messageCount, input.forceOngoing || inbound ? 2 : 0)}
Conversation engagée : ${ongoing ? (inbound ? "OUI (entrant — client a initié)" : "OUI — ne resalue pas, ne te re-présente pas") : "non — salutation courte OK"}
Mode conversation : ${inbound ? "ENTRANT (support)" : "SORTANT (prospection)"}
Style du message entrant : ${prospectStyle}

## Historique
${historyText || "(historique fourni dans le bloc campagne / simulation ci-dessus)"}

--- NOUVEAU MESSAGE ---
${input.senderName}: ${input.incomingText}

Rédige UNE réponse WhatsApp (1-2 phrases), personnelle et vivante, en tenant compte de TOUT l'historique ci-dessus. INTERDIT : réaction vide (« Super. »), titre pro seul, ou prénom/nom SEUL sur une question d'identité (toujours prénom + pourquoi).${
    infoDense
      ? " Le client a donné plusieurs infos : confirme-les TOUTES + UNE question pour la suite — INTERDIT « Merci M. X » seul."
      : ""
  }${
    ongoing && !inbound ? " NE RESALUE PAS. NE TE RE-PRÉSENTE PAS." : ""
  }${
    inbound
      ? " Mode ENTRANT : pas d'intro « je vous contacte pour… »."
      : ""
  }${minimalAck && ongoing && !inbound ? " Message réel prioritaire sur tout tour playbook." : " Reste dans le cadre campagne (mission/ton)."}`;

  const response = await callOpenAiWithRetry(() =>
    client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: WHATSAPP_REPLY_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: recommendedMaxTokens(config.openaiModel, 260, { thinkingEnabled: false }),
      temperature: 0.72,
      presence_penalty: 0.45,
      frequency_penalty: 0.45,
      ...deepseekChatExtras({ enableThinking: false }),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming)
  );

  const choice = response?.choices[0];
  let reply = extractAssistantContent(choice?.message);
  if (!reply) {
    throw new Error(`${llmProviderLabel()} n'a pas généré de réponse.`);
  }
  // Coupe LLM (max_tokens) : retirer le dernier fragment incomplet plutôt qu'envoyer « … des he »
  if (choice?.finish_reason === "length" && !/[.!?…]$/.test(reply.trim())) {
    const trimmed = reply.trim();
    const lastSpace = trimmed.lastIndexOf(" ");
    if (lastSpace > 40) reply = trimmed.slice(0, lastSpace).trim();
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

function analyzeProspectStyle(
  text: string,
  opts?: { conversationMode?: "outbound" | "inbound" }
): string {
  const t = text.trim();
  const lower = t.toLowerCase();
  const inbound = opts?.conversationMode === "inbound";

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
    t.length <= 24 &&
    /^(ok|okay|d'accord|dac|merci|bsr|bonjour|salut|hello|hey|coucou|hi|yo|oui|non|ah bon|je vois|compris)[!?.…]*$/i.test(
      t
    )
  ) {
    if (inbound) {
      return (
        "salutation client ENTRANT — accueil court + demande en quoi tu peux aider (produit) ; " +
        "INTERDIT intro « je vous contacte au sujet de… » / pitch d'ouverture prospection"
      );
    }
    return (
      "salutation / accusé court — si TU as déjà envoyé le 1er message : " +
      "INTERDIT de te présenter ou de parler comme s'il avait initié " +
      "(« ravi d'échanger », « merci de votre message » type inbound) ; " +
      "enchaîne naturellement (1 question liée à l'objectif OU 1 détail nouveau)"
    );
  }
  if (/photo|image|pic|visuel|montre[- ]?(moi )?(la |une )?(photo|image)|voir.*(photo|image|produit)/i.test(lower)) {
    return "demande média — confirme l'envoi de la photo produit si disponible en campagne ; sinon demande un détail (modèle/taille)";
  }
  if (isInfoDenseProspectMessage(text)) {
    return (
      "infos MULTIPLES d'un coup — note TOUT (nom/lieu/horaire/taille…) en 1 souffle + UNE question pour la prochaine info manquante ; " +
      "INTERDIT « Merci M. X » / « Noté » seuls"
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
