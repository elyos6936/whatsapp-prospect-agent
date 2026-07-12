import { useCallback, useMemo, useState } from 'react';
import { ExternalLink, ImageOff, Play } from 'lucide-react';
import {
  classifyMediaUrl,
  isProxiableMediaUrl,
  mediaProxyUrl,
  normalizeMediaUrl,
} from '@/lib/media';

type LoadMode = 'direct' | 'proxy' | 'failed';

interface ChatMediaProps {
  src: string;
  alt?: string;
}

export function ChatMedia({ src, alt }: ChatMediaProps) {
  const normalizedSrc = useMemo(() => normalizeMediaUrl(src), [src]);
  const kind = useMemo(() => classifyMediaUrl(normalizedSrc), [normalizedSrc]);
  const canProxy = isProxiableMediaUrl(normalizedSrc);

  const [mode, setMode] = useState<LoadMode>('direct');

  const activeSrc =
    mode === 'proxy' && canProxy ? mediaProxyUrl(normalizedSrc) : normalizedSrc;

  const handleError = useCallback(() => {
    if (mode === 'direct' && canProxy) {
      setMode('proxy');
      return;
    }
    setMode('failed');
  }, [mode, canProxy]);

  const label = alt?.trim() || (kind === 'video' ? 'Vidéo' : kind === 'audio' ? 'Audio' : 'Aperçu');

  if (!normalizedSrc || mode === 'failed') {
    return (
      <MediaFallback href={normalizedSrc} label={label} reason="Impossible de charger ce média." />
    );
  }

  if (kind === 'audio') {
    return (
      <figure className="chat-media my-3">
        <audio controls className="w-full max-w-sm" src={activeSrc} onError={handleError} />
        <figcaption className="chat-media-caption">{label}</figcaption>
      </figure>
    );
  }

  if (kind === 'video') {
    return (
      <figure className="chat-media my-3">
        <video
          key={activeSrc}
          className="chat-media-video"
          src={activeSrc}
          controls
          playsInline
          preload="metadata"
          onError={handleError}
        />
        <figcaption className="chat-media-caption">
          <Play className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          <span>{label}</span>
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="chat-media my-3">
      <a href={normalizedSrc} target="_blank" rel="noopener noreferrer" className="block">
        <img
          key={activeSrc}
          src={activeSrc}
          alt={label}
          className="chat-media-image"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handleError}
        />
      </a>
      {alt && alt !== 'Aperçu' ? (
        <figcaption className="chat-media-caption">{alt}</figcaption>
      ) : null}
    </figure>
  );
}

function MediaFallback({
  href,
  label,
  reason,
}: {
  href: string;
  label: string;
  reason: string;
}) {
  const safeHref = href.startsWith('http') ? href : undefined;

  return (
    <figure className="chat-media-fallback my-3">
      <div className="flex items-start gap-3">
        <ImageOff className="mt-0.5 h-5 w-5 shrink-0 text-text-500" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-200">{label}</p>
          <p className="mt-1 text-xs text-text-500">{reason}</p>
          {safeHref ? (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-300 underline-offset-2 hover:text-text-100 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Ouvrir le média
            </a>
          ) : null}
        </div>
      </div>
    </figure>
  );
}
