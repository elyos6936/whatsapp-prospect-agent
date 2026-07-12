/** Retire footers outil, IDs techniques et @g.us du texte assistant affiché. */
export function sanitizeAssistantText(text: string): string {
  if (!text?.trim()) return text;

  let out = text;

  out = out.replace(/\n---\s*\n[\s\S]*$/m, '').trimEnd();
  out = out.replace(/\n+STATUT\s*:\s*[^\n]+/gi, '');
  out = out.replace(/\n+DETAIL\s*:\s*[^\n]+/gi, '');

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
  out = out.replace(/^\s*[-–—]\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}
