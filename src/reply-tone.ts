/**
 * Ton d'adressage des messages sortants : tutoiement ou vouvoiement.
 *
 * Le ton n'est plus codé en dur dans les prompts : il est déduit de la campagne
 * (accroche validée, playbook, guide, mémoire) et de ce qui a déjà été envoyé
 * dans le fil. Mélanger « tu » et « vous » dans une même conversation est le
 * défaut le plus visible côté prospect, donc la cohérence primaire vient
 * toujours des messages déjà envoyés.
 *
 * Sans aucun signal, on reste au vouvoiement (comportement historique).
 */
export type ReplyTone = "tu" | "vous";

/** « te » et « t'en » sont inclus ; « ton / ta » sont exclus (« le ton de la campagne »). */
const TU_MARKERS_SOURCE = "\\b(?:tu|toi|te|tes)\\b|\\bt['’][aeiouyéèêà]";
const VOUS_MARKERS_SOURCE = "\\b(?:vous|votre|vos)\\b";

const DECLARES_TU = /je\s+tutoie|tutoiement|tutoyer/i;
const DECLARES_VOUS = /je\s+vouvoie|vouvoiement|vouvoyer/i;

/**
 * Ton d'un texte, ou null si le texte ne tranche pas.
 * Une consigne explicite (« je tutoie ») prime sur le simple usage des pronoms.
 */
export function detectToneFromText(text: string | null | undefined): ReplyTone | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  const declaresTu = DECLARES_TU.test(raw);
  const declaresVous = DECLARES_VOUS.test(raw);
  if (declaresTu && !declaresVous) return "tu";
  if (declaresVous && !declaresTu) return "vous";

  const tuCount = (raw.match(new RegExp(TU_MARKERS_SOURCE, "gi")) ?? []).length;
  const vousCount = (raw.match(new RegExp(VOUS_MARKERS_SOURCE, "gi")) ?? []).length;
  if (tuCount === 0 && vousCount === 0) return null;
  return tuCount > vousCount ? "tu" : "vous";
}

/**
 * Ton à appliquer, par ordre de priorité :
 * 1. messages déjà envoyés dans le fil (ne jamais changer de ton en cours de route) ;
 * 2. textes campagne fournis par l'appelant (accroche validée, playbook, guide) ;
 * 3. vouvoiement.
 */
export function resolveReplyTone(opts: {
  sentMessages?: Array<string | null | undefined>;
  campaignTexts?: Array<string | null | undefined>;
}): ReplyTone {
  const sent = (opts.sentMessages ?? [])
    .map((m) => String(m ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const fromSent = detectToneFromText(sent);
  if (fromSent) return fromSent;

  for (const text of opts.campaignTexts ?? []) {
    const found = detectToneFromText(text);
    if (found) return found;
  }
  return "vous";
}

/** Étiquette courte pour les prompts (« tutoiement » / « vouvoiement »). */
export function toneLabel(tone: ReplyTone): string {
  return tone === "tu" ? "tutoiement" : "vouvoiement";
}

/** Consigne system explicite — évite que le modèle bascule en cours de fil. */
export function toneInstruction(tone: ReplyTone): string {
  return tone === "tu"
    ? "## TON DU FIL — TUTOIEMENT (OBLIGATOIRE)\n" +
        "Adresse-toi au contact en **tu** (tu / toi / ton / tes). " +
        "INTERDIT de passer au « vous » dans ce fil, même partiellement."
    : "## TON DU FIL — VOUVOIEMENT (OBLIGATOIRE)\n" +
        "Adresse-toi au contact en **vous** (vous / votre / vos). " +
        "INTERDIT de passer au « tu » dans ce fil, même partiellement.";
}
