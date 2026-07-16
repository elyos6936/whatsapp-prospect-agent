/**
 * Consentement stickers / emojis — enforcement runtime (pas seulement le prompt).
 */

const YES =
  /\b(oui|ok|okay|d['']accord|vas[- ]y|go|accepte|autoris|avec stickers?|stickers?\s*(ok|oui)|emojis?\s*(ok|oui))\b/i;

export type StickerConsent = "yes" | "no" | "unknown";

function isStickerRefusal(t: string): boolean {
  return (
    /\b(non|pas|sans|refuse|interdit)\b/i.test(t) &&
    /\b(sticker|emoji|smiley|r[eé]action)/i.test(t)
  ) || /\bsans\s+(sticker|emoji)/i.test(t) ||
    /\bpas\s+de\s+(sticker|emoji)/i.test(t) ||
    /\bno\s+sticker/i.test(t);
}

/** Analyse les messages récents du fil agent (user + assistant). */
export function detectStickerConsent(
  messages: Array<{ role: string; content: string }>
): StickerConsent {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m?.content) continue;
    const t = m.content;
    const aboutStickers = /\b(sticker|stickers|emoji|emojis|smiley|r[eé]action)\b/i.test(t);
    if (!aboutStickers) continue;

    if (m.role === "user") {
      if (isStickerRefusal(t)) return "no";
      if (YES.test(t) && !/\bnon\b/i.test(t)) return "yes";
    }
    if (
      m.role === "assistant" &&
      /\bsans\s+(sticker|emoji)|pas\s+de\s+(sticker|emoji)|stickers?\s*[:=]\s*non/i.test(t)
    ) {
      return "no";
    }
    if (
      m.role === "assistant" &&
      /\bstickers?\s*[:=]\s*oui|avec\s+stickers?\s+autoris/i.test(t)
    ) {
      return "yes";
    }
  }
  return "unknown";
}

/** Retire les emojis / pictogrammes d'un texte WhatsApp. */
export function stripEmojis(text: string): string {
  if (!text) return text;
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?…])/g, "$1")
    .trim();
}

/** Limite à maxN emojis (garde les premiers). */
export function limitEmojis(text: string, maxN: number): string {
  if (!text || maxN <= 0) return stripEmojis(text);
  let seen = 0;
  return text
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, (m) => {
      seen += 1;
      return seen <= maxN ? m : "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}
