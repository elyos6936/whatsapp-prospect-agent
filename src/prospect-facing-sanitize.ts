/**
 * Filets anti-fuite : thinking tags + monologue interne / coaching
 * qui ne doivent JAMAIS partir vers un prospect WhatsApp.
 */
import { stripInternalThinking } from "./llm.js";

/** Texte = raisonnement / plan d'action, pas un message au prospect. */
export function looksLikeInternalMonologue(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Tags thinking résiduels
  if (/<\/?think\b/i.test(t) || /redacted_?thinking/i.test(t)) return true;

  // Méta à la 3e personne sur le prospect
  if (
    /^(il|elle|le prospect|la prospecte|la personne|ce contact)\s+(vient de|a |demande|demandé|pose|posé|répond|répondu|dit|vient)/i.test(
      t
    )
  ) {
    return true;
  }

  // Plan d'action / coaching (« je reste… puis je… »)
  if (
    /\bje (reste|dois|vais|compte|décide|choisis)\b.{0,80}\b(puis je|ensuite je|et je (relance|recadre|réponds?))\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Vocabulaire interne campagne / agent
  if (
    /\b(relance vers la mission|recadre sans|tourner en rond|intention (du|détect)|stratégie|chain[- ]?of[- ]?thought|tool_call|create_automation|ab_variants|simulation affichée)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Notes internes type « Action : … » / « Raisonnement : … »
  if (/^(raisonnement|analyse|plan|action|note interne|étape)\s*[:：]/i.test(t)) {
    return true;
  }

  // Tutoiement du prospect dans un monologue (« t'as » OK en message ; « son numéro » + je reste = bad)
  if (/\bson numéro\b/i.test(t) && /\bje (reste|vais|dois|recadre)/i.test(t)) {
    return true;
  }

  return false;
}

/** Nettoie + refuse les monologues (retourne "" si inutilisable). */
export function sanitizeProspectFacingReply(text: string): string {
  let out = stripInternalThinking(String(text ?? ""));
  out = out
    .replace(/^["«]\s*|\s*["»]$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!out) return "";
  if (looksLikeInternalMonologue(out)) return "";
  return out;
}

/** Fallback sûr si le modèle a fuité son raisonnement. */
export function safeFallbackWhatsAppReply(incomingText: string): string {
  const t = incomingText.trim().toLowerCase();
  if (
    /num[eé]ro|d['’]?o[uù]\s+(tu|vous)\s+(as|avez)|comment\s+(tu|vous)\s+(as|avez)\s+(eu|obtenu)|qui\s+(t|vous)\s+a\s+donn/i.test(
      t
    )
  ) {
    return "Je vous ai contacté dans le cadre d'une prospection commerciale. Si ça ne vous convient pas, dites-le-moi et je m'arrête.";
  }
  // Refus dur uniquement — pas « non » / « non je pense pas » (souvent une réponse diagnostic).
  if (/^(non merci|pas int[eé]ress|ne m['’]?[eé]cri)/i.test(t)) {
    return "C'est noté, je ne vous dérange plus. Bonne continuation !";
  }
  if (/qui\s+(êtes|etes|es)-?vous|t['’]es\s+qui|c['’]est\s+qui/i.test(t)) {
    return "Je vous écris pour un échange professionnel rapide — vous avez deux minutes ?";
  }
  return "Bien reçu. Pour avancer clairement : qu'est-ce qui vous intéresserait le plus de mon côté ?";
}
