import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Brain, Loader2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CHAT_ACCEPT,
  CHAT_MAX_FILES,
  type ChatAttachment,
} from '@/lib/chat-attachments';
import { uploadChatFiles } from '@/lib/api';

type PendingFile = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export interface KlanvioChatInputProps {
  onSend: (message: string, attachments?: ChatAttachment[]) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  variant?: 'hero' | 'dock';
  autoGrow?: boolean;
  hideHint?: boolean;
  className?: string;
  /** Focus le champ dès le montage (changement de fil). */
  autoFocus?: boolean;
  /** Ouvre le sélecteur de mémoire pour ce fil. */
  onOpenMemory?: () => void;
  memoryLinked?: boolean;
  memoryName?: string | null;
}

export type KlanvioChatInputHandle = {
  focus: () => void;
};

export const KlanvioChatInput = forwardRef<KlanvioChatInputHandle, KlanvioChatInputProps>(
  function KlanvioChatInput(
    {
      onSend,
      disabled = false,
      placeholder = 'Donnez une instruction à l\'agent WhatsApp…',
      variant = 'dock',
      autoGrow = true,
      hideHint = false,
      className,
      autoFocus = false,
      onOpenMemory,
      memoryLinked = false,
      memoryName = null,
    },
    ref,
  ) {
  const [message, setMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [localSending, setLocalSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendingLockRef = useRef(false);
  const isHero = variant === 'hero';
  const locked = disabled || localSending;

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = textareaRef.current;
      if (!el || locked) return;
      el.focus({ preventScroll: true });
    },
  }));

  useEffect(() => {
    if (!autoFocus || locked) return;
    const t = window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(t);
  }, [autoFocus, locked]);

  useEffect(() => {
    if (!autoGrow) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = isHero ? 200 : 160;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [message, isHero, autoGrow]);

  useEffect(() => {
    return () => {
      for (const p of pendingFiles) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasContent = message.trim().length > 0 || pendingFiles.length > 0;
  const busy = locked || uploading;

  const removePending = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const remaining = CHAT_MAX_FILES - pendingFiles.length;
      if (remaining <= 0) return;

      const incoming = Array.from(fileList).slice(0, remaining);
      setPendingFiles((prev) => [
        ...prev,
        ...incoming.map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        })),
      ]);
    },
    [pendingFiles.length],
  );

  const handleSend = useCallback(async () => {
    const text = message.trim();
    if ((!text && pendingFiles.length === 0) || busy || sendingLockRef.current) return;

    const filesSnapshot = pendingFiles;
    const filesToUpload = filesSnapshot.map((p) => p.file);
    sendingLockRef.current = true;
    setLocalSending(true);
    setMessage('');
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      let attachments: ChatAttachment[] = [];
      if (filesToUpload.length > 0) {
        setUploading(true);
        try {
          attachments = await uploadChatFiles(filesToUpload);
        } catch (err) {
          setMessage(text);
          setPendingFiles(filesSnapshot);
          alert('Envoi impossible : ' + (err instanceof Error ? err.message : 'erreur upload'));
          return;
        }
      }
      for (const p of filesSnapshot) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      await onSend(text, attachments);
    } finally {
      setUploading(false);
      setLocalSending(false);
      sendingLockRef.current = false;
    }
  }, [message, pendingFiles, busy, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboard = e.clipboardData;
      if (!clipboard) return;
      const files: File[] = [];
      if (clipboard.files?.length) {
        files.push(...Array.from(clipboard.files));
      } else {
        for (const item of clipboard.items) {
          if (item.kind !== 'file') continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      const dt = new DataTransfer();
      for (const file of files) dt.items.add(file);
      addFiles(dt.files);
    },
    [addFiles],
  );

  return (
    <div
      className={cn(
        'relative mx-auto w-full',
        isHero ? 'max-w-2xl px-0' : 'max-w-3xl px-4 pb-3 pt-2',
        className,
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept={CHAT_ACCEPT}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        className={cn(
          'flex flex-col rounded-2xl border border-brand-border bg-bg-100 shadow-sm transition-all duration-300',
          isHero && 'min-h-[120px] shadow-md',
          'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20',
          busy && 'opacity-70',
        )}
      >
        <div className={cn('flex flex-col gap-1.5', isHero ? 'px-4 pb-3 pt-4' : 'px-3 pb-1.5 pt-2')}>
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 pl-1">
              {pendingFiles.map((item) => (
                <div
                  key={item.id}
                  className="group relative flex max-w-[140px] flex-col overflow-hidden rounded-xl border border-bg-300 bg-bg-200"
                >
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="h-16 w-full object-cover" />
                  ) : (
                    <div className="flex h-16 items-center justify-center px-2 text-[10px] text-text-400">
                      {item.file.name}
                    </div>
                  )}
                  <span className="truncate px-2 py-1 text-[10px] text-text-400">
                    {formatFileSize(item.file.size)}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removePending(item.id)}
                    className="absolute right-1 top-1 rounded-full bg-bg-0/80 p-0.5 text-text-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-100"
                    aria-label="Retirer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={cn('pl-1', isHero ? 'min-h-[3.5rem]' : autoGrow ? 'min-h-[2.25rem]' : 'h-9')}>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={locked ? "L'agent réfléchit…" : placeholder}
              disabled={busy}
              readOnly={locked}
              rows={isHero ? 2 : 1}
              className={cn(
                'block w-full resize-none border-0 bg-transparent leading-relaxed text-text-100',
                'placeholder:text-text-500 outline-none disabled:cursor-not-allowed',
                isHero ? 'text-base' : 'text-[14px]',
                !autoGrow && 'h-9 overflow-y-auto py-1.5 scrollbar-none',
              )}
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy || pendingFiles.length >= CHAT_MAX_FILES}
              title="Joindre des fichiers"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-500 transition-colors hover:bg-bg-300 hover:text-text-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-5 w-5" />
            </button>

            {onOpenMemory ? (
              <button
                type="button"
                disabled={locked}
                onClick={onOpenMemory}
                title={
                  memoryLinked
                    ? `Mémoire : ${memoryName || 'connectée'}`
                    : 'Connecter une mémoire à cette automatisation'
                }
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition disabled:opacity-40',
                  memoryLinked
                    ? 'bg-brand/10 text-brand hover:bg-brand/15'
                    : 'bg-amber-500/15 text-amber-800 hover:bg-amber-500/25',
                )}
              >
                <Brain className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[6.5rem] truncate">
                  {memoryLinked ? memoryName || 'Mémoire' : 'Mémoire'}
                </span>
              </button>
            ) : null}

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!hasContent || locked || uploading}
              aria-label="Envoyer"
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-xl transition-all duration-200 active:scale-95',
                isHero ? 'h-9 w-9' : 'h-8 w-8',
                hasContent && !uploading
                  ? 'bg-brand text-white shadow-md hover:bg-brand-dark'
                  : 'bg-bg-300 text-text-500 cursor-default',
              )}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>

      {!isHero && !hideHint && (
        <p className="mt-1.5 text-center text-[10px] text-text-500">
          <kbd className="rounded border border-bg-300 bg-bg-200 px-1.5 py-0.5 font-sans text-[10px]">Entrée</kbd>
          {` pour envoyer · `}
          <kbd className="rounded border border-bg-300 bg-bg-200 px-1.5 py-0.5 font-sans text-[10px]">Maj</kbd>
          {' + '}
          <kbd className="rounded border border-bg-300 bg-bg-200 px-1.5 py-0.5 font-sans text-[10px]">Entrée</kbd>
          {` nouvelle ligne`}
        </p>
      )}
    </div>
  );
  },
);
