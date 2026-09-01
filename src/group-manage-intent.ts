/**
 * Intents groupes hors publication : ajouter / retirer / admin / lien / quitter.
 * Symbolique (regex + history-resolve) — l'IA ne doit pas les détourner vers « quel texte poster ».
 */

export type GroupManageAction = "add" | "remove" | "promote" | "demote";

export type GroupManageIntent = {
  action: GroupManageAction;
  phones: string[];
  groupQuery: string;
  /** Prénom / nom cité (« Retire Eusebe du groupe X ») — résolu via membres du groupe. */
  contactName?: string;
};

const PHONE_RE = /(?:\+|00)?(?:229)?[\s.\-]*(?:01[\s.\-]*)?\d(?:[\s.\-]*\d){6,13}/g;

export function extractPhonesFromText(text: string): string[] {
  const cleaned = String(text ?? "").replace(
    /\b\d[\d\s.,]{0,12}\s*(?:fcfa|f\b|€|euros?)\b/gi,
    " "
  );
  const hits = cleaned.match(PHONE_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hits) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    if (/^0+$/.test(digits)) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(raw.replace(/\s+/g, "").trim());
  }
  return out;
}

function tidyGroupName(raw: string): string {
  return raw
    .replace(/^[«"']+/, "")
    .replace(/[»"'?.!]+$/u, "")
    .replace(/\s+(?:à|a|au)\s+(?:\+|00)?\d[\d\s.\-]{6,}$/i, "")
    .replace(/\s+(?:à|a)\s+\d{1,2}\s*h\d{0,2}\s*$/i, "")
    .replace(/(?:\+|00)?(?:229)?[\s.\-]*(?:01[\s.\-]*)?\d(?:[\s.\-]*\d){6,13}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** « Retire Eusebe du groupe X » → Eusebe (pas un numéro). */
function extractContactNameFromManage(t: string): string {
  const m =
    t.match(
      /\b(?:retire[rz]?|retirer|enl[eè]ve[rz]?|enlever|ajoute[rz]?|ajouter|invite[rz]?|inviter)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ' -]{1,40}?)\s+du\s+(?:le\s+|mon\s+|mes\s+)?groupes?\b/i
    ) ||
    t.match(
      /\b(?:fais|faire|mets?|promouvoir|promou[a-z]*|nomme)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ' -]{1,40}?)\s+(?:admin\s+)?du\s+(?:le\s+|mon\s+|mes\s+)?groupes?\b/i
    );
  const name = m?.[1]?.trim() ?? "";
  if (!name || name.length < 2) return "";
  if (/^\+?\d[\d\s.\-]{6,}$/.test(name)) return "";
  if (/^(le|la|les|mon|ma|mes|un|une)$/i.test(name)) return "";
  return name;
}

/** Nom de groupe dans une question assistant (« retirer dans « X » »). */
function extractGroupFromAssistantAsk(content: string): string | null {
  const m = content.match(/dans\s+[«"']\s*(.+?)\s*[»"']/i);
  if (!m?.[1]) return null;
  const name = tidyGroupName(m[1].trim());
  return name.length >= 2 ? name : null;
}

export function extractGroupAfterKeyword(t: string): string {
  const m =
    t.match(
      /\b(?:dans|du|de|au|aux)\s+(?:le|la|les|mon|ma|mes|ce|cet|ces)?\s*groupes?\s+(.+)$/i
    ) || t.match(/\bgroupes?\s+(.+)$/i);
  if (!m?.[1]) return "";
  return tidyGroupName(m[1]);
}

export function detectGroupManageIntent(msg: string): GroupManageIntent | null {
  const t = msg.trim();
  if (!t || t.length > 280) return null;
  if (!/\bgroupes?\b/i.test(t) && !/\b(membres?|participants?)\b/i.test(t)) {
    return null;
  }

  let action: GroupManageAction | null = null;
  if (/\b(ajoute[rz]?|ajouter)\b/i.test(t)) action = "add";
  else if (
    !/\bje\s+suis\s+admin\b/i.test(t) &&
    /\b(promou[a-z]*|fais|faire|mets?|rends?|nomme)\b.{0,48}\badmin\b/i.test(t)
  ) {
    action = "promote";
  } else if (
    /\b(r[eé]trograde|retire\s+(les\s+)?(droits?\s+)?admin|enl[eè]ve\s+admin)\b/i.test(t)
  ) {
    action = "demote";
  } else if (
    /\b(retire[rz]?|retirer|enl[eè]ve[rz]?|enlever|supprime[rz]?\s+du\s+groupe)\b/i.test(t)
  ) {
    action = "remove";
  } else if (/\b(invite[rz]?|inviter)\b/i.test(t) && extractPhonesFromText(t).length) {
    action = "add";
  }
  if (!action) return null;

  const phones = extractPhonesFromText(t);
  if (action === "add" && !phones.length && /\b(post|message|texte|annonce)\b/i.test(t)) {
    return null;
  }

  const groupQuery = extractGroupAfterKeyword(t);
  const contactName = phones.length ? "" : extractContactNameFromManage(t);
  if (!phones.length && !groupQuery && !contactName) return null;
  return { action, phones, groupQuery, ...(contactName ? { contactName } : {}) };
}

export function looksLikeAdminConfirmation(msg: string): boolean {
  const t = msg.trim();
  if (!t || t.length > 100) return false;
  if (/\?/.test(t)) return false;
  return (
    /^(oui|ouais|ok|okay|d['’]accord)\b.{0,40}\badmin\b/i.test(t) ||
    /\bje\s+suis\s+admin\b/i.test(t) ||
    /^je\s+suis\s+admin\b/i.test(t)
  );
}

export type GroupInviteLinkIntent = {
  action: "get_code" | "revoke_code";
  groupQuery: string;
};

export function detectGroupInviteLinkIntent(msg: string): GroupInviteLinkIntent | null {
  const t = msg.trim();
  if (!t || t.length > 200) return null;
  const wantsLink =
    /\blien(\s+d['’]invitation)?\b/i.test(t) ||
    /\bcode\s+d['’]invitation\b/i.test(t) ||
    /\binvite[- ]?code\b/i.test(t);
  if (!wantsLink) return null;
  if (!/\b(invitation|invite|groupe)\b/i.test(t)) return null;
  // Poster un texto (même si le nom du groupe contient « code ») ≠ lien
  if (
    /\b(envoie[rz]?|envoyer|poste[rz]?|publie[rz]?|programme[rz]?)\b/i.test(t) &&
    (/[«"']/.test(t) || /\b(message|texte|annonce)\b/i.test(t))
  ) {
    return null;
  }
  if (/\b(envoie|envoyer|poste|publie)\b/i.test(t) && extractPhonesFromText(t).length) {
    return null;
  }
  const revoke = /\b(r[eé]voque|r[eé]voquer|reset|r[eé]g[eé]n[eè]re)\b/i.test(t);
  return {
    action: revoke ? "revoke_code" : "get_code",
    groupQuery: extractGroupAfterKeyword(t),
  };
}

/** « envoie le lien d'invitation à +229… du groupe X » */
export function detectGroupInviteSendIntent(
  msg: string
): { phones: string[]; groupQuery: string } | null {
  const t = msg.trim();
  if (!t || t.length > 240) return null;
  if (!/\b(lien|invitation)\b/i.test(t)) return null;
  if (!/\b(envoie|envoyer|partage|transmets?)\b/i.test(t)) return null;
  const phones = extractPhonesFromText(t);
  if (!phones.length || !/\bgroupes?\b/i.test(t)) return null;
  return { phones, groupQuery: extractGroupAfterKeyword(t) };
}

const WA_INVITE_RE = /(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]{8,})/i;

export function detectJoinGroupInviteIntent(msg: string): { inviteCode: string } | null {
  const t = msg.trim();
  if (!t || t.length > 280) return null;
  const m = t.match(WA_INVITE_RE);
  if (!m?.[1]) return null;
  if (/\b(info|infos|c['’]est quoi|d[eé]tail)\b/i.test(t) && !/\b(rejoins|accepte|entre|join)\b/i.test(t)) {
    return null;
  }
  return { inviteCode: m[1] };
}

export function detectCreateGroupIntent(
  msg: string
): { subject: string; phones: string[] } | null {
  const t = msg.trim();
  if (!t || t.length > 240) return null;
  if (!/\b(cr[eé]e[rz]?|cr[eé]er)\b/i.test(t) || !/\bgroupe\b/i.test(t)) return null;
  if (/\b(campagne|automatisation|diffusion|brouillon|r[eè]gle)\b/i.test(t)) return null;
  const phones = extractPhonesFromText(t);
  const named =
    t.match(/\bgroupes?\s+(?:appel[eé]|nomm[eé]|nom)\s+(.+?)(?:\s+avec|\s*$)/i) ||
    t.match(/\bcr[eé]e[rz]?(?:-moi)?\s+(?:un\s+|le\s+)?groupe\s+(.+?)(?:\s+avec|\s*$)/i);
  let subject = tidyGroupName(named?.[1] ?? "");
  // « Je veux créer un groupe » / « crée un groupe » sans nom → ask nom (pas null)
  if (/^(?:un|le|la|les|mon|ma|mes|whatsapp|wa)$/i.test(subject)) subject = "";
  if (!subject && !phones.length) return { subject: "", phones: [] };
  if (/^(whatsapp|wa)$/i.test(subject)) return { subject: "", phones };
  return { subject, phones };
}

/** Assistant a demandé un participant pour finaliser create_whatsapp_group. */
const CREATE_GROUP_ASK_PHONE_RE =
  /(?:quel\s+\*{0,2}num[eé]ro\*{0,2}\s+ajouter|au\s+moins\s+1\s+participant|exige\s+au\s+moins\s+1\s+participant)[\s\S]{0,80}[«"']\s*(.+?)\s*[»"']/i;

/**
 * Suite multi-tour : « Crée un groupe X » → ask numéro → « +229… ».
 * Sans ça, un numéro seul sur un fil Prospection hard-return le slot horaire.
 */
export function resolveCreateGroupIntentFromHistory(
  userMessage: string,
  history: Array<{ role: string; content: string }>
): { subject: string; phones: string[] } | null {
  const current = detectCreateGroupIntent(userMessage);
  if (current?.subject && current.phones.length) return current;

  const phones =
    current?.phones?.length ? current.phones : extractPhonesFromText(userMessage);
  if (!phones.length) return current;

  const prior = [...history];
  const last = prior.at(-1);
  if (last?.role === "user" && last.content === userMessage) {
    prior.pop();
  }

  if (current?.subject) {
    return { subject: current.subject, phones };
  }

  // Dernier message assistant : « Quel numéro ajouter dans « Nom » ? »
  for (let i = prior.length - 1; i >= 0; i--) {
    const m = prior[i];
    if (m.role !== "assistant") continue;
    const ask = m.content.match(CREATE_GROUP_ASK_PHONE_RE);
    if (ask?.[1]) {
      const subject = tidyGroupName(ask[1]);
      if (subject) return { subject, phones };
    }
    break;
  }

  // Fallback : dernière demande user « crée un groupe … »
  const named = [...prior]
    .reverse()
    .map((m) => (m.role === "user" ? detectCreateGroupIntent(m.content) : null))
    .find((x) => x && (x.subject || x.phones.length));
  if (named?.subject) return { subject: named.subject, phones };

  return current;
}

export function detectLeaveGroupIntent(msg: string): { groupQuery: string } | null {
  const t = msg.trim();
  if (!t || t.length > 160) return null;
  if (!/\b(quitte[rz]?|quitter)\b/i.test(t) || !/\bgroupe\b/i.test(t)) return null;
  return { groupQuery: extractGroupAfterKeyword(t) };
}

/** Toute action groupe qui n'est PAS « poster / campagne ». */
export function isGroupNonPublishAction(msg: string): boolean {
  return (
    Boolean(detectGroupManageIntent(msg)) ||
    Boolean(detectGroupInviteLinkIntent(msg)) ||
    Boolean(detectGroupInviteSendIntent(msg)) ||
    Boolean(detectJoinGroupInviteIntent(msg)) ||
    Boolean(detectCreateGroupIntent(msg)) ||
    Boolean(detectLeaveGroupIntent(msg)) ||
    looksLikeAdminConfirmation(msg)
  );
}

export function resolveManageIntentFromHistory(
  userMessage: string,
  history: Array<{ role: string; content: string }>
): GroupManageIntent | null {
  const current = detectGroupManageIntent(userMessage);
  if (current?.phones.length && current.groupQuery) return current;

  const prior = [...history];
  const last = prior.at(-1);
  if (last?.role === "user" && last.content === userMessage) {
    prior.pop();
  }

  if (current?.phones.length && !current.groupQuery) {
    const named = [...prior]
      .reverse()
      .map((m) => (m.role === "user" ? detectGroupManageIntent(m.content) : null))
      .find((x) => x?.groupQuery);
    if (named?.groupQuery) {
      return { ...current, groupQuery: named.groupQuery };
    }
  }

  if (looksLikeAdminConfirmation(userMessage)) {
    const lastManage = [...prior]
      .reverse()
      .map((m) => (m.role === "user" ? detectGroupManageIntent(m.content) : null))
      .find((x) => x?.phones.length && x.groupQuery);
    if (lastManage) return lastManage;
  }

  // GAP-001 : numéro seul après « Quel numéro ajouter dans « X » ? »
  const phones = extractPhonesFromText(userMessage);
  const phoneOnly =
    phones.length > 0 &&
    !current &&
    !/\bgroupes?\b/i.test(userMessage) &&
    userMessage.trim().length < 40;

  if (phoneOnly) {
    const MANAGE_ASK_PHONE_RE =
      /quel\s+\*{0,2}num[eé]ro\*{0,2}\s+(ajouter|retirer|promouvoir\s+admin|r[eé]trograder)(?:\s+dans\s+[«"']\s*(.+?)\s*[»"'])?/i;
    const actionFromLabel = (label: string): GroupManageAction | null => {
      const l = label.toLowerCase();
      if (l.startsWith("ajouter")) return "add";
      if (l.startsWith("retirer")) return "remove";
      if (l.startsWith("promouvoir")) return "promote";
      if (l.startsWith("rétrograder") || l.startsWith("retrograder")) return "demote";
      return null;
    };
    for (let i = prior.length - 1; i >= 0; i--) {
      const m = prior[i];
      if (m.role !== "assistant") continue;
      const ask = m.content.match(MANAGE_ASK_PHONE_RE);
      const groupFromAsk = extractGroupFromAssistantAsk(m.content);
      if (ask || groupFromAsk) {
        const action = ask ? actionFromLabel(ask[1] ?? "") : null;
        const groupQuery = tidyGroupName(
          groupFromAsk || ask?.[2]?.trim() || ""
        );
        const resolvedAction =
          action ??
          [...prior]
            .reverse()
            .map((x) => (x.role === "user" ? detectGroupManageIntent(x.content) : null))
            .find((x) => x?.action)?.action ??
          "remove";
        if (groupQuery) {
          return { action: resolvedAction, phones, groupQuery };
        }
      }
      break;
    }
    const named = [...prior]
      .reverse()
      .map((m) => (m.role === "user" ? detectGroupManageIntent(m.content) : null))
      .find((x) => x?.groupQuery);
    if (named?.groupQuery) {
      return { action: named.action, phones, groupQuery: named.groupQuery };
    }
  }

  return current;
}

const INVITE_LINK_ASK_RE =
  /de quel groupe veux-tu le lien|quel groupe.{0,60}lien d['’]invitation|lien d['’]invitation.{0,40}quel groupe/i;

export function resolveInviteLinkFromHistory(
  userMessage: string,
  history: Array<{ role: string; content: string }>
): GroupInviteLinkIntent | null {
  const current = detectGroupInviteLinkIntent(userMessage);
  if (current?.groupQuery) return current;

  const prior = [...history];
  const last = prior.at(-1);
  if (last?.role === "user" && last.content === userMessage) {
    prior.pop();
  }

  if (current && !current.groupQuery) {
    const named = [...prior]
      .reverse()
      .map((m) => (m.role === "user" ? detectGroupInviteLinkIntent(m.content) : null))
      .find((x) => x?.groupQuery);
    if (named?.groupQuery) return { ...current, groupQuery: named.groupQuery };
  }

  if (looksLikeAdminConfirmation(userMessage)) {
    const lastInvite = [...prior]
      .reverse()
      .map((m) => (m.role === "user" ? detectGroupInviteLinkIntent(m.content) : null))
      .find((x) => x?.groupQuery);
    if (lastInvite) return lastInvite;
  }

  // GAP-003 : nom seul après « De quel groupe veux-tu le lien… ? »
  const bare = userMessage.trim();
  const bareOk =
    bare.length >= 2 &&
    bare.length <= 80 &&
    !/\n|\?/.test(bare) &&
    !/^[\d+\s.\-()]{6,}$/.test(bare) &&
    /[A-Za-zÀ-ÿ]/.test(bare) &&
    !/\b(oui|non|ok|ajoute|envoie|quitte)\b/i.test(bare);

  if (bareOk && !current) {
    for (let i = prior.length - 1; i >= 0; i--) {
      const m = prior[i];
      if (m.role !== "assistant") continue;
      if (INVITE_LINK_ASK_RE.test(m.content)) {
        const priorIntent = [...prior]
          .reverse()
          .map((x) => (x.role === "user" ? detectGroupInviteLinkIntent(x.content) : null))
          .find((x) => x);
        return {
          action: priorIntent?.action ?? "get_code",
          groupQuery: bare,
        };
      }
      break;
    }
  }

  return current;
}

const INVITE_SEND_ASK_GROUP_RE =
  /pour quel groupe envoyer l['’]invitation à\s+(.+?)\s*\?/i;

/**
 * GAP-002 : suite « envoie le lien … » → numéro / nom de groupe manquant.
 */
export function resolveInviteSendFromHistory(
  userMessage: string,
  history: Array<{ role: string; content: string }>
): { phones: string[]; groupQuery: string } | null {
  const current = detectGroupInviteSendIntent(userMessage);
  if (current?.phones.length && current.groupQuery) return current;

  const prior = [...history];
  const last = prior.at(-1);
  if (last?.role === "user" && last.content === userMessage) {
    prior.pop();
  }

  const phonesNow = extractPhonesFromText(userMessage);
  const bare = userMessage.trim();
  const bareOk =
    bare.length >= 2 &&
    bare.length <= 80 &&
    !phonesNow.length &&
    !/\n|\?/.test(bare) &&
    /[A-Za-zÀ-ÿ]/.test(bare);

  // Nom de groupe après « Pour quel groupe envoyer l'invitation à +229… ? »
  if (bareOk) {
    for (let i = prior.length - 1; i >= 0; i--) {
      const m = prior[i];
      if (m.role !== "assistant") continue;
      const ask = m.content.match(INVITE_SEND_ASK_GROUP_RE);
      if (ask?.[1]) {
        const phones = extractPhonesFromText(ask[1]);
        if (phones.length) return { phones, groupQuery: bare };
      }
      break;
    }
  }

  // Numéro seul / message avec phones : compléter depuis intent user précédent
  const phones = current?.phones?.length ? current.phones : phonesNow;
  if (phones.length) {
    if (current?.groupQuery) return current;
    const named = [...prior]
      .reverse()
      .map((m) => {
        if (m.role !== "user") return null;
        const full = detectGroupInviteSendIntent(m.content);
        if (full?.groupQuery) return full;
        // « envoie le lien du groupe X » sans numéro
        const t = m.content;
        if (
          /\b(lien|invitation)\b/i.test(t) &&
          /\b(envoie|envoyer|partage)\b/i.test(t) &&
          /\bgroupes?\b/i.test(t)
        ) {
          const gq = extractGroupAfterKeyword(t);
          if (gq) return { phones: [], groupQuery: gq };
        }
        return null;
      })
      .find((x) => x?.groupQuery);
    if (named?.groupQuery) return { phones, groupQuery: named.groupQuery };
  }

  // Partial current with group, waiting phones — not enough alone
  if (current?.groupQuery && !current.phones.length) return current;

  return current;
}

const LEAVE_ASK_RE = /quel groupe veux-tu quitter/i;

/** GAP-004 : « Quitte le groupe » → ask nom → « Automax ». */
export function resolveLeaveGroupIntentFromHistory(
  userMessage: string,
  history: Array<{ role: string; content: string }>
): { groupQuery: string } | null {
  const current = detectLeaveGroupIntent(userMessage);
  if (current?.groupQuery) return current;

  const prior = [...history];
  const last = prior.at(-1);
  if (last?.role === "user" && last.content === userMessage) {
    prior.pop();
  }

  const bare = userMessage.trim();
  const bareOk =
    bare.length >= 2 &&
    bare.length <= 80 &&
    !/\n|\?/.test(bare) &&
    !/^[\d+\s.\-()]{6,}$/.test(bare) &&
    /[A-Za-zÀ-ÿ]/.test(bare) &&
    !/\b(quitte|groupe|oui|non)\b/i.test(bare);

  if (bareOk) {
    for (let i = prior.length - 1; i >= 0; i--) {
      const m = prior[i];
      if (m.role !== "assistant") continue;
      if (LEAVE_ASK_RE.test(m.content)) return { groupQuery: bare };
      break;
    }
    const hadLeave = prior.some(
      (m) => m.role === "user" && Boolean(detectLeaveGroupIntent(m.content)),
    );
    if (hadLeave) {
      for (let i = prior.length - 1; i >= 0; i--) {
        if (prior[i].role !== "assistant") continue;
        if (LEAVE_ASK_RE.test(prior[i].content) || /groupe/i.test(prior[i].content)) {
          return { groupQuery: bare };
        }
        break;
      }
    }
  }

  return current;
}
