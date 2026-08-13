/**
 * Vague 1 neuro-symbolique — intention explicite pour outils irréversibles.
 * Détecteurs déterministes (regex / état). Aucun LLM.
 * Branché sur HIDDEN_FROM_MINIMAX + intercept d'exécution (agent.ts).
 */
import type { AgentMessage } from "./db.js";

export const HIGH_STAKES_SEND_TOOLS = ["send_whatsapp_message"] as const;

export const HIGH_STAKES_STATUS_TOOLS = ["set_automation_status"] as const;

export const HIGH_STAKES_DELETE_TOOLS = ["delete_automation"] as const;

export const HIGH_STAKES_BLOCK_TOOLS = ["block_contact"] as const;

export const HIGH_STAKES_AUTO_REPLY_TOOLS = ["set_auto_reply"] as const;

export const HIGH_STAKES_GROUP_ADMIN_TOOLS = [
  "create_whatsapp_group",
  "manage_group_participants",
  "group_invite",
  "leave_group",
] as const;

export const HIGH_STAKES_TOOL_NAMES: readonly string[] = [
  ...HIGH_STAKES_SEND_TOOLS,
  ...HIGH_STAKES_STATUS_TOOLS,
  ...HIGH_STAKES_DELETE_TOOLS,
  ...HIGH_STAKES_BLOCK_TOOLS,
  ...HIGH_STAKES_AUTO_REPLY_TOOLS,
  ...HIGH_STAKES_GROUP_ADMIN_TOOLS,
];

const HEDGE_RE =
  /\b(tu peux|peux[- ]tu|pourrais[- ]tu|on (peut|pourrait|devrait)|il faudrait|serait[- ]il possible|est[- ]ce que tu (peux|pourrais)|t'as moyen|t as moyen)\b/i;

const SEND_NEGATION_RE =
  /n['’]envoy(e|ez|er)?\s+pas|ne\s+(l['’]\s*)?envoy(e|ez|er)?\s+pas|ne\s+(lui |leur )?écris\s+pas|ne\s+pas\s+(envoyer|écrire|ecrire)|\bsans\s+envoyer\b|\bpas\s+maintenant\b|\bplus\s+tard\b/i;

const SEND_IMPERATIVE_RE =
  /\b(envoie[rz]?|envois|envoies|envoyer|transmets|transmettre)\b/i;

const WRITE_IMPERATIVE_RE = /\b(écris|ecris|écrire|ecrire)\b/i;

const SEND_NOW_RE = /\b(maintenant|tout de suite|de suite|directement|immédiatement|immediatement)\b/i;

const SEND_TARGET_RE = /\b(lui|leur|à\s+\+?\d|\ba\s+\+?\d|à\s+[A-ZÀ-Ÿ][a-zà-ÿ]{1,20})\b/i;

const PAYLOAD_RE = /[:–—]\s*\S{2,}|[«"][^»"]{2,}[»"]/;

const CAMPAIGN_LAUNCH_RE =
  /\b(campagne|automatisation|prospecter|prospection|membres?( du groupe)?|les 5|variantes?|brouillon)\b/i;

export function isSendNegation(text: string): boolean {
  return SEND_NEGATION_RE.test(text.trim());
}

export function isFuzzySendAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isSendNegation(t)) return false;
  return (
    HEDGE_RE.test(t) &&
    /\b(écrire|ecrire|envoyer|envois|message|lui\s+écrire|lui\s+ecrire)\b/i.test(t)
  );
}

export function isExplicitSendNow(text: string): boolean {
  const t = text.trim();
  if (!t || isSendNegation(t)) return false;
  if (isFuzzySendAsk(t) && !SEND_NOW_RE.test(t) && !PAYLOAD_RE.test(t)) return false;
  // « lance la campagne » / « envoie aux membres » = flux campagne, pas envoi manuel.
  if (CAMPAIGN_LAUNCH_RE.test(t) && !PAYLOAD_RE.test(t) && !SEND_TARGET_RE.test(t)) {
    return false;
  }
  const imperative = SEND_IMPERATIVE_RE.test(t) || WRITE_IMPERATIVE_RE.test(t);
  if (!imperative) return false;
  if (SEND_NOW_RE.test(t)) return true;
  if (PAYLOAD_RE.test(t)) return true;
  if (SEND_IMPERATIVE_RE.test(t) && SEND_TARGET_RE.test(t) && t.length <= 160) {
    // « envoie-lui ça » sans payload / maintenant = encore trop flou
    return false;
  }
  return false;
}

