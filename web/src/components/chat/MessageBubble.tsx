import type { ComponentProps } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import ReactMarkdown from 'react-markdown';
import { Bot, MessageCircle } from 'lucide-react';
import { LazyCodeBlock } from './LazyCodeBlock';
import { ChatMedia } from './ChatMedia';
import { PlanCard } from './PlanCard';
import { cn } from '@/lib/utils';
import { sanitizeAssistantText } from '@/lib/sanitize-assistant-text';
import { extractPlanFromText, type AutomationVisualPlan } from '@/lib/automation-plan';
import { classifyMediaUrl, isProxiableMediaUrl, normalizeMediaUrl } from '@/lib/media';
import type { ChatMessage } from '@/lib/api';

const markdownComponents = {
  code({ className, children, ...props }: ComponentProps<'code'> & { className?: string }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const code = String(children).replace(/\n$/, '');
    if (match?.[1] === 'klanvio-plan') {
      return null;
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

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onOpenPlan?: (plan: AutomationVisualPlan) => void;
}

export function MessageBubble({ message, isStreaming, onOpenPlan }: MessageBubbleProps) {
  const isUser = message.kind === 'user';
  const isAssistant = message.kind === 'assistant' || message.kind === 'error';
  const isWaIn = message.kind === 'whatsapp-in';
  const isWaOut = message.kind === 'whatsapp-out';
  const time = format(
    new Date(message.created_at.includes('T') ? message.created_at : message.created_at.replace(' ', 'T')),
    'HH:mm',
    { locale: fr },
  );

  const raw = isAssistant ? sanitizeAssistantText(message.content) : message.content;
  const { plan, textWithoutPlan } = isAssistant
    ? extractPlanFromText(raw)
    : { plan: null, textWithoutPlan: raw };
  const displayContent = textWithoutPlan;

  const bubbleClass = cn(
    'min-w-0 max-w-full rounded-2xl px-3 py-2 text-[13px] leading-[1.45] transition-all duration-200',
    isUser && 'bg-brand text-white',
    isAssistant && !message.content.startsWith('❌') && 'border border-black/10 bg-bg-100 text-text-100',
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
        {(displayContent || isStreaming) && (
          <div className={bubbleClass}>
            <div className="prose-klanvio">
              <ReactMarkdown components={markdownComponents}>
                {displayContent || (isStreaming ? ' ' : '')}
              </ReactMarkdown>
              {isStreaming && message.content && (
                <span className="ml-0.5 inline-block animate-pulse text-text-300">▍</span>
              )}
            </div>
          </div>
        )}
        {plan && onOpenPlan && <PlanCard plan={plan} onOpen={() => onOpenPlan(plan)} />}
        <time className="px-1 text-[10px] text-text-500" dateTime={message.created_at}>
          {time}
        </time>
      </div>
    </div>
  );
}
