/** Messages d'erreur lisibles — jamais de jargon technique pour l'utilisateur. */
export function userFacingError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();

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
