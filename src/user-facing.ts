/** Erreur outil / param technique — ne doit jamais apparaître telle quelle dans le chat. */
export function looksLikeTechnicalToolError(raw: string): boolean {
  const m = raw.toLowerCase();
  return (
    /\b(group_prospect|group_broadcast|contact_prospect|keyword_sales)\b/.test(m) ||
    /\b(group_id|initial_message|automation_id|trigger_phrases|group_ids|closing_link)\b/.test(
      m,
    ) ||
    (/\brequiert\b/.test(m) && /_/.test(raw)) ||
    /\blist_whatsapp_groups\s*\(/.test(m) ||
    /\bpasse[- ]?le dans\s+price\b/.test(m) ||
    (/\[prix\]|\bjamais\s+\[/.test(m) && /\bprice\b/.test(m)) ||
    (/prix manquant/.test(m) && /\bprice\b/.test(m)) ||
    /crochets interdit|sans aucun\s*\[/i.test(m)
  );
}

function humanizeToolConfigError(raw: string): string | null {
  const m = raw.toLowerCase();

  if (
    /prix manquant/.test(m) ||
    (/\bpasse[- ]?le dans\s+price\b/.test(m) && /prix|price|\[prix\]/.test(m))
  ) {
    return (
      "Je n'ai pas retrouvé le prix dans la mémoire de cette campagne. " +
      "Indiquez le tarif exact (ex. 15 000 FCFA) et je continue."
    );
  }
  if (/crochets interdit|sans aucun\s*\[|texte avec crochets/i.test(m) || /\[\.\.\.\]|\[…\]/.test(raw)) {
    return (
      "Il reste encore un détail incomplet dans la mémoire (prix, lien ou offre). " +
      "Indiquez la valeur réelle (ex. 15 000 FCFA) et redis « je valide »."
    );
  }

  if (!looksLikeTechnicalToolError(raw)) return null;

  if (/group_prospect|group_id/.test(m) && /initial_message|message/.test(m)) {
    return (
      "Il me manque le groupe ou le message d'accroche pour cette campagne. " +
      "Indiquez le groupe, validez l'accroche, puis réessayez « active »."
    );
  }
  if (/contact_prospect/.test(m)) {
    return (
      "Il me manque des contacts ou le message d'accroche. " +
      "Donnez le(s) numéro(s), validez le brouillon, puis réessayez."
    );
  }
  if (/group_broadcast/.test(m)) {
    return (
      "Il me manque le message ou le(s) groupe(s) pour la diffusion. " +
      "Précisez-les puis réessayez."
    );
  }
  if (/keyword_sales|trigger_phrases/.test(m)) {
    return (
      "Il me manque la phrase déclencheur ou le message pour le closing. " +
      "Complétez le brief Support, puis réessayez."
    );
  }
  if (/closing_link/.test(m)) {
    return "Il me manque le lien de prise de rendez-vous ou de paiement. Indiquez-le puis réessayez.";
  }
  return (
    "Je n'ai pas pu finaliser cette étape — il manque encore un détail. " +
    "Reformulez ou dites « active » si le brouillon est déjà prêt."
  );
}

/** Dernière passe avant affichage chat — bloque les fuites techniques restantes. */
export function sanitizeUserVisibleReply(text: string | null | undefined): string {
  const t = String(text ?? "").trim();
  if (!t) return t;
  const human = humanizeToolConfigError(t);
  if (human) return human;
  return t;
}

/** Messages d'erreur lisibles — jamais de jargon technique pour l'utilisateur. */
export function userFacingError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();

  const toolErr = humanizeToolConfigError(raw);
  if (toolErr) return toolErr;

  if (/failed to fetch|networkerror|load failed|econn|enotfound|network/i.test(m)) {
    return "La connexion a été interrompue un instant. Réessayez — je suis prêt.";
  }
  if (/evolution|whatsapp/i.test(m) && /délai|timeout|abort|attente dépassé|timed out/i.test(m)) {
    return "WhatsApp met un peu de temps à répondre sur votre compte (souvent avec beaucoup de groupes). Réessayez dans quelques secondes.";
  }
  if (/timeout|abort|délai|timed out|prend plus de temps/i.test(m)) {
    return "C’est un peu long de mon côté. Réessayez dans un instant, je termine souvent juste après.";
  }
  if (/429|rate limit|tpm|tokens per min/i.test(m)) {
    return "Je suis un peu saturé pour le moment. Réessayez dans quelques secondes.";
  }
  if (/evolution|whatsapp.*(connect|déconnect|non connect)|non configur/i.test(m)) {
    return "WhatsApp ne répond pas pour le moment. Vérifiez la connexion dans Paramètres, puis réessayez.";
  }
  if (/401|session|jwt|unauthorized|expiré/i.test(m)) {
    return "Votre session a expiré. Reconnectez-vous pour continuer.";
  }
  if (
    /invalid function arguments|invalid params|tool_call_id|2015/i.test(m) ||
    /400.*function arguments/i.test(m)
  ) {
    return "Je n'ai pas pu enregistrer le brouillon d'un coup. Réessayez « oui » ou « crée le brouillon » — je m'en occupe.";
  }
  if (/groupe.*(introuvable|pas trouvé|not found)|aucun groupe/i.test(m)) {
    return "Je ne trouve pas ce groupe. Vérifiez le nom exact (ou collez l’identifiant du groupe) et réessayez.";
  }

  // Ne jamais renvoyer du JSON / stack / HTTP / Evolution brut
  if (
    /^\s*[{[]/.test(raw) ||
    /error:\s|at\s+\S+\(|HTTP\s*\d{3}|evolution|baileys/i.test(raw)
  ) {
    return "Je n’ai pas pu terminer cette action. Reformulez ou réessayez dans un instant.";
  }

  if (raw.length > 180) {
    return "Je n’ai pas pu terminer cette action. Réessayez dans un instant.";
  }

  return raw.trim() || "Je n’ai pas pu terminer cette action. Réessayez dans un instant.";
}

/** Figure space — même largeur qu'un chiffre (alignement des noms à 10 / 100 / 1000). */
const FIGURE_SPACE = "\u2007";

/**
 * Liste numérotée stable pour le chat markdown.
 * - Padding figure-space : les noms restent alignés quand on passe à 100+.
 * - Point échappé (`\.`) : évite que ReactMarkdown transforme en `<ol>`
 *   (sinon les marqueurs CSS 100+ débordent / se décalent dans la bulle).
 */
function formatNumberedLines(items: string[]): string {
  const width = String(Math.max(items.length, 1)).length;
  return items
    .map((item, i) => `${String(i + 1).padStart(width, FIGURE_SPACE)}\\. ${item}`)
    .join("  \n");
}

export function formatVerticalMemberList(
  groupName: string,
  members: Array<{ display: string; name?: string | null; isAdmin?: boolean }>,
  opts?: { total?: number }
): string {
  if (!members.length) {
    return `Groupe « ${groupName} » — aucun membre trouvé.`;
  }
  const total = opts?.total ?? members.length;
  const countLabel =
    total > members.length ? `${members.length} sur ${total}` : String(members.length);
  const lines = members.map((m) => {
    const label = (m.name && m.name.trim()) || m.display;
    const admin = m.isAdmin ? " · admin" : "";
    const phone = m.display && m.display !== label ? `  \n   ${m.display}` : "";
    return `${label}${admin}${phone}`;
  });
  return (
    `Voici les membres du groupe « ${groupName} » (${countLabel}) :\n\n` +
    formatNumberedLines(lines)
  );
}

export function formatVerticalGroupList(
  groups: Array<{ name: string; id?: string }>
): string {
  if (!groups.length) return "Aucun groupe trouvé sur ce compte WhatsApp.";
  const lines = groups.map((g) => g.name || g.id || "Groupe");
  return (
    `Voici vos groupes WhatsApp (${groups.length}) :\n\n` + formatNumberedLines(lines)
  );
}

export function formatVerticalContactList(
  contacts: Array<{ name?: string | null; phone?: string; display?: string }>,
  title = "contacts"
): string {
  if (!contacts.length) return `Aucun ${title} trouvé.`;
  const lines = contacts.map((c) => {
    const phone = c.display || c.phone || "";
    const name = (c.name && c.name.trim()) || phone || "Sans nom";
    return phone && phone !== name ? `${name}  \n   ${phone}` : name;
  });
  return `Voici vos ${title} (${contacts.length}) :\n\n` + formatNumberedLines(lines);
}
