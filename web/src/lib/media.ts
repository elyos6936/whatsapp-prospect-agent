import { API_BASE_URL } from './config';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;

export type MediaKind = 'image' | 'video' | 'audio';

export function normalizeMediaUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return url;
  if (url.startsWith('<') && url.endsWith('>')) {
    url = url.slice(1, -1);
  }
  if (url.startsWith('/')) {
    return `${API_BASE_URL}${url}`;
  }
  return url;
}

export function classifyMediaUrl(raw: string): MediaKind {
  const url = normalizeMediaUrl(raw).toLowerCase();
  if (VIDEO_EXT.test(url) || url.includes('/video/') || url.includes('mime_type=video')) {
    return 'video';
  }
  if (url.includes('/audio/') || /\.(webm|mp3|m4a|ogg|wav)(\?|#|$)/i.test(url)) {
    return 'audio';
  }
  return 'image';
}

export function mediaProxyUrl(raw: string): string {
  const normalized = normalizeMediaUrl(raw);
  return `${API_BASE_URL}/api/media-proxy?url=${encodeURIComponent(normalized)}`;
}

export function isProxiableMediaUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeMediaUrl(raw));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}
