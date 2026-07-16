import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, X } from 'lucide-react';
import {
  fetchEvolutionQr,
  fetchEvolutionState,
  rebootEvolutionInstance,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qrImageSrc } from '@/lib/qr';
import { cn } from '@/lib/utils';

/** Nettoie tout jargon technique (Evolution, instance, API…) des messages serveur. */
export function sanitizeWhatsAppUserMessage(raw: string | undefined | null): string {
  if (!raw?.trim()) return '';
  let t = raw.trim();
  t = t.replace(/\bEvolution\s*API\b/gi, 'WhatsApp');
  t = t.replace(/\bEvolution\b/gi, 'WhatsApp');
  t = t.replace(/\bBaileys\b/gi, 'WhatsApp');
  t = t.replace(/\binstance\b/gi, 'compte');
  t = t.replace(/\bAPI\b/g, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}

const QR_REFRESH_MS = 55_000;
const STATE_POLL_MS = 5_000;

type WhatsAppConnectModalProps = {
  open: boolean;
  /** Si false, la croix / fond ne ferment pas (gate obligatoire). */
  dismissible?: boolean;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  onConnected?: () => void;
};

export function WhatsAppConnectModal({
  open,
  dismissible = true,
  title = 'Connecter WhatsApp',
  subtitle = 'Scanne le QR avec WhatsApp → Appareils connectés → Lier un appareil.',
  onClose,
  onConnected,
}: WhatsAppConnectModalProps) {
  const { refreshUser } = useAuth();
  const [qrData, setQrData] = useState<{
    connected: boolean;
    message: string;
    base64?: string;
    pairingCode?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lastQrAt = useRef(0);
  const consecutiveClose = useRef(0);

  const loadQr = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await fetchEvolutionQr();
        setQrData({
          ...data,
          message: sanitizeWhatsAppUserMessage(data.message),
        });
        lastQrAt.current = Date.now();
        if (data.connected) {
          void refreshUser();
          onConnected?.();
        }
      } catch (err) {
        if (!silent) {
          setQrData({
            connected: false,
            message: sanitizeWhatsAppUserMessage(
              err instanceof Error ? err.message : 'Impossible de charger le QR.',
            ),
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onConnected, refreshUser],
  );

  useEffect(() => {
    if (!open) return;
    consecutiveClose.current = 0;
    void loadQr();
    const id = setInterval(() => {
      void (async () => {
        try {
          const state = await fetchEvolutionState();
          if (state.connected) {
            consecutiveClose.current = 0;
            setQrData({
              connected: true,
              message: sanitizeWhatsAppUserMessage(state.message) || 'WhatsApp connecté !',
            });
            void refreshUser();
            onConnected?.();
            return;
          }
          consecutiveClose.current += 1;
          if (
            consecutiveClose.current >= 3 &&
            Date.now() - lastQrAt.current > QR_REFRESH_MS
          ) {
            void loadQr(true);
          }
        } catch {
          /* ignore poll */
        }
      })();
    }, STATE_POLL_MS);
    return () => clearInterval(id);
  }, [open, loadQr, onConnected, refreshUser]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  const friendlyMsg = sanitizeWhatsAppUserMessage(qrData?.message);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label={dismissible ? 'Fermer' : undefined}
        disabled={!dismissible}
        onClick={() => dismissible && onClose?.()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-connect-title"
        className="relative z-10 w-full max-w-[420px] rounded-2xl border border-black/[0.08] bg-bg-0 p-5 shadow-2xl sm:p-6"
      >
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-text-500 transition hover:bg-bg-200 hover:text-text-200"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <h2 id="wa-connect-title" className="pr-8 text-lg font-semibold text-text-100">
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text-400">{subtitle}</p>

        <div className="mt-5 flex flex-col items-center text-center">
          {loading && !qrData ? (
            <div className="flex h-[220px] w-[220px] items-center justify-center rounded-2xl border border-black/10 bg-bg-100">
              <RefreshCw className="h-6 w-6 animate-spin text-text-500" />
            </div>
          ) : qrData?.connected ? (
            <p className="rounded-xl bg-emerald-500/10 px-4 py-6 text-sm font-medium text-emerald-400">
              {friendlyMsg || 'WhatsApp connecté !'}
            </p>
          ) : qrData?.base64 ? (
            <img
              src={qrImageSrc(qrData.base64)}
              alt="QR WhatsApp"
              className="h-[220px] w-[220px] rounded-2xl border-4 border-white bg-white object-contain p-1 shadow-lg"
            />
          ) : (
            <div className="flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/15 bg-bg-100 text-text-500">
              <QrCode className="h-8 w-8" />
              <span className="px-3 text-xs">{friendlyMsg || 'QR indisponible'}</span>
            </div>
          )}

          {qrData?.pairingCode && !qrData.connected && (
            <p className="mt-4 font-mono text-lg tracking-widest text-text-100">
              {qrData.pairingCode}
            </p>
          )}

          {!qrData?.connected && friendlyMsg && qrData?.base64 && (
            <p className="mt-3 text-xs text-text-500">{friendlyMsg}</p>
          )}

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void loadQr()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-4 py-2 text-sm text-text-300 transition hover:bg-bg-200 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Actualiser le QR
            </button>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => {
                setBusy(true);
                void rebootEvolutionInstance()
                  .then(() => loadQr())
                  .finally(() => setBusy(false));
              }}
              className="rounded-xl border border-black/10 px-4 py-2 text-sm text-text-300 transition hover:bg-bg-200 disabled:opacity-50"
            >
              Réessayer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
