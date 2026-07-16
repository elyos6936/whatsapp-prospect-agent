/** Retire footers outil, IDs techniques et @g.us du texte assistant affiché. */
export function sanitizeAssistantText(text: string): string {
  if (!text?.trim()) return text;

  let out = text;

  // Uniquement les footers techniques d'outil (pas un séparateur markdown « --- »
  // suivi d'une simulation / contenu utile — ça coupait le fil de conversation).
  out = out.replace(/\n---\s*\n(?:STATUT|DETAIL|Outil|Tool|Résultat|Result)\b[\s\S]*$/im, '').trimEnd();
  out = out.replace(/\n+STATUT\s*:\s*[^\n]+/gi, '');
  out = out.replace(/\n+DETAIL\s*:\s*[^\n]+/gi, '');

  // Masquer les numéros techniques (#56, etc.)
  out = out.replace(/\bcampagne\s*#\s*\d+\b/gi, 'automatisation');
  out = out.replace(/\bautomatisation\s*#\s*\d+\b/gi, 'automatisation');
  out = out.replace(/\(\s*#\d+\s*\)/g, '');
  out = out.replace(/\bcampagne\s+\d{1,5}\b/gi, 'automatisation');
  out = out.replace(/(«[^»]+»)\s*#\d+/g, '$1');
  out = out.replace(/#\d{1,6}\b/g, '');

  // Vocabulaire UI : panneau / carte → simulation
  out = out.replace(/\b(ouvre|voir|ouvre[rz]?)\s+(la\s+)?(carte|panneau)\b/gi, 'ouvre la simulation');
  out = out.replace(/\bpanneau\s+à\s+droite\b/gi, 'simulation à droite');
  out = out.replace(/\bVoir le panneau à droite\b/gi, 'Tester la simulation à droite');
  out = out.replace(/\bCampagne\s+[«"]([^»"]+)[»"]\s+créée en brouillon\b/gi, '« $1 » est prêt — ouvre la simulation');
  out = out.replace(/\bCampagne\s+[«"]([^»"]+)[»"]\s+mise à jour\b/gi, '« $1 » mis à jour');
  out = out.replace(/\bVoici le plan[^.]*\./gi, 'Ouvre la simulation à droite pour tester.');
  out = out.replace(/\bavant simulation\b/gi, 'via la simulation');
  out = out.replace(/\bCampagne «/g, '«');
  out = out.replace(/\bcampagne «/gi, '«');

  out = out.replace(/`[^`\n]{8,}`/g, (match) => {
    const inner = match.slice(1, -1);
    if (
      /@g\.us|@s\.whatsapp\.net|chat_id|message_id|^[a-zA-Z0-9_-]{10,}$/i.test(inner) ||
      /^\d{10,}@/.test(inner)
    ) {
      return '';
    }
    return match;
  });

  out = out.replace(
    /\s*\(([a-zA-Z0-9_-]{8,}|\+?\d{10,}|[^)]*@g\.us[^)]*)\)/g,
    '',
  );
  out = out.replace(/\bchat_id\s*:\s*\S+/gi, '');
  out = out.replace(/\bmessage_id\s*:\s*\S+/gi, '');
  out = out.replace(/\b\d{10,}@g\.us\b/g, '');
  out = out.replace(/\b\d+@s\.whatsapp\.net\b/g, '');
  // Ne jamais exposer Evolution / stack technique
  out = out.replace(/\bEvolution\s*API\b/gi, 'WhatsApp');
  out = out.replace(/\bEvolution\b/gi, 'Klanvio');
  out = out.replace(/\bBaileys\b/gi, 'WhatsApp');

  out = out.replace(/^\s*[-–—]\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}
