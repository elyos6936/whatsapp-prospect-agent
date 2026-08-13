/**
 * Vague 4 — filet D sur le texte exact du DM (prix + clôture).
 * Aucun nom, numéro ou ID de contact.
 *
 * Ne bloque pas le flux : on recale le montant / on retire une répétition
 * ou un adieu prématuré. Le reste du message LLM reste fluide.
 */
import { alignOutboundVerbalClose } from "./lead-scoring.js";

export type ChatHistoryLine = { direction: string; body: string };

export type PriceCloseGuardFlags = {
  invented: boolean;
  injected: boolean;
  strippedRepeat: boolean;
  strippedInvented: boolean;
  prematureClose: boolean;
};

export type PriceCloseGuardResult = PriceCloseGuardFlags & {
  reply: string;
  notes: string[];
};

const PRICE_ASK_RE =
  /\b(combien|prix|tarif|budget)\b|co[uû]te?|c['’ ]?est combien|quel (est )?(le )?prix|c['’ ]?est quel tarif/i;

/** Parle du tarif principal — pas un à-côté (frais, pointure…). */
const MAIN_PRICE_TALK_RE = /\b(prix|tarif)\b|c['’]est\s+\d/i;
const SECONDARY_AMOUNT_RE =
  /\b(livraison|frais|pointure|quantit[eé]|palier)\b/i;

const YEAR_RE = /^(202[0-9]|203[0-5])$/;

export function compactPriceDigits(price: string | null | undefined): string {
  return String(price ?? "").replace(/\D/g, "");
}

export function incomingAsksPrice(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return PRICE_ASK_RE.test(t);
}

/** Montants type tarif (4–7 chiffres), hors URL / année. */
export function extractMoneyAmounts(text: string): string[] {
  const stripped = String(text ?? "").replace(/https?:\/\/\S+/gi, " ");
  const amounts: string[] = [];
  const re = /\b(\d{1,3}(?:[\s.\u00a0]\d{3})+|\d{4,7})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const digits = m[1].replace(/\D/g, "");
    if (!digits || YEAR_RE.test(digits)) continue;
    amounts.push(digits);
  }
  return amounts;
}

export function incomingMentionsAmount(text: string): boolean {
  return extractMoneyAmounts(text).length > 0;
}

export function textContainsConfiguredPrice(
  text: string,
  configuredPrice: string | null | undefined
): boolean {
  const want = compactPriceDigits(configuredPrice);
  if (want.length < 3) return false;
  return extractMoneyAmounts(text).includes(want);
}

export function outboundAlreadyStatedPrice(
  history: ChatHistoryLine[],
  configuredPrice: string | null | undefined
): boolean {
  const want = compactPriceDigits(configuredPrice);
  if (want.length < 3) return false;
  return history
    .filter((m) => m.direction === "sortant")
    .slice(-8)
    .some((m) => textContainsConfiguredPrice(m.body, configuredPrice));
}

function numericPriceDisplay(configured: string): string {
  const t = configured.replace(/\s*(fcfa|f\s*cfa|euros?|€)\s*/gi, "").trim();
  return t || configured.trim();
}

function shouldReplaceAmount(
  digits: string,
  configuredDigits: string,
  window: string
): boolean {
  if (digits === configuredDigits) return false;
  if (YEAR_RE.test(digits)) return false;
  if (SECONDARY_AMOUNT_RE.test(window)) return false;
  if (digits.length === configuredDigits.length && digits.length >= 4) return true;
  return MAIN_PRICE_TALK_RE.test(window) && digits.length >= 4;
}

function replaceForeignAmounts(
  text: string,
  configuredDigits: string,
  configuredDisplay: string
): { text: string; replaced: boolean } {
  const display = numericPriceDisplay(configuredDisplay);
  let replaced = false;
  const next = text.replace(
    /\b(\d{1,3}(?:[\s.\u00a0]\d{3})+|\d{4,7})\b/g,
    (full, _g: string, offset: number) => {
      const digits = full.replace(/\D/g, "");
      if (YEAR_RE.test(digits) || digits === configuredDigits) return full;
      const start = Math.max(0, offset - 48);
      const end = Math.min(text.length, offset + full.length + 24);
      const window = text.slice(start, end);
      if (!shouldReplaceAmount(digits, configuredDigits, window)) return full;
      replaced = true;
      return display;
    }
  );
  return { text: next, replaced };
}

function appendConfiguredPrice(text: string, configured: string): string {
  const add = `C'est ${configured.trim()}.`;
  const t = text.trim();
  if (!t) return add;
  return /[.!?…]$/.test(t) ? `${t} ${add}` : `${t}. ${add}`;
}

