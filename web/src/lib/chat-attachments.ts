export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

function previewUrl(file: ChatAttachment): string {
  const base = import.meta.env.VITE_API_URL?.trim()?.replace(/\/$/, '') || '';
  if (file.url.startsWith('http')) return file.url;
  return `${base}${file.url}`;
}

export function buildUserMessageDisplayText(
  text: string,
  attachments: ChatAttachment[],
): string {
  const trimmed = text.trim();
  const lines: string[] = [];
  if (trimmed) lines.push(trimmed);

  for (const file of attachments) {
    const href = previewUrl(file);
    if (file.mimeType.startsWith('image/')) {
      lines.push(`\n![${file.name}](${href})`);
    } else if (file.mimeType.startsWith('video/')) {
      lines.push(`\n[Vidéo : ${file.name}](${href})`);
    } else if (file.mimeType.startsWith('audio/')) {
      lines.push(`\n[Note vocale : ${file.name}](${href})`);
    } else {
      lines.push(`\n📎 [${file.name}](${href})`);
    }
  }

  return lines.join('').trim() || 'Fichier(s) joint(s)';
}

export function buildUserMessageApiText(
  text: string,
  attachments: ChatAttachment[],
): string {
  const trimmed = text.trim();
  const parts: string[] = [];
  if (trimmed) parts.push(trimmed);

  for (const file of attachments) {
    const href = previewUrl(file);
    if (file.mimeType.startsWith('image/')) {
      parts.push(`[Image jointe: ${file.name}] ${href}`);
    } else if (file.mimeType.startsWith('audio/')) {
      parts.push(`[Note vocale: ${file.name}] ${href}`);
    } else if (file.mimeType.startsWith('video/')) {
      parts.push(`[Vidéo jointe: ${file.name}] ${href}`);
    } else {
      parts.push(`[Fichier joint: ${file.name}] ${href}`);
    }
  }

  return parts.join('\n').trim();
}

export const CHAT_ACCEPT =
  'image/*,video/*,audio/*,.pdf,.txt,.csv,.json,application/pdf,text/plain,text/csv,application/json';

export const CHAT_MAX_FILES = 6;
