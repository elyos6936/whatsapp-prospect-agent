/**
 * Placeholders type [prix], [lien], [Prénom] — jamais autorisés en message WhatsApp sortant.
 * Filet de sécurité anti-amateur : l'IA ne doit jamais envoyer de crochets aux prospects.
 */
const TEMPLATE_PLACEHOLDER_RE = /\[[^\]]{1,80}\]/;

export function hasTemplatePlaceholders(text: string): boolean {
  return TEMPLATE_PLACEHOLDER_RE.test(text);
}

/**
 * Si du texte entre crochets est détecté, on refuse d'envoyer tel quel
 * et on remplace par une phrase sûre (sans inventer de prix/lien).
 */
export function sanitizeOutboundWhatsAppText(text: string): string {
  const trimmed = text.trim();
  if (!hasTemplatePlaceholders(trimmed)) return trimmed;
  console.warn(
    `⚠️ Placeholder détecté dans un message sortant — remplacé. Brut: ${trimmed.slice(0, 160)}`
  );
  return "Je te confirme le détail exact juste après 🙂";
}

/** Liste les champs d'une config de campagne qui contiennent encore des crochets. */
export function findPlaceholderFields(
  fields: Array<{ label: string; value?: string | null }>
): string[] {
  return fields
    .filter((f) => f.value && hasTemplatePlaceholders(f.value))
    .map((f) => f.label);
}
