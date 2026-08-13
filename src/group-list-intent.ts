/**
 * Détection d'intentions listes groupes / membres.
 * Isolé pour tests unitaires (pluriel FR, guillemets, limites numériques).
 */
import {
  detectCreateGroupIntent,
  detectGroupInviteLinkIntent,
  detectGroupInviteSendIntent,
  detectGroupManageIntent,
  detectJoinGroupInviteIntent,
  detectLeaveGroupIntent,
} from "./group-manage-intent.js";

const FR_NUM: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  quinze: 15,
  vingt: 20,
  trente: 30,
  cinquante: 50,
};

export type QuickGroupMembersIntent = {
  /** Vide = le nom est dans un tour précédent. */
  groupQuery: string;
  limit?: number;
};

export type QuickListIntent = {
  kind: "groups" | "contacts";
  limit?: number;
};

/** « deux » / « 2 » → nombre plafonné. */
export function parseFrenchCount(raw: string): number | undefined {
  const t = raw.trim().toLowerCase();
  if (/^\d{1,3}$/.test(t)) return Math.min(200, Math.max(1, Number(t)));
  if (FR_NUM[t] != null) return FR_NUM[t];
  return undefined;
}

/** Limite optionnelle : « deux membres », « 3 contacts », « liste-moi 5 ». */
export function extractOptionalListLimit(t: string): number | undefined {
  const m =
    t.match(
      /\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente|cinquante|\d{1,3})\s+(?:membres?|participants?|contacts?|groupes?)\b/i
    ) ||
    t.match(/\b(?:membres?|participants?|contacts?|groupes?)\s*[:\-]?\s*(\d{1,3})\b/i) ||
    t.match(/\bliste[- ]?moi\s+(\d{1,3})\b/i);
  if (!m?.[1]) return undefined;
  return parseFrenchCount(m[1]);
}

/**
 * True si l'utilisateur veut AGIR sur un/des groupe(s), pas voir le catalogue.
 * Ex. « prospecter tous les membres de ce groupe », « contacts de ce groupes 'X' ».
 */