export function recentAssistantAskedSendConfirm(history: AgentMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === "assistant");
  if (!last?.content) return false;
  const c = last.content;
  const aboutSend =
    /j['’]?(lui |leur )?(envoie|écris|ecris)|je (peux |vais )?(lui |leur )?(envoyer|écrire|ecrire)|on (lui |leur )?(envoie|écrit)|confirm(e|er).{0,48}(envoi|message|texte)|je lui envoie/i.test(
      c
    );
  const asks =
    /[?？]/.test(c) ||
    /\b(oui|non|je (le )?fais|j['’]envoie)\b/i.test(c);
  return aboutSend && asks;
}

export function isSendConfirmReply(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120 || isSendNegation(t)) return false;
  if (isExplicitSendNow(t)) return true;
  if (/\bje\s+valide\b/i.test(t)) return false;
  return /^(oui|ouais|ok|okay|vas[- ]?y|go|envoie[rz]?|d['’]accord|dac)([!.\s:]|$)/i.test(t);
}

export function allowsManualSend(history: AgentMessage[], userMessage: string): boolean {
  if (isExplicitSendNow(userMessage)) return true;
  if (recentAssistantAskedSendConfirm(history) && isSendConfirmReply(userMessage)) {
    return true;
  }
  return false;
}

export function isExplicitStatusChange(text: string): boolean {
  const t = text.trim();
  if (!t || HEDGE_RE.test(t)) return false;
  if (
    /\b(campagne|automatisation)\b/i.test(t) &&
    (/\ben pause\b/i.test(t) ||
      /\b(pause|pauser)\b/i.test(t) ||
      /\b(arr[êe]te[rz]?|stoppe[rz]?)\b/i.test(t)) &&
    /\b(mets?|mettre|passe[rz]?|pause|pauser|arr[êe]te[rz]?|stoppe[rz]?)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(reprend[sre]?|reprendre|relance[rz]?)\b.{0,40}\b(campagne|automatisation)\b/i.test(t) ||
    /\b(remet[s]?|remettre)\b.{0,20}\ben (route|marche|ligne|actif)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Nom cité pour une suppression (guillemets ou « campagne X »). */
export function extractNamedCampaignForDelete(text: string): string | null {
  const quoted = /[«"]([^»"]{2,80})[»"]/.exec(text);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const labeled =
    /\b(?:campagne|automatisation)\s+(?:nommée?\s+)?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 '\-]{1,60})/i.exec(
      text
    );
  if (labeled?.[1]?.trim()) return labeled[1].trim().replace(/[.,!?]+$/, "");
  const afterVerb =
    /\b(?:supprime[rz]?|efface[rz]?)\s+(?:la\s+|cette\s+)?(?:campagne\s+|automatisation\s+)?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ0-9 '\-]{1,60})/i.exec(
      text
    );
  const name = afterVerb?.[1]?.trim().replace(/[.,!?]+$/, "") ?? "";
  if (name.length >= 2 && !/^(la|le|les|cette|ce|campagne|automatisation)$/i.test(name)) {
    return name;
  }
  return null;
}

export function isExplicitDeleteAutomation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!/\b(supprime[rz]?|supprimer|efface[rz]?|effacer)\b/i.test(t)) return false;
  if (HEDGE_RE.test(t)) return false;
  return extractNamedCampaignForDelete(t) != null;
}

export function isExplicitBlockContact(text: string): boolean {
  const t = text.trim();
  if (!t || HEDGE_RE.test(t)) return false;
  if (!/\b(bloque[rz]?|bloquer|blacklist)\b/i.test(t)) return false;
  return (
    /\+?\d[\d\s.\-]{6,}\d/.test(t) ||
    /\b(ce|cet|cette)\s+(num[eé]ro|contact|prospect|personne)\b/i.test(t) ||
    /\b(le|la)\s+(bloquer|bloque)\b/i.test(t) ||
    /\bbloque[rz]?[- ]?(le|la|lui|ce|cet)\b/i.test(t)
  );
}

export function isExplicitAutoReplyToggle(text: string): boolean {
  const t = text.trim();
  if (!t || HEDGE_RE.test(t)) return false;
  const verb =
    /\b(active[rz]?|d[eé]sactive[rz]?|coupe[rz]?|allume[rz]?|[ée]teins?|stoppe[rz]?)\b/i.test(t);
  const target =
    /\b(auto[- ]?reply|r[eé]ponses?\s+auto(matiques?)?|r[eé]ponse\s+automatique)\b/i.test(t);
  return verb && target;
}

export function isExplicitGroupAdminAction(text: string): boolean {
  const t = text.trim();
  if (!t || HEDGE_RE.test(t)) return false;
  if (/\b(cr[eé]e[rz]?|cr[eé]er)\b.{0,48}\bgroupe\b/i.test(t)) return true;
  if (/\b(quitte[rz]?|quitter)\b.{0,32}\bgroupe\b/i.test(t)) return true;
  if (
    /\b(ajoute[rz]?|ajouter|retire[rz]?|retirer|enl[eè]ve[rz]?|enlever)\b/i.test(t) &&
    /\b(groupe|participant|membre)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\b(lien d['’]invitation|code d['’]invitation|invite[- ]?code|renvoie.{0,20}invitation)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(invite[rz]?|inviter)\b.{0,40}\b(groupe|dans le groupe)\b/i.test(t)) return true;
  if (
    !/\bje\s+suis\s+admin\b/i.test(t) &&
    /\b(promou[a-z]*|fais|faire|mets?|rends?|nomme)\b.{0,48}\badmin\b/i.test(t) &&
    /\b(groupe|membre|participant)\b/i.test(t)
  ) {
    return true;
  }
  if (/(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9_-]{8,}/i.test(t)) return true;
  return false;
}

