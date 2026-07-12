import { useMemo, type ComponentProps } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import ReactMarkdown from 'react-markdown';
import { Bot, MessageCircle } from 'lucide-react';
import { LazyCodeBlock } from './LazyCodeBlock';
import { ChatMedia } from './ChatMedia';
import { QuestionsCard, type QuestionsPayload } from './QuestionsCard';
import { cn } from '@/lib/utils';
import { sanitizeAssistantText } from '@/lib/sanitize-assistant-text';
import { classifyMediaUrl, isProxiableMediaUrl, normalizeMediaUrl } from '@/lib/media';
import type { ChatMessage } from '@/lib/api';

const QUESTIONS_LANG = 'klanvio-questions';
const QUESTIONS_RE = /```klanvio-questions\s*\r?\n([\s\S]*?)\r?\n?```/;

function parseQuestionsPayload(raw: string): QuestionsPayload | null {
  try {
    const payload = JSON.parse(raw) as QuestionsPayload;
    if (!payload || !Array.isArray(payload.questions) || payload.questions.length === 0) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Extrait un bloc de questions interactives du contenu brut d'un message. */
function extractQuestions(
  raw: string,
): { intro: string; payload: QuestionsPayload } | null {
  const match = QUESTIONS_RE.exec(raw);
  if (!match) return null;
  const payload = parseQuestionsPayload(match[1]);
  if (!payload) return null;
  const intro = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).trim();
  return { intro, payload };
}

function createMarkdownComponents(handlers: {
  onSend?: (text: string) => void;
  interactive?: boolean;
}) {
  return {
    code({ className, children, ...props }: ComponentProps<'code'> & { className?: string }) {
      const match = /language-(\w+)/.exec(className ?? '');
      const code = String(children).replace(/\n$/, '');
      // Filet de sécurité : si un bloc de questions atterrit ici (extraction
      // manquée), on le rend en carte — jamais en JSON brut.
      if (match?.[1] === QUESTIONS_LANG) {
        const payload = parseQuestionsPayload(code);
        if (!payload) return null;
        return (
          <QuestionsCard
            payload={payload}
            onSubmit={handlers.onSend}
            disabled={!handlers.interactive || !handlers.onSend}
          />
        );
      }
      if (match) {
        return <LazyCodeBlock language={match[1]} code={code} />;
      }
      return <code {...props}>{children}</code>;
    },
    img({ src, alt }: ComponentProps<'img'>) {
      if (!src) return null;
      return <ChatMedia src={src} alt={alt} />;
    },
    a({ href, children }: ComponentProps<'a'>) {
      if (!href) return <span>{children}</span>;
      const normalized = normalizeMediaUrl(href);
      const childText = String(children ?? '').trim();
      const looksLikeMediaLink =
        (isProxiableMediaUrl(normalized) || href.startsWith('/')) &&
        (classifyMediaUrl(normalized) !== 'image' ||
          /aperçu|apercu|image|vidéo|video|media|thumbnail|note vocale/i.test(childText) ||
          childText.length === 0);

      if (looksLikeMediaLink && (classifyMediaUrl(normalized) === 'video' || classifyMediaUrl(normalized) === 'audio')) {
        return <ChatMedia src={normalized} alt={childText || 'Média'} />;
      }

      return (
        <a
          href={href.startsWith('/') ? normalizeMediaUrl(href) : href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-brand underline-offset-2 hover:underline"
        >
          {children}
        </a>
      );
    },
  };
}

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  /** Envoie un message (utilisé par les cartes de questions interactives). */
  onSend?: (text: string) => void;
  /** Dernier message de la liste (les cartes ne sont interactives que sur le dernier). */
  isLast?: boolean;
}

export function MessageBubble({ message, isStreaming, onSend, isLast }: MessageBubbleProps) {
  const isUser = message.kind === 'user';
  const isAssistant = message.kind === 'assistant' || message.kind === 'error';
  const isWaIn = message.kind === 'whatsapp-in';
  const isWaOut = message.kind === 'whatsapp-out';
  const time = format(
    new Date(message.created_at.includes('T') ? message.created_at : message.created_at.replace(' ', 'T')),
    'HH:mm',
    { locale: fr },
  );

  const questions = isAssistant ? extractQuestions(message.content) : null;

  const displayContent = questions
    ? sanitizeAssistantText(questions.intro)
    : isAssistant
      ? sanitizeAssistantText(message.content)
      : message.content;

  const markdownComponents = useMemo(
    () => createMarkdownComponents({ onSend, interactive: isLast }),
    [onSend, isLast],
  );

  const bubbleClass = cn(
    'min-w-0 max-w-full rounded-2xl px-3 py-2 text-[13px] leading-[1.45] transition-all duration-200',
    isUser && 'bg-brand text-white',
    isAssistant && !message.content.startsWith('❌') && 'border border-white/10 bg-bg-100 text-text-100',
    message.kind === 'error' && 'border border-red-500/30 bg-red-950/30 text-red-100',
    isWaIn && 'border border-dashed border-emerald-500/30 bg-bg-200 text-text-100',
    isWaOut && 'border border-brand-border bg-brand-muted text-text-100',
  );

  const Icon = isWaIn || isWaOut ? MessageCircle : Bot;

  return (
    <div
      className={cn(
        'animate-fade-in flex min-w-0 gap-2',
        isUser || isWaOut ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {!isUser && (
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
            isWaIn || isWaOut
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-brand-border bg-brand-muted text-brand',
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
      )}

      <div
        className={cn(
          'flex min-w-0 max-w-[min(88%,34rem)] flex-col gap-0.5',
          (isUser || isWaOut) && 'items-end',
        )}
      >
        {message.label && (
          <span className="px-1 text-[9px] uppercase tracking-wide text-text-500">
            {message.label}
          </span>
        )}
        <div className={bubbleClass}>
          {(displayContent || !questions) && (
            <div className="prose-klanvio">
              <ReactMarkdown components={markdownComponents}>
                {displayContent || (isStreaming ? ' ' : '')}
              </ReactMarkdown>
              {isStreaming && message.content && (
                <span className="ml-0.5 inline-block animate-pulse text-text-300">▍</span>
              )}
            </div>
          )}
          {questions && (
            <QuestionsCard
              payload={questions.payload}
              onSubmit={onSend}
              disabled={!isLast || !onSend}
            />
          )}
        </div>
        <time className="px-1 text-[10px] text-text-500" dateTime={message.created_at}>
          {time}
        </time>
      </div>
    </div>
  );
}
