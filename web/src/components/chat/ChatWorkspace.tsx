import { useEffect, useRef } from 'react';
import { KlanvioChatInput, QUICK_SUGGESTIONS } from '@/components/ui/klanvio-chat-input';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { PLATFORM_NAME } from '@/lib/brand';
import type { ChatAttachment } from '@/lib/chat-attachments';
import type { ChatMessage } from '@/lib/api';

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  messagesLoading?: boolean;
  isSending?: boolean;
  onSend: (text: string, attachments?: ChatAttachment[]) => void | Promise<void>;
  isFreshSession?: boolean;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

export function ChatWorkspace({
  messages,
  messagesLoading,
  isSending,
  onSend,
  isFreshSession = true,
}: ChatWorkspaceProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const isEmpty = messages.length === 0 && !messagesLoading && !isSending;
  const showWelcome = isEmpty && isFreshSession;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < 96;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (isEmpty && !isSending) return;
    if (!stickToBottomRef.current && !isSending) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isSending, isEmpty]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-0">
      <div className="flex min-h-0 flex-1 flex-col">
        {showWelcome ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-8">
            <div className="w-full max-w-2xl animate-fade-in text-center">
              <h1 className="font-serif text-3xl font-light tracking-tight text-text-100 sm:text-4xl">
                {getGreeting()}
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-400">
                Votre agent {PLATFORM_NAME} WhatsApp est prêt. Donnez une instruction — il exécute
                prospection, groupes et réponses automatiques.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                {QUICK_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    onClick={() => void onSend(suggestion.prompt)}
                    disabled={isSending}
                    className="rounded-full border border-brand-border bg-brand-muted px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand hover:bg-brand/25 disabled:opacity-50"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-4 sm:px-6 sm:py-6">
              {messagesLoading && isEmpty ? (
                <div className="space-y-4 py-2">
                  <div className="h-16 max-w-lg rounded-2xl skeleton-shine" />
                  <div className="ml-auto h-12 max-w-sm rounded-2xl skeleton-shine" />
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-3 pb-4">
                  {messages.map((msg, index) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      onSend={(text) => void onSend(text)}
                      isLast={index === messages.length - 1 && !isSending}
                    />
                  ))}
                  {isSending && (
                    <div className="flex animate-fade-in gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-border bg-brand-muted">
                        <span className="text-[10px] font-medium text-brand">AI</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-bg-100 px-3 py-2">
                        <TypingIndicator />
                        <span className="text-[13px] text-text-400">L&apos;agent réfléchit…</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 bg-bg-0">
        <div className="mx-auto w-full max-w-3xl">
          <KlanvioChatInput
            onSend={onSend}
            disabled={isSending}
            variant="dock"
            placeholder={
              showWelcome
                ? 'Donnez une instruction à l\'agent WhatsApp…'
                : 'Écrire à l\'agent…'
            }
          />
        </div>
      </div>
    </div>
  );
}