export function resolveAllowedHighStakesTools(opts: {
  userMessage: string;
  recentHistory: AgentMessage[];
}): Set<string> {
  const allowed = new Set<string>();
  const { userMessage, recentHistory } = opts;
  if (allowsManualSend(recentHistory, userMessage)) {
    for (const n of HIGH_STAKES_SEND_TOOLS) allowed.add(n);
  }
  if (isExplicitStatusChange(userMessage)) {
    for (const n of HIGH_STAKES_STATUS_TOOLS) allowed.add(n);
  }
  if (isExplicitDeleteAutomation(userMessage)) {
    for (const n of HIGH_STAKES_DELETE_TOOLS) allowed.add(n);
  }
  if (isExplicitBlockContact(userMessage)) {
    for (const n of HIGH_STAKES_BLOCK_TOOLS) allowed.add(n);
  }
  if (isExplicitAutoReplyToggle(userMessage)) {
    for (const n of HIGH_STAKES_AUTO_REPLY_TOOLS) allowed.add(n);
  }
  if (isExplicitGroupAdminAction(userMessage)) {
    for (const n of HIGH_STAKES_GROUP_ADMIN_TOOLS) allowed.add(n);
  }
  return allowed;
}

export function highStakesBlockError(toolName: string): string {
  switch (toolName) {
    case "send_whatsapp_message":
      return (
        "ENVOI BLOQUÉ (déterministe). L'utilisateur n'a pas confirmé d'envoyer un message maintenant. " +
        "INTERDIT d'appeler send_whatsapp_message. " +
        "Demande en français : destinataire + texte exact, puis attends « envoie maintenant : … » ou « oui envoie »."
      );
    case "set_automation_status":
      return (
        "STATUT BLOQUÉ. Pas d'ordre explicite de pause/reprise. " +
        "Demande confirmation claire (« mets la campagne X en pause » / « reprends la campagne X »)."
      );
    case "delete_automation":
      return (
        "SUPPRESSION BLOQUÉE. Il faut le verbe supprimer/effacer ET le nom exact de la campagne. " +
        "Demande : « Tu confirmes la suppression de la campagne « NOM » ? »"
      );
    case "block_contact":
      return (
        "BLOCAGE BLOQUÉ. Pas d'ordre explicite de bloquer ce contact. " +
        "Demande confirmation (« bloque ce numéro » / « bloque +229… »)."
      );
    case "set_auto_reply":
      return (
        "AUTO-REPLY BLOQUÉ. Pas d'ordre explicite d'activer/désactiver les réponses auto. " +
        "Demande confirmation (« active les réponses automatiques » / « désactive l'auto-reply »)."
      );
    case "create_whatsapp_group":
    case "manage_group_participants":
    case "group_invite":
    case "leave_group":
      return (
        "ACTION GROUPE BLOQUÉE. Pas d'ordre explicite (créer / ajouter / retirer / quitter / invitation). " +
        "Demande confirmation avec le nom du groupe et l'action."
      );
    default:
      return "Action irréversible bloquée : confirmation explicite de l'utilisateur requise.";
  }
}

export function isHighStakesTool(name: string): boolean {
  return HIGH_STAKES_TOOL_NAMES.includes(name);
}

/** Nudge MiniMax : poser la confirmation, sans exécuter. */
export function highStakesConfirmNudge(
  userMessage: string,
  _history: AgentMessage[],
  allowed: Set<string>
): string | null {
  if (allowed.has("send_whatsapp_message")) return null;
  if (isFuzzySendAsk(userMessage)) {
    return (
      "L'utilisateur n'a PAS confirmé d'envoyer un WhatsApp maintenant. " +
      "INTERDIT d'appeler send_whatsapp_message. " +
      "Pose UNE question courte : destinataire + texte exact, puis attends " +
      "« envoie maintenant : … » ou « oui envoie »."
    );
  }
  if (
    /\b(pause|reprend|supprime|efface|bloque|auto[- ]?reply|r[eé]ponses?\s+auto|cr[eé]e.{0,20}groupe|quitte.{0,16}groupe)\b/i.test(
      userMessage
    ) &&
    allowed.size === 0
  ) {
    return (
      "Action irréversible évoquée mais PAS confirmée explicitement. " +
      "INTERDIT d'appeler set_automation_status / delete_automation / block_contact / " +
      "set_auto_reply / create_whatsapp_group / manage_group_participants / group_invite / leave_group. " +
      "Demande une confirmation claire (verbe + cible nommée)."
    );
  }
  return null;
}
