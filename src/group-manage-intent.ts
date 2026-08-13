/**
 * Intents groupes hors publication : ajouter / retirer / admin / lien / quitter.
 * Symbolique (regex) — l'IA ne doit pas les détourner vers « quel texte poster ».
 */

export type GroupManageAction = "add" | "remove" | "promote" | "demote";

export type GroupManageIntent = {
  action: GroupManageAction;
  phones: string[];
  groupQuery: string;
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
    .replace(/(?:\+|00)?(?:229)?[\s.\-]*(?:01[\s.\-]*)?\d(?:[\s.\-]*\d){6,13}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  if (!phones.length && !groupQuery) return null;
  return { action, phones, groupQuery };
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
  if (!/\b(lien|code)\b/i.test(t)) return null;
  if (!/\b(invitation|invite|groupe)\b/i.test(t)) return null;
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
  const subject = tidyGroupName(named?.[1] ?? "");
  if (!subject && !phones.length) return null;
  if (/^(whatsapp|wa)$/i.test(subject)) return { subject: "", phones };
  return { subject, phones };
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

  return current;
}

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

  return current;
}
