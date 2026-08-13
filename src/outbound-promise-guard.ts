/**
 * Vague 5 — filet D : promesse photo/lien dans CE DM.
 * Aucun nom, numéro ou ID de contact.
 *
 * Si le LLM promet un lien/photo dans le message :
 * - ressource en config → on la joint (lien dans le texte / flag média)
 * - ressource absente → on retire la promesse (pas de mensonge au prospect)
 * Les questions (« je vous envoie le lien ? ») restent des offres, pas des promesses.
 */
const URL_IN_TEXT =
  /https?:\/\/\S+|wa\.me\/\S*|chat\.whatsapp\.com\/\S+|bit\.ly\/\S+|calendly\.\S+/i;

const LINK_PROMISE_RE =
  /(?:je (?:vous |te )?(?:l['’])?(?:envoie|enverrai|partage|transmets)|voici|tiens)[^.!?\n]{0,50}\blien\b/i;

const LINK_OFFER_Q_RE =
  /(?:envoie|enverrai|envoyer|partage)[^.!\n]{0,40}\blien\b[^.!\n]{0,12}\?/i;

const MEDIA_PROMISE_RE =
  /(?:je (?:vous |te )?(?:l['’])?(?:envoie|enverrai|partage|transmets)|voici|tiens)[^.!?\n]{0,50}\b(photo|image|visuel|pic|screenshot|capture)\b/i;

const MEDIA_OFFER_Q_RE =
  /(?:envoie|enverrai|envoyer|partage)[^.!\n]{0,40}\b(photo|image|visuel)[^.!\n]{0,12}\?/i;

export type PromiseGuardResult = {
  reply: string;
  appendLink: boolean;
  attachMedia: boolean;
  strippedLinkPromise: boolean;
  strippedMediaPromise: boolean;
  notes: string[];
};

export function replyHasUrl(text: string): boolean {
  return URL_IN_TEXT.test(String(text ?? ""));
}

export function replyPromisesLink(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (LINK_OFFER_Q_RE.test(t) && !/\bvoici\b/i.test(t)) return false;
  return LINK_PROMISE_RE.test(t);
}

export function replyPromisesMedia(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (MEDIA_OFFER_Q_RE.test(t) && !/\bvoici\b/i.test(t)) return false;
  return MEDIA_PROMISE_RE.test(t);
}

function stripSentencesMatching(text: string, re: RegExp): string {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const kept = sentences.filter((s) => !re.test(s) || URL_IN_TEXT.test(s));
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

export function fulfillOutboundPromises(
  reply: string,
  opts: {
    closingLink?: string | null;
    hasMedia?: boolean;
  }
): PromiseGuardResult {
  let text = String(reply ?? "").trim();
  const link = String(opts.closingLink ?? "").trim();
  const hasMedia = opts.hasMedia === true;
  let appendLink = false;
  let attachMedia = false;
  let strippedLinkPromise = false;
  let strippedMediaPromise = false;
  const notes: string[] = [];

  if (replyPromisesLink(text) && !replyHasUrl(text)) {
    if (link) {
      text = `${text}\n${link}`;
      appendLink = true;
      notes.push(
        "ℹ️ Lien campagne joint — le DM promettait un lien sans URL."
      );
    } else {
      const stripped = stripSentencesMatching(text, LINK_PROMISE_RE);
      text =
        stripped.length >= 8
          ? stripped
          : "Je vous confirme le lien juste après.";
      strippedLinkPromise = true;
      notes.push(
        "⚠️ Promesse de lien retirée — aucun lien en config. Campagne non arrêtée."
      );
    }
  }

  if (replyPromisesMedia(text)) {
    if (hasMedia) {
      attachMedia = true;
      notes.push(
        "ℹ️ Photo campagne jointe — le DM promettait une photo."
      );
    } else {
      const stripped = stripSentencesMatching(text, MEDIA_PROMISE_RE);
      text =
        stripped.length >= 8
          ? stripped
          : "Je vous confirme la photo juste après.";
      strippedMediaPromise = true;
      notes.push(
        "⚠️ Promesse de photo retirée — aucun média en config. Campagne non arrêtée."
      );
    }
  }

  return {
    reply: text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    appendLink,
    attachMedia,
    strippedLinkPromise,
    strippedMediaPromise,
    notes,
  };
}