function stripPriceRestatement(text: string, configured: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    // Une seule phrase : on ne vide pas le DM, on retire juste le montant.
    if (!textContainsConfiguredPrice(text, configured)) return text;
    if (/\?/.test(text) || /https?:\/\//i.test(text)) return text;
    const stripped = text
      .replace(/\b(\d{1,3}(?:[\s.\u00a0]\d{3})+|\d{4,7})\b(?:\s*(?:fcfa|f\b|euros?|€))?/gi, "")
      .replace(/\b(c['’]est|prix|tarif)\b[:\s,]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.!?…])/g, "$1")
      .trim();
    return stripped.length >= 12 ? stripped : text;
  }
  const kept = sentences.filter((s) => {
    if (!textContainsConfiguredPrice(s, configured)) return true;
    if (/\?/.test(s) || /https?:\/\//i.test(s)) return true;
    const withoutDigits = s.replace(/\d/g, "").trim();
    return withoutDigits.length > 80;
  });
  if (!kept.length) return text;
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function stripInventedPriceSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const kept = sentences.filter((s) => extractMoneyAmounts(s).length === 0);
  const next = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return next;
}

export function alignOutboundPrice(
  reply: string,
  opts: {
    incomingText: string;
    configuredPrice?: string | null;
    history?: ChatHistoryLine[];
  }
): Omit<PriceCloseGuardResult, "prematureClose" | "notes"> & { notes: string[] } {
  const configured = String(opts.configuredPrice ?? "").trim();
  const want = compactPriceDigits(configured);
  const incoming = String(opts.incomingText ?? "");
  const history = opts.history ?? [];
  const asks =
    incomingAsksPrice(incoming) || incomingMentionsAmount(incoming);
  const already = outboundAlreadyStatedPrice(history, configured);

  let text = String(reply ?? "").trim();
  let invented = false;
  let injected = false;
  let strippedRepeat = false;
  let strippedInvented = false;
  const notes: string[] = [];

  if (want.length >= 3) {
    const swapped = replaceForeignAmounts(text, want, configured);
    if (swapped.replaced) {
      text = swapped.text;
      invented = true;
      notes.push(
        "⚠️ Prix inventé recalé sur le tarif config. Campagne non arrêtée."
      );
    }
    if (asks && !textContainsConfiguredPrice(text, configured)) {
      text = appendConfiguredPrice(text, configured);
      injected = true;
      notes.push(
        "ℹ️ Prix config injecté — question prix, montant absent de la réponse."
      );
    }
    if (!asks && already && textContainsConfiguredPrice(text, configured)) {
      const stripped = stripPriceRestatement(text, configured);
      if (stripped !== text) {
        text = stripped;
        strippedRepeat = true;
        notes.push(
          "ℹ️ Prix déjà communiqué — répétition retirée du DM."
        );
      }
    }
  } else if (asks && extractMoneyAmounts(text).length > 0) {
    const stripped = stripInventedPriceSentences(text);
    text =
      stripped.length >= 8
        ? stripped
        : "Je vous confirme le tarif juste après.";
    strippedInvented = true;
    notes.push(
      "⚠️ Prix inventé retiré — aucun tarif en config. Campagne non arrêtée."
    );
  }

  return {
    reply: text.replace(/\s{2,}/g, " ").trim(),
    invented,
    injected,
    strippedRepeat,
    strippedInvented,
    notes,
  };
}

/**
 * Prix puis clôture : un adieu LLM n'est définitif que si une action D
 * est déjà livrée (délègue à alignOutboundVerbalClose, Vague 2).
 */
export function applyWhatsAppReplyGuard(
  reply: string,
  opts: {
    incomingText: string;
    configuredPrice?: string | null;
    history?: ChatHistoryLine[];
    closingGoal?: string | null;
    closingLink?: string | null;
  }
): PriceCloseGuardResult {
  const priced = alignOutboundPrice(reply, opts);
  const closed = alignOutboundVerbalClose(
    priced.reply,
    opts.incomingText,
    opts.history ?? [],
    {
      closingGoal: opts.closingGoal ?? null,
      closingLink: opts.closingLink ?? null,
    }
  );
  const notes = [...priced.notes];
  if (closed.premature) {
    notes.push(
      "⚠️ Clôture orale sans objectif D. Message recadré, campagne non arrêtée."
    );
  }
  return {
    reply: closed.reply,
    invented: priced.invented,
    injected: priced.injected,
    strippedRepeat: priced.strippedRepeat,
    strippedInvented: priced.strippedInvented,
    prematureClose: closed.premature,
    notes,
  };
}