export function isGroupActionNotCatalogRequest(t: string): boolean {
  if (/\bprospect/i.test(t)) return true;
  if (
    /\b(membres?|participants?|contacts?)\b/i.test(t) &&
    /\bgroupes?\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(envoie|envoyer|ecris|écrire|ecrire|poste|publie|mentionne|tague|contacte|contacter|lance|lancer|cree|créer|create|ajoute|ajouter|retire|retirer|promou|promouvoir|enl[eè]ve|enlever)\b/i.test(
      t
    ) &&
    /\bgroupes?\b/i.test(t)
  ) {
    return true;
  }
  // « ce groupe(s) » / « le groupe » / « mon groupe » = cible, pas catalogue
  // (ne pas matcher « mes groupes » → catalogue explicite)
  if (
    /\b(ce|cet|ces|du|de\s+ce|au|dans\s+(ce\s+|cet\s+|ces\s+|le\s+|les\s+|mon\s+)?|mon|ma)\s+groupes?\b/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** Demande explicite de voir la liste des groupes WhatsApp. */
export function wantsExplicitGroupCatalog(t: string): boolean {
  if (isGroupActionNotCatalogRequest(t)) return false;

  if (
    /\b(liste|lister|montre|afficher|voir)\b/i.test(t) &&
    /\b(mes\s+)?groupes?\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(quels?|quelles?)\s+(sont\s+)?(mes\s+)?groupes?\b/i.test(t)) {
    return true;
  }
  if (
    /\b(tous|all)\s+(mes\s+|my\s+)?groupes?\b/i.test(t) ||
    /\bgroupes?\s+(whatsapp\s+)?(disponibles?|connectes?|connectés?)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Nom entre guillemets / chevrons français. */
function extractQuotedGroupName(t: string): string | null {
  const m =
    t.match(/['"«]([^'"»]{2,120})['"»]/) ||
    t.match(/['"]([^'"]{2,120})['"]/);
  if (!m?.[1]) return null;
  const q = m[1].replace(/[?.!]+$/, "").trim();
  return q.length >= 2 ? q : null;
}

function cleanGroupQuery(raw: string): string | null {
  let q = raw
    .replace(/^[\s:'"«]+/, "")
    .replace(/[?'"!».]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  // Retirer un éventuel préfixe « groupe(s) » résiduel
  q = q.replace(/^(?:le|la|les|ce|cet|ces|mon|ma|mes)\s+/i, "").trim();
  if (q.length < 2) return null;
  return q;
}

/**
 * Extraction membres / contacts d'un groupe nommé.
 * Gère pluriel FR (« groupes »), guillemets, limite (« deux membres »),
 * et formulations sans le mot « groupe » (« Deux membres de Team MASK »).
 */
export function detectQuickGroupMembersIntent(msg: string): QuickGroupMembersIntent | null {
  const t = msg.trim();
  if (!t || t.length > 240) return null;

  const hasGroupWord = /\bgroupes?\b/i.test(t);
  const hasMemberWord = /\b(membres?|participants?)\b/i.test(t);
  const hasContactWord = /\bcontacts?\b/i.test(t);

  // « contacts » seul = carnet sauf si « groupe » est présent
  const wantsMembers =
    (hasMemberWord && (hasGroupWord || /\b(?:du|de|dans)\s+\S+/i.test(t))) ||
    (hasContactWord && hasGroupWord) ||
    (/\bextraire?\b/i.test(t) && (hasMemberWord || hasContactWord));

  if (!wantsMembers) return null;

  // « liste mes groupes » sans cible précise → catalogue, pas membres
  if (
    /\b(liste|lister|montre|afficher|voir)\b/i.test(t) &&
    /\b(mes|tous|all)\b/i.test(t) &&
    /\bgroupes?\b/i.test(t) &&
    !/\b(?:du|de|dans)\s+(?:ce|cet|ces|le|la|les|mon|ma)?\s*groupes?\b/i.test(t) &&
    !extractQuotedGroupName(t) &&
    !hasMemberWord &&
    !hasContactWord
  ) {
    return null;
  }

  const limit = extractOptionalListLimit(t);

  const quoted = extractQuotedGroupName(t);
  if (quoted) {
    return { groupQuery: quoted, limit };
  }

  const patterns = [
    // « deux membres de Team MASK » / « membres du groupe X » / « contacts de ce groupes X »
    /\b(?:membres?|participants?|contacts?)\s+(?:du|de|dans)\s+(?:ce|cet|ces|le|la|les|mon|ma)?\s*groupes?\s+(.+?)\s*$/i,
    /\b(?:membres?|participants?)\s+(?:du|de|dans)\s+(.+?)\s*$/i,
    /\b(?:du|de|dans)\s+(?:ce|cet|ces|le|la|les|mon|ma)?\s*groupes?\s+(.+?)\s*$/i,
    /\b(?:du|de|dans le|dans)\s+groupes?\s+(.+?)\s*$/i,
    /\bgroupes?\s+(.+?)\s*$/i,
    /\bgroup\s+(.+?)\s*$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m?.[1]) {
      let raw = m[1];
      // « membres de groupe Team MASK » → strip leading groupe
      raw = raw.replace(/^(?:le|la|les|ce|cet|ces|mon|ma|mes)?\s*groupes?\s+/i, "");
      const q = cleanGroupQuery(raw);
      if (q && !/^(?:ce|cet|ces|le|la|les|mon|ma|mes)$/i.test(q)) {
        return { groupQuery: q, limit };
      }
    }
  }
  // « 3 contacts du groupe » sans nom — le nom est dans l'historique.
  return { groupQuery: "", limit };
}

/** Réponse horaire / lancement — jamais un nom de groupe. */
export function looksLikeWhenReply(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;
  if (
    /^(maintenant|tout\s+de\s+suite|imm[eé]diatement|asap|plus\s+tard|aujourd['’]hui|demain|apr[eè]s[- ]demain|ce\s+soir|ce\s+matin|cet\s+apr[eè]s[- ]?midi|hier|matin|soir|apr[eè]s[- ]?midi)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(t)) return true;
  if (/^\d{1,2}\s*h(\d{0,2})?\b/i.test(t)) return true;
  return false;
}

/** L'assistant vient de demander un nom de groupe (extract / introuvable). */
export function lastAssistantAskedForGroupName(
  history: Array<{ role: string; content: string }>
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    return /groupe introuvable|dans quel groupe|de quel groupe|quel groupe veux-tu|nom exact \(copier-coller|copier-coller depuis whatsapp/i.test(
      m.content
    );
  }
  return false;
}

/** Un message qui n'est qu'un nom de groupe (suite après « groupe introuvable »). */
export function looksLikeBareGroupName(msg: string): boolean {
  const t = msg.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/\n/.test(t) || /\?/.test(t)) return false;
  if (looksLikeWhenReply(t)) return false;
  // Phrase / confirmation — laisser l'IA, ne pas chercher un groupe à ce nom
  if (
    /^(oui|ouais|non|nan|ok|okay|d['’]accord|dac|valide|je\s+valide|je\s+suis|j['’]ai|j['’]y\s+suis|c['’]est|bro)\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (/\b(je|tu|il|elle|on|nous|vous|ils|elles)\s+\w+/i.test(t)) return false;
  if (
    /\b(donne|liste|lister|montre|membres?|participants?|contacts?|envoie|envoyer|poste|publie|campagne|brouillon|active|lance|lancer|ajoute|retire|admin|suis|peux|veux|question)\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (/^[\d+\s.\-()]{6,}$/.test(t)) return false;
  return /[A-Za-zÀ-ÿ]/.test(t);
}

function historyWithoutCurrent(
  history: Array<{ role: string; content: string }>,
  userMessage: string
): Array<{ role: string; content: string }> {
  const last = history.at(-1);
  if (last?.role === "user" && last.content === userMessage) {
    return history.slice(0, -1);
  }
  return history;
}

/** Dernier nom de groupe cité (intent nommé, ou nom seul après une demande membres). */
export function lastGroupQueryFromHistory(
  history: Array<{ role: string; content: string }>
): { query: string; limit?: number } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "user") continue;
    const intent = detectQuickGroupMembersIntent(m.content);
    if (intent?.groupQuery) return { query: intent.groupQuery, limit: intent.limit };
    if (looksLikeBareGroupName(m.content)) {
      const before = history.slice(0, i);
      const prior = [...before]
        .reverse()
        .map((x) => (x.role === "user" ? detectQuickGroupMembersIntent(x.content) : null))
        .find((x) => x);
      if (prior) {
        return { query: m.content.trim(), limit: prior.limit };
      }
    }
  }
  return null;
}

/**
 * Relie « 3 contacts du groupe » / un nom seul au groupe déjà cité dans le fil.
 * Préfère le nom le plus récent (correction « RADAR » → « GIT3 … »).
 */
export function resolveMembersIntentFromHistory(
  userMessage: string,
  history: Array<{ role: string; content: string }>
): QuickGroupMembersIntent | null {
  const prior = historyWithoutCurrent(history, userMessage);
  const current = detectQuickGroupMembersIntent(userMessage);
  if (current?.groupQuery) return current;

  const hadMembersAsk =
    Boolean(current) ||
    prior.some((m) => m.role === "user" && Boolean(detectQuickGroupMembersIntent(m.content)));
  if (!hadMembersAsk) return null;

  if (looksLikeBareGroupName(userMessage)) {
    if (!lastAssistantAskedForGroupName(prior)) return null;
    const last = lastGroupQueryFromHistory(prior);
    return {
      groupQuery: userMessage.trim(),
      limit: current?.limit ?? last?.limit,
    };
  }

  if (current && !current.groupQuery) {
    const last = lastGroupQueryFromHistory(prior);
    if (last) return { groupQuery: last.query, limit: current.limit ?? last.limit };
    return { groupQuery: "", limit: current.limit };
  }

  return null;
}

/**
 * Groupe cible du message d'envoi courant — pas l'historique.
 * « Envoie 'Salut' dans le groupe Le labo du no code à 14h »
 * « Non envoie dans le groupe 'Le labo du no code' »
 */
export function extractGroupNameFromPublishMessage(msg: string): string | null {
  const t = msg.trim();
  if (!t) return null;

  const tidy = (raw: string): string | null => {
    const q = raw
      .replace(/\s*,?\s*(?:le\s+)?(?:message|texte|annonce)\b[\s\S]*$/i, "")
      .replace(/^[\s:'"«]+/, "")
      .replace(/[?'"!».]+$/u, "")
      .replace(/\s+/g, " ")
      .trim();
    if (q.length < 2) return null;
    if (/^(ce|cet|ces|le|la|les|mon|ma|mes)$/i.test(q)) return null;
    if (/^(salut|hello|bonjour|coucou|hi|ok|okay)$/i.test(q)) return null;
    return q;
  };

  const quoted = t.match(/\bgroupes?\s+[«"']([^»"']{2,80})[»"']/i);
  if (quoted?.[1]) {
    const q = tidy(quoted[1]);
    if (q) return q;
  }

  const m = t.match(
    /\bgroupes?\s+(.+?)(?:\s+à\s+\d{1,2}\s*h(?:\d{0,2})?|\s+a\s+\d{1,2}\s*h(?:\d{0,2})?|\s*$)/i
  );
  if (m?.[1]) {
    return tidy(
      m[1]
        .replace(/^[«"']+/, "")
        .replace(/[»"']+$/, "")
        .replace(/\s+à\s+\d{1,2}.*$/i, "")
        .trim()
    );
  }
  return null;
}

export type GroupSendNowIntent = {
  groupQuery: string;
  message: string;
  sendAtLocal?: string;
};

/** Texte à poster : guillemets, ou « le message '…' ». */
export function extractSendMessageFromPublish(msg: string): string | null {
  const t = msg.trim();
  const labeled = t.match(
    /\b(?:le\s+)?(?:message|texte|annonce)\s+[''](.+)[''](?:\s+à\s+\d|\s*$)/i
  );
  if (labeled?.[1]?.trim()) return labeled[1].trim().slice(0, 900);

  const fancy = t.match(/[«"]([^»"]{1,800})[»"]/);
  if (fancy?.[1]?.trim()) return fancy[1].trim().slice(0, 900);

  const around = t.match(
    /\b(?:envoie[rz]?|envoyer|poste[rz]?|publie[rz]?|programme[rz]?)(?:\s+juste)?\s+[''](.+)[''](?:\s+dans|\s+à\s+\d|\s*$)/i
  );
  if (around?.[1]?.trim()) return around[1].trim().slice(0, 900);
  return null;
}

export function extractSendAtLocal(msg: string): string | undefined {
  const m = msg.match(/à\s+(\d{1,2})\s*h\s*(\d{0,2})\b/i);
  if (!m) return undefined;
  const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, "0");
  const mm = m[2] ? String(Math.min(59, Number(m[2]))).padStart(2, "0") : "00";
  return `${hh}:${mm}`;
}

/**
 * Envoi / programmation ponctuels — pas une campagne, pas un lien d'invitation.
 * « Envoie "Salut" dans le groupe Automax »
 * « Envoie dans mon groupe le Labo du No code, le message 'Bien c'est parti' à 15h11 »
 */
export function detectGroupSendNowIntent(msg: string): GroupSendNowIntent | null {
  const t = msg.trim();
  if (!t || t.length > 400) return null;
  if (!/\b(envoie[rz]?|envoyer|poste[rz]?|publie[rz]?|programme[rz]?)\b/i.test(t)) {
    return null;
  }
  if (!/\bgroupes?\b/i.test(t)) return null;
  if (/\b(lien d['’]invitation|code d['’]invitation|invite[- ]?code)\b/i.test(t)) {
    return null;
  }
  if (/\blien\b/i.test(t) && !/\b(message|texte|annonce)\b/i.test(t) && !/[«"']/.test(t)) {
    return null;
  }
  const message = extractSendMessageFromPublish(t);
  if (!message) return null;
  const groupQuery = extractGroupNameFromPublishMessage(t) ?? "";
  const sendAtLocal = extractSendAtLocal(t);
  return { groupQuery, message, sendAtLocal };
}

/** Publier / lancer une campagne / envoyer dans un groupe — admin requis. */
export function detectGroupPublishIntent(msg: string): boolean {
  const t = msg.trim();
  if (!t || t.length > 240) return false;
  const members = detectQuickGroupMembersIntent(t);
  if (
    members &&
    !/\b(lance|lancer|envoie|envoyer|poste|publie|campagne|diffusion|active|activer)\b/i.test(t)
  ) {
    return false;
  }
  if (
    /\b(ajoute[rz]?|ajouter|retire[rz]?|retirer|enl[eè]ve[rz]?|invite[rz]?|quitte[rz]?)\b/i.test(
      t
    ) &&
    !/\b(poste[rz]?|publie[rz]?|campagne|diffusion)\b/i.test(t)
  ) {
    return false;
  }
  if (
    /\b(lance[rz]?\s+(la\s+)?campagne|active[rz]?\s+(la\s+)?campagne|lance[rz]?\s+(la\s+)?diffusion)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(envoie[rz]?|poste[rz]?|publie[rz]?|programme[rz]?)\b/i.test(t) &&
    /\b(groupe|campagne|diffusion)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Intentions simples : listes sans boucle LLM. */
export function detectQuickListIntent(msg: string): QuickListIntent | null {
  const t = msg.trim().toLowerCase();
  if (!t || t.length > 160) return null;

  if (detectQuickGroupMembersIntent(msg)) return null;
  if (isGroupActionNotCatalogRequest(t)) return null;

  const limit = extractOptionalListLimit(t);

  if (wantsExplicitGroupCatalog(t)) {
    return { kind: "groups", limit };
  }
  if (
    /\b(contacts?)\b/i.test(t) &&
    /\b(liste|lister|montre|afficher|voir)\b/i.test(t) &&
    !/\bgroupes?\b/i.test(t) &&
    !/\+?\d[\d\s.\-]{7,}\d/.test(t) &&
    !/\bprospect/i.test(t)
  ) {
    return { kind: "contacts", limit };
  }
  return null;
}

/**
 * Action groupe dans CE message — pas un follow-up historique.
 * « lance la campagne » sans « groupe » n'en est pas une (Support / Prospection).
 */
export function isExplicitGroupOperation(msg: string): boolean {
  if (detectGroupManageIntent(msg)) return true;
  if (detectGroupSendNowIntent(msg)) return true;
  if (detectGroupInviteSendIntent(msg)) return true;
  if (detectGroupInviteLinkIntent(msg)) return true;
  if (detectJoinGroupInviteIntent(msg)) return true;
  if (detectCreateGroupIntent(msg)) return true;
  if (detectLeaveGroupIntent(msg)) return true;
  if (detectQuickGroupMembersIntent(msg)) return true;
  if (detectQuickListIntent(msg)) return true;
  if (
    detectGroupPublishIntent(msg) &&
    /\bgroupe/i.test(msg) &&
    /\b(envoie|envoyer|poste|publie|programme)/i.test(msg)
  ) {
    return true;
  }
  return false;
}

/**
 * Chemins rapides groupes : fil Groupes, ou verbe explicite, ou nom seul
 * seulement si l'agent vient de demander le groupe — jamais sur Support.
 */
export function allowGroupQuickPaths(opts: {
  purpose: string | null | undefined;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
}): boolean {
  if (opts.purpose === "groupes") return true;
  if (isExplicitGroupOperation(opts.userMessage)) return true;
  if (opts.purpose === "support") return false;
  const prior = historyWithoutCurrent(opts.history, opts.userMessage);
  return lastAssistantAskedForGroupName(prior) && looksLikeBareGroupName(opts.userMessage);
}
