import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Loader2, Mic, Plus, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CHAT_ACCEPT,
  CHAT_MAX_FILES,
  type ChatAttachment,
} from '@/lib/chat-attachments';
import { transcribeChatAudio, uploadChatFiles } from '@/lib/api';

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
    },
    ref,
  ) {
  const [message, setMessage] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [localSending, setLocalSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasContent = message.trim().length > 0 || pendingFiles.length > 0;
  const busy = locked || uploading || isRecording || transcribing;

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

  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingSeconds(0);
  }, [isRecording]);

  // Dictée vocale : on transcrit l'enregistrement puis on l'insère dans l'input
  // en texte (l'utilisateur peut relire/corriger avant d'envoyer).
  const transcribeRecording = useCallback(async (blob: Blob) => {
    if (blob.size === 0) return;
    setTranscribing(true);
    try {
      const text = (await transcribeChatAudio(blob)).trim();
      if (text) {
        setMessage((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    } catch (err) {
      alert('Transcription impossible : ' + (err instanceof Error ? err.message : 'erreur'));
    } finally {
      setTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        void transcribeRecording(blob);
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s >= 120) {
            stopRecording();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      alert('Microphone non disponible : ' + (err instanceof Error ? err.message : 'erreur'));
    }
  }, [transcribeRecording, stopRecording]);

  const handleSend = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }
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
  }, [message, pendingFiles, busy, isRecording, stopRecording, onSend]);

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

  const recMin = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
  const recSec = (recordingSeconds % 60).toString().padStart(2, '0');

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
          {isRecording && (
            <div className="flex items-center gap-2 px-1 text-xs text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              Dictée en cours… {recMin}:{recSec} — appuie pour arrêter
            </div>
          )}
          {transcribing && (
            <div className="flex items-center gap-2 px-1 text-xs text-brand">
              <Loader2 className="h-3 w-3 animate-spin" />
              Transcription en cours…
            </div>
          )}

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

            <button
              type="button"
              disabled={locked || uploading || transcribing}
              title={isRecording ? 'Arrêter la dictée' : 'Dicter un message'}
              onClick={() => (isRecording ? stopRecording() : void startRecording())}
              className={cn(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
                isRecording
                  ? 'bg-red-500/20 text-red-400 animate-pulse'
                  : 'text-text-500 hover:bg-bg-300 hover:text-text-300',
              )}
            >
              {transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={(!hasContent && !isRecording) || (locked && !isRecording) || uploading || transcribing}
              aria-label="Envoyer"
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-xl transition-all duration-200 active:scale-95',
                isHero ? 'h-9 w-9' : 'h-8 w-8',
                (hasContent || isRecording) && !uploading
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
