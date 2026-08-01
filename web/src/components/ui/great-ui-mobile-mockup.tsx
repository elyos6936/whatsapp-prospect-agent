"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const DoubleCheckIcon = ({
  className = "w-3.5 h-3.5",
}: {
  className?: string;
}) => (
  <svg
    className={className}
    viewBox="0 0 16 11"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M11.045 0.584961L11.9883 1.52829L5.85833 7.65829L2.55833 4.35829L3.50167 3.41496L5.85833 5.77163L11.045 0.584961ZM14.345 0.584961L15.2883 1.52829L9.15833 7.65829L8.215 6.71496L14.345 0.584961ZM9.15833 9.54496L5.85833 6.24496L6.80167 5.30163L9.15833 7.65829L14.345 2.47163L15.2883 3.41496L9.15833 9.54496Z" />
  </svg>
);

const PhoneCallIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const VideoCallIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const ArrowLeftIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const MoreVerticalIcon = ({
  className = "w-4 h-4",
}: {
  className?: string;
}) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </svg>
);

const MicrophoneIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const EmojiIcon = ({ className = "w-4.5 h-4.5" }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth={3} />
    <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth={3} />
  </svg>
);

export interface ChatMessage {
  id: number | string;
  sender: string;
  avatarInitial?: string;
  text?: string;
  isCurrentUser: boolean;
  timestamp: string;
  isImage?: boolean;
  imageUrl?: string;
  imageCaption?: string;
}

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    id: 1,
    sender: "Taylor",
    avatarInitial: "T",
    text: "Hey! 👋",
    isCurrentUser: false,
    timestamp: "10:11 AM",
  },
  {
    id: 2,
    sender: "Taylor",
    avatarInitial: "T",
    text: "Wanted to catch up with you - are you in the office this week?",
    isCurrentUser: false,
    timestamp: "10:11 AM",
  },
  {
    id: 3,
    sender: "You",
    avatarInitial: "Y",
    text: "Hi! I'm working remotely this week 🏖️",
    isCurrentUser: true,
    timestamp: "10:12 AM",
  },
  {
    id: 4,
    sender: "You",
    avatarInitial: "Y",
    isImage: true,
    imageUrl:
      "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=500&auto=format&fit=crop&q=80",
    imageCaption: "Catch you next Monday over coffee! ☕",
    isCurrentUser: true,
    timestamp: "10:12 AM",
  },
  {
    id: 5,
    sender: "Taylor",
    avatarInitial: "T",
    text: "Sounds good. Enjoy the rest of your week! 😊",
    isCurrentUser: false,
    timestamp: "10:13 AM",
  },
];

export interface MobileMockupProps {
  headerTitle?: string;
  headerSubtitle?: string;
  avatarUrl?: string;
  avatarFallback?: string;
  messages?: ChatMessage[];
  autoPlay?: boolean;
  className?: string;
  children?: ReactNode;
  /** Mode interactif (simulation Klanvio) */
  interactive?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
  onSend?: () => void;
  busy?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  scrollRef?: RefObject<HTMLDivElement | null>;
  emptyHint?: string;
}

