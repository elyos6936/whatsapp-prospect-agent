/**
 * Vague 3 — garde D générique sur config sensible / profil / pointeur mémoire.
 * Aucun nom, numéro ou ID de contact.
 */
import type { AgentMessage } from "./db.js";
import type { AutomationConfig } from "./db.js";

export const CRITICAL_CONFIG_FIELDS = [
  "price",
  "closing_link",
  "closing_goal",
  "third_party_phone",
] as const;

export type CriticalConfigField = (typeof CRITICAL_CONFIG_FIELDS)[number];

function normalizeLoose(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 1–2 derniers messages user (le plus récent en dernier). */
export function recentUserBlob(
  history: Array<Pick<AgentMessage, "role" | "content">>,
  maxUserTurns = 2
): string {
  return history
    .filter((m) => m.role === "user")
    .slice(-maxUserTurns)
    .map((m) => m.content)
    .join("\n");
}

export function userMentionedPrice(blob: string): boolean {
  const t = normalizeLoose(blob);
  return (
    /\b(prix|tarif|fcfa|francs?|cout|coute|budget|payer)\b/.test(t) ||
    /\b\d[\d\s]{2,}\s*(fcfa|f|euros?)?\b/.test(t)
  );
}

export function userMentionedClosingLink(blob: string): boolean {
  const t = normalizeLoose(blob);
  return (
    /\b(lien|url|http|https|www|calendly|stripe|paypal|pay|landing|reservation|reserver)\b/.test(
      t
    ) || /https?:\/\//i.test(blob)
  );
}

export function userMentionedClosingGoal(blob: string): boolean {
  const t = normalizeLoose(blob);
  return /\b(objectif|closing|livraison|livrer|paiement|payer|rdv|rendez vous|appointment|reservation|lien de)\b/.test(
    t
  );
}

export function userMentionedThirdPartyPhone(blob: string): boolean {
  const t = normalizeLoose(blob);
  if (/\b(livreur|tiers|associe|commercial|notifie|previen[st]|whatsapp du tiers)\b/.test(t)) {
    return true;
  }
  return /\d[\d\s.\-]{6,}\d/.test(blob);
}

const TOPIC_OK: Record<CriticalConfigField, (blob: string) => boolean> = {
  price: userMentionedPrice,
  closing_link: userMentionedClosingLink,
  closing_goal: userMentionedClosingGoal,
  third_party_phone: userMentionedThirdPartyPhone,
};

const FIELD_ERROR: Record<CriticalConfigField, string> = {
  price:
    "PRIX BLOQUÉ : l'utilisateur n'a pas parlé de prix/tarif dans les tours récents. " +
    "Demande le nouveau prix, puis rappelle update_automation_config(price=…).",
  closing_link:
    "LIEN BLOQUÉ : l'utilisateur n'a pas fourni/demandé de lien dans les tours récents. " +
    "Demande l'URL exacte, puis rappelle update_automation_config(closing_link=…).",
  closing_goal:
    "OBJECTIF BLOQUÉ : l'utilisateur n'a pas évoqué l'objectif (lien / paiement / livraison / RDV). " +
    "Confirme l'objectif, puis rappelle update_automation_config(closing_goal=…).",
  third_party_phone:
    "NUMÉRO TIERS BLOQUÉ : l'utilisateur n'a pas donné de numéro / demandé de notif tiers. " +
    "Demande le numéro, puis rappelle update_automation_config(third_party_phone=…).",
};

export function filterCriticalConfigArgs(
  args: Record<string, unknown>,
  recentUserText: string
): { args: Record<string, unknown>; blocked: CriticalConfigField[]; errors: string[] } {
  const next = { ...args };
  const blocked: CriticalConfigField[] = [];
  const errors: string[] = [];
  for (const field of CRITICAL_CONFIG_FIELDS) {
    if (next[field] == null || next[field] === "") continue;
    if (TOPIC_OK[field](recentUserText)) continue;
    delete next[field];
    blocked.push(field);
    errors.push(FIELD_ERROR[field]);
  }
  return { args: next, blocked, errors };
}

export function criticalConfigSnapshot(config: AutomationConfig | null | undefined): {
  price: string;
  closing_link: string;
  closing_goal: string;
  third_party_phone: string;
} {
  return {
    price: String(config?.price ?? "").trim(),
    closing_link: String(config?.closingLink ?? "").trim(),
    closing_goal: String(config?.closingGoal ?? "").trim(),
    third_party_phone: String(config?.thirdPartyNotification?.phone ?? "").trim(),
  };
}

export function criticalConfigDiff(
  before: ReturnType<typeof criticalConfigSnapshot>,
  after: ReturnType<typeof criticalConfigSnapshot>
): Array<{ field: CriticalConfigField; from: string; to: string }> {
  const out: Array<{ field: CriticalConfigField; from: string; to: string }> = [];
  for (const field of CRITICAL_CONFIG_FIELDS) {
    if (before[field] === after[field]) continue;
    out.push({ field, from: before[field] || "(vide)", to: after[field] || "(vide)" });
  }
  return out;
}

export function userAllowsMemorySwitch(recentUserText: string, memoryName: string): boolean {
  const blob = normalizeLoose(recentUserText);
  if (!blob) return false;
  if (/\bmemoire\b/.test(blob)) return true;
  const name = normalizeLoose(memoryName);
  if (name.length >= 3 && blob.includes(name)) return true;
  const first = name.split(" ")[0] ?? "";
  if (first.length >= 4 && blob.includes(first)) return true;
  return false;
}

function valueGivenInFil(value: string, blob: string): boolean {
  const v = normalizeLoose(value);
  if (v.length < 2) return false;
  const b = normalizeLoose(blob);
  if (b.includes(v)) return true;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length >= 3 && b.replace(/\D/g, "").includes(digits)) return true;
  return false;
}

export function filterInventedProfileFields(
  input: { ownerName?: string; offer?: string; price?: string },
  recentUserText: string
): {
  input: { ownerName?: string; offer?: string; price?: string };
  blocked: Array<"owner_name" | "price">;
  errors: string[];
} {
  const next = { ...input };
  const blocked: Array<"owner_name" | "price"> = [];
  const errors: string[] = [];

  if (next.ownerName?.trim() && !valueGivenInFil(next.ownerName, recentUserText)) {
    delete next.ownerName;
    blocked.push("owner_name");
    errors.push(
      "NOM BLOQUÉ : ce prénom/nom n'apparaît pas dans les tours récents. " +
        "Demande comment se présenter, puis rappelle save_business_profile."
    );
  }
  if (next.price?.trim() && !valueGivenInFil(next.price, recentUserText)) {
    delete next.price;
    blocked.push("price");
    errors.push(
      "PRIX PROFIL BLOQUÉ : ce tarif n'apparaît pas dans les tours récents. " +
        "Demande le prix, puis rappelle save_business_profile."
    );
  }
  return { input: next, blocked, errors };
}

export function formatCriticalChangeNote(
  campaignName: string,
  diffs: Array<{ field: CriticalConfigField; from: string; to: string }>
): string {
  const lines = diffs.map((d) => `• ${d.field} : ${d.from} → ${d.to}`).join("\n");
  return `⚠️ Config sensible mise à jour — campagne « ${campaignName} ».\n${lines}`;
}
