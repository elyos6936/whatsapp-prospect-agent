import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import {
  KlanvioChatInput,
  type KlanvioChatInputHandle,
} from '@/components/ui/klanvio-chat-input';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { PLATFORM_NAME } from '@/lib/brand';
import type { ChatAttachment } from '@/lib/chat-attachments';
import type { ChatMessage } from '@/lib/api';
import type { AutomationVisualPlan } from '@/lib/automation-plan';

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  messagesLoading?: boolean;
  isSending?: boolean;
  onSend: (text: string, attachments?: ChatAttachment[]) => void | Promise<void>;
  isFreshSession?: boolean;
  onOpenPlan?: (plan: AutomationVisualPlan) => void;
  /** Identifiant du fil — remonte le composer et recentre le focus. */
  threadId?: number | null;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'a, button, input, textarea, select, [contenteditable="true"], [role="button"], [data-no-chat-focus]',
    ),
  );
}

export function ChatWorkspace({
  messages,
  messagesLoading,
  isSending,
  onSend,
  isFreshSession = true,
  onOpenPlan,
  threadId = null,
}: ChatWorkspaceProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const inputRef = useRef<KlanvioChatInputHandle>(null);

  const isEmpty = messages.length === 0 && !messagesLoading && !isSending;
  const showWelcome = isEmpty && isFreshSession;

  const focusComposer = useCallback(() => {
    if (isSending) return;
    inputRef.current?.focus();
  }, [isSending]);

  const handleChatSurfacePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(e.target)) return;
      // Ne pas voler la sélection de texte
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      focusComposer();
    },
    [focusComposer],
  );

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

  // Nouveau fil → focus immédiat pour écrire
  useEffect(() => {
    stickToBottomRef.current = true;
    const t = window.setTimeout(() => focusComposer(), 50);
    return () => window.clearTimeout(t);
  }, [threadId, focusComposer]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-bg-0"
      onPointerDown={handleChatSurfacePointerDown}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {showWelcome ? (
          <div className="flex flex-1 cursor-text flex-col items-center justify-center px-6 pb-6 pt-8">
            <div className="w-full max-w-2xl animate-fade-in text-center">
              <h1 className="font-serif text-3xl font-light tracking-tight text-text-100 sm:text-4xl">
                {getGreeting()}
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-text-400">
                Votre agent {PLATFORM_NAME} WhatsApp est prêt. Donnez une instruction — il exécute
                prospection, groupes et réponses automatiques.
              </p>
            </div>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className="flex-1 cursor-text overflow-y-auto custom-scrollbar"
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-4 sm:px-6 sm:py-6">
              {messagesLoading && isEmpty ? (
                <div className="space-y-4 py-2">
                  <div className="h-16 max-w-lg rounded-2xl skeleton-shine" />
                  <div className="ml-auto h-12 max-w-sm rounded-2xl skeleton-shine" />
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-3 pb-4">
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} onOpenPlan={onOpenPlan} />
                  ))}
                  {isSending && (
                    <div className="flex animate-fade-in gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-border bg-brand-muted">
                        <span className="text-[10px] font-medium text-brand">AI</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-bg-100 px-3 py-2">
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

      <div className="shrink-0 border-t border-black/10 bg-bg-0">
        <div className="mx-auto w-full max-w-3xl">
          <KlanvioChatInput
            ref={inputRef}
            onSend={onSend}
            disabled={Boolean(isSending)}
            autoFocus
            variant="dock"
            placeholder={
              isSending
                ? "L'agent réfléchit…"
                : showWelcome
                  ? 'Donnez une instruction à l\'agent WhatsApp…'
                  : 'Écrire à l\'agent…'
            }
          />
        </div>
      </div>
    </div>
  );
}
