/**
 * Détection d'intentions listes groupes / membres.
 * Isolé pour tests unitaires (pluriel FR, guillemets, limites numériques).
 */

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

/** Un message qui n'est qu'un nom de groupe (suite après « groupe introuvable »). */
export function looksLikeBareGroupName(msg: string): boolean {
  const t = msg.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/\n/.test(t) || /\?/.test(t)) return false;
  if (/^(oui|ouais|non|nan|ok|okay|d['’]accord|dac|valide|je\s+valide)\b/i.test(t)) {
    return false;
  }
  if (
    /\b(donne|liste|lister|montre|membres?|participants?|contacts?|envoie|envoyer|poste|publie|campagne|brouillon|active|lance|lancer|ajoute|retire)\b/i.test(
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