export function MobileMockup({
  headerTitle = "Taylor",
  headerSubtitle = "online",
  avatarUrl,
  avatarFallback = "T",
  messages = DEFAULT_MESSAGES,
  autoPlay = true,
  className,
  children,
  interactive = false,
  draft = "",
  onDraftChange,
  onSend,
  busy = false,
  placeholder = "Message",
  inputRef,
  scrollRef,
  emptyHint,
}: MobileMockupProps) {
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const [cycleKey, setCycleKey] = useState(0);

  useEffect(() => {
    if (!autoPlay || children || interactive) {
      return;
    }

    let isMounted = true;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    let t3: ReturnType<typeof setTimeout>;
    let t4: ReturnType<typeof setTimeout>;
    let tReset: ReturnType<typeof setTimeout>;

    const runSequence = () => {
      if (!isMounted) return;
      setVisibleMessages([]);
      setShowTyping(false);

      t1 = setTimeout(() => {
        if (!isMounted) return;
        setVisibleMessages([messages[0], messages[1]].filter(Boolean) as ChatMessage[]);
        setShowTyping(true);
      }, 800);

      t2 = setTimeout(() => {
        if (!isMounted) return;
        setShowTyping(false);
        setVisibleMessages(
          [messages[0], messages[1], messages[2]].filter(Boolean) as ChatMessage[],
        );
      }, 2500);

      t3 = setTimeout(() => {
        if (!isMounted) return;
        setVisibleMessages(
          [messages[0], messages[1], messages[2], messages[3]].filter(
            Boolean,
          ) as ChatMessage[],
        );
        setTimeout(() => {
          if (isMounted) setShowTyping(true);
        }, 600);
      }, 4500);

      t4 = setTimeout(() => {
        if (!isMounted) return;
        setShowTyping(false);
        setVisibleMessages(messages);
      }, 6800);

      tReset = setTimeout(() => {
        if (isMounted) {
          setCycleKey((prev) => prev + 1);
        }
      }, 10800);
    };

    runSequence();

    return () => {
      isMounted = false;
      clearTimeout(t1!);
      clearTimeout(t2!);
      clearTimeout(t3!);
      clearTimeout(t4!);
      clearTimeout(tReset!);
    };
  }, [autoPlay, children, interactive, messages, cycleKey]);

  const displayMessages =
    interactive || !autoPlay || children ? messages : visibleMessages;
  const canSend = interactive && Boolean(draft.trim()) && !busy;
  const subtitle = busy ? "en train d’écrire…" : headerSubtitle;

  return (
    <div
      className={cn(
        "relative mx-auto flex w-full max-w-[285px] items-center justify-center py-2 select-none",
        className,
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="relative flex h-[560px] w-full transform-gpu flex-col overflow-hidden rounded-[40px] bg-neutral-900 p-2.5"
      >
        <div className="absolute top-24 -left-[5px] h-8 w-[2.5px] rounded-l-sm bg-neutral-700" />
        <div className="absolute top-36 -left-[5px] h-10 w-[2.5px] rounded-l-sm bg-neutral-700" />
        <div className="absolute top-48 -left-[5px] h-10 w-[2.5px] rounded-l-sm bg-neutral-700" />
        <div className="absolute top-32 -right-[5px] h-14 w-[2.5px] rounded-r-sm bg-neutral-700" />

        <div className="relative isolate flex h-full w-full transform-gpu flex-col overflow-hidden rounded-[30px] bg-[#efeae2] text-neutral-900">
          {/* Status bar : heure | Dynamic Island | icônes — même rangée, paddings d’origine */}
          <div className="relative z-30 flex shrink-0 items-center justify-between bg-[#008069] px-3.5 pt-2 pb-1 text-[11px] font-semibold text-white">
            <span className="z-10 w-[44px] shrink-0 text-left text-[10.5px] font-bold tracking-tight tabular-nums">
              {displayMessages[displayMessages.length - 1]?.timestamp ?? "10:13"}
            </span>

            <div
              className="pointer-events-none absolute top-1.5 left-1/2 z-20 h-[21px] w-[72px] -translate-x-1/2 rounded-full bg-black"
              aria-hidden
            />
            {/* Espace réservé pour l’island (évite que l’heure / les icônes passent dessous) */}
            <div className="h-[21px] w-[72px] shrink-0" aria-hidden />

            <div className="z-10 flex w-[44px] shrink-0 items-center justify-end gap-1 text-white">
              <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <rect x="2" y="16" width="3.5" height="5" rx="0.5" />
                <rect x="7.5" y="12" width="3.5" height="9" rx="0.5" />
                <rect x="13" y="8" width="3.5" height="13" rx="0.5" />
                <rect x="18.5" y="4" width="3.5" height="17" rx="0.5" />
              </svg>
              <svg
                className="h-2.5 w-2.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                />
              </svg>
              <svg
                className="h-2 w-3.5"
                fill="none"
                viewBox="0 0 24 14"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <rect x="1" y="1" width="18" height="12" rx="3" />
                <rect x="3" y="3" width="11" height="8" rx="1.5" fill="currentColor" />
                <path d="M21 4v6" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          <div className="z-20 flex shrink-0 items-center justify-between bg-[#008069] px-3 py-1.5 text-white">
            <div className="flex min-w-0 items-center gap-1.5">
              <button type="button" tabIndex={-1} className="shrink-0 text-white/90" aria-hidden>
                <ArrowLeftIcon />
              </button>

              <div className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-700 text-[11px] font-bold text-white">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={headerTitle}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{avatarFallback}</span>
                )}
              </div>

              <div className="flex min-w-0 flex-col">
                <span className="max-w-[140px] truncate text-[11.5px] font-semibold leading-tight text-white">
                  {headerTitle}
                </span>
                <span className="mt-0.5 text-[9.5px] font-medium leading-none text-emerald-200">
                  {subtitle}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5 text-white/90">
              <VideoCallIcon className="h-3.5 w-3.5" />
              <PhoneCallIcon className="h-3.5 w-3.5" />
              <MoreVerticalIcon className="h-3.5 w-3.5" />
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#efeae2] p-2.5">
            {children ? (
              <div className="relative z-10 h-full w-full overflow-y-auto scrollbar-none">
                {children}
              </div>
            ) : (
              <>
                <div
                  ref={scrollRef}
                  className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none"
                >
                  <div className="flex min-h-full flex-col justify-end space-y-1.5 pb-0.5">
                    {displayMessages.length > 0 ? (
                      <div className="mx-auto mb-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-[9px] font-medium text-neutral-600">
                        Aujourd’hui
                      </div>
                    ) : null}

                    {displayMessages.length === 0 && interactive ? (
                      <div className="flex flex-1 items-center justify-center px-3 text-center">
                        <p className="rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] leading-snug text-neutral-600">
                          {emptyHint ?? "Écrivez un message pour tester."}
                        </p>
                      </div>
                    ) : null}

                    <AnimatePresence mode="sync">
                      {displayMessages.map((msg) => (
                        <motion.div
                          key={`${cycleKey}-${msg.id}`}
                          initial={
                            interactive
                              ? false
                              : { opacity: 0, y: 8, scale: 0.96 }
                          }
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 25,
                          }}
                          className={`flex flex-col ${msg.isCurrentUser ? "items-end" : "items-start"}`}
                        >
                          <div
                            className={cn(
                              "relative flex max-w-[85%] flex-col rounded-xl px-2.5 py-1 text-[11px]",
                              msg.isCurrentUser
                                ? "rounded-tr-none bg-[#dcf8c6] text-neutral-900"
                                : "rounded-tl-none bg-white text-neutral-900",
                            )}
                          >
                            {msg.isImage ? (
                              <div className="flex min-w-[150px] flex-col gap-1">
                                <div className="relative max-h-[100px] overflow-hidden rounded-lg">
                                  <img
                                    src={msg.imageUrl}
                                    alt="Attached media"
                                    className="h-22 w-full object-cover"
                                  />
                                </div>
                                {msg.imageCaption && (
                                  <p className="mt-0.5 px-0.5 text-[10.5px] leading-tight">
                                    {msg.imageCaption}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words text-[11px] leading-tight">
                                {!msg.isCurrentUser && msg.sender ? (
                                  <span className="mb-0.5 block text-[10px] font-semibold text-emerald-700">
                                    {msg.sender}
                                  </span>
                                ) : null}
                                {msg.text}
                              </p>
                            )}

                            <div className="mt-0.5 flex items-center justify-end gap-1 self-end">
                              <span
                                className={cn(
                                  "text-[8.5px]",
                                  msg.isCurrentUser
                                    ? "text-emerald-800/70"
                                    : "text-neutral-400",
                                )}
                              >
                                {msg.timestamp}
                              </span>
                              {msg.isCurrentUser && (
                                <DoubleCheckIcon className="h-3 w-3 text-[#34b7f1]" />
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}

                      {(showTyping || (interactive && busy)) && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center justify-start"
                        >
                          <div className="flex items-center gap-1.5 rounded-xl rounded-tl-none bg-white px-3 py-2">
                            <span className="text-[10px] font-semibold text-emerald-600">
                              …
                            </span>
                            <div className="flex items-center gap-1">
                              {[0, 1, 2].map((dotIndex) => (
                                <motion.span
                                  key={dotIndex}
                                  className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                                  animate={{
                                    y: [0, -3, 0],
                                    opacity: [0.4, 1, 0.4],
                                  }}
                                  transition={{
                                    duration: 0.6,
                                    repeat: Infinity,
                                    delay: dotIndex * 0.15,
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </>
            )}
          </div>

          {interactive ? (
            <form
              className="z-20 flex shrink-0 items-end gap-1.5 bg-[#f0f2f5] p-2"
              onSubmit={(e) => {
                e.preventDefault();
                onSend?.();
              }}
            >
              <button
                type="button"
                tabIndex={-1}
                className="mb-0.5 p-1 text-neutral-600"
                aria-hidden
              >
                <EmojiIcon />
              </button>
              <div className="flex min-w-0 flex-1 items-end rounded-[20px] bg-white px-3 py-1.5 text-xs text-neutral-400">
                <textarea
                  ref={inputRef}
                  value={draft}
                  rows={1}
                  onChange={(e) => {
                    onDraftChange?.(e.target.value);
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (draft.trim() && !busy) onSend?.();
                    }
                  }}
                  disabled={busy}
                  placeholder={placeholder}
                  className="max-h-[88px] min-h-[20px] min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[11px] leading-[1.35] text-neutral-800 outline-none placeholder:text-neutral-400"
                />
              </div>
              <button
                type={canSend ? "submit" : "button"}
                disabled={busy}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition enabled:hover:bg-emerald-600 disabled:opacity-50"
                aria-label={canSend ? "Envoyer" : "Micro"}
              >
                {canSend ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                ) : (
                  <MicrophoneIcon />
                )}
              </button>
            </form>
          ) : (
            <div className="z-20 flex shrink-0 items-center gap-1.5 bg-[#f0f2f5] p-2">
              <button type="button" className="p-1 text-neutral-600" tabIndex={-1} aria-hidden>
                <EmojiIcon />
              </button>
              <div className="flex flex-1 items-center rounded-full bg-white px-3 py-1.5 text-xs text-neutral-400">
                <span className="truncate">Message</span>
              </div>
              <button
                type="button"
                tabIndex={-1}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white"
                aria-hidden
              >
                <MicrophoneIcon />
              </button>
            </div>
          )}

          <div className="flex shrink-0 justify-center bg-[#f0f2f5] pt-0.5 pb-1.5">
            <div className="h-1 w-24 rounded-full bg-neutral-400" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default MobileMockup;
