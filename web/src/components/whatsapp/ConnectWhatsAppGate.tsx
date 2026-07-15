import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchEvolutionQr,
  fetchEvolutionState,
  rebootEvolutionInstance,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { qrImageSrc } from '@/lib/qr';

// Un QR Evolution/Baileys reste valide ~45-60 s. On évite de le régénérer
// trop souvent : chaque /qr peut appeler /instance/connect et casser la session.
const QR_REFRESH_MS = 55_000;
const STATE_POLL_MS = 5_000;

export function ConnectWhatsAppGate() {
  const { refreshUser } = useAuth();
  const [qrData, setQrData] = useState<{
    connected: boolean;
    message: string;
    base64?: string;
    pairingCode?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const lastQrAt = useRef(0);
  const consecutiveClose = useRef(0);

  const loadQr = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await fetchEvolutionQr();
        setQrData(data);
        lastQrAt.current = Date.now();
        if (data.connected) void refreshUser();
      } catch (err) {
        if (!silent) {
          setQrData({
            connected: false,
            message: err instanceof Error ? err.message : 'Erreur QR',
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [refreshUser],
  );

  useEffect(() => {
    void loadQr();
    const id = setInterval(() => {
      void (async () => {
        try {
          const state = await fetchEvolutionState();
          if (state.connected) {
            consecutiveClose.current = 0;
            setQrData({ connected: true, message: state.message });
            void refreshUser();
            return;
          }
          consecutiveClose.current += 1;
          // Ne régénérer le QR qu'après plusieurs close confirmés + délai d'expiration QR
          if (
            consecutiveClose.current >= 3 &&
            Date.now() - lastQrAt.current > QR_REFRESH_MS
          ) {
            void loadQr(true);
          }
        } catch {
          /* ignore poll errors — ne pas déclencher de QR */
        }
      })();
    }, STATE_POLL_MS);
    return () => clearInterval(id);
  }, [loadQr, refreshUser]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg-0 px-4 py-10">
      <div className="w-full max-w-md animate-fade-in text-center">
        <div className="mb-6 flex justify-center">
          <KlanvioLogo variant="full" size="lg" />
        </div>
        <h1 className="text-xl font-medium text-text-100">Connectez votre WhatsApp</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-400">
          Pour utiliser l&apos;agent Klanvio, scannez le QR code avec WhatsApp →{' '}
          <strong className="text-text-200">Appareils connectés</strong>.
          <br />
          Sans connexion, l&apos;agent ne peut effectuer aucune action.
        </p>

        <div className="mt-8 rounded-2xl border border-black/10 bg-bg-100 p-6">
          {loading ? (
            <p className="text-sm text-text-500">Chargement du QR…</p>
          ) : qrData?.connected ? (
            <p className="text-sm text-emerald-400">{qrData.message || 'WhatsApp connecté !'}</p>
          ) : (
            <div className="space-y-4">
              {qrData?.base64 && (
                <img
                  src={qrImageSrc(qrData.base64)}
                  alt="QR WhatsApp"
                  className="mx-auto max-w-[220px] rounded-lg border border-black/10 bg-white p-2"
                />
              )}
              {qrData?.pairingCode && (
                <p className="font-mono text-lg tracking-widest text-text-100">
                  {qrData.pairingCode}
                </p>
              )}
              {qrData?.message && (
                <p className="text-xs text-text-500">{qrData.message}</p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void loadQr()}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
            >
              Actualiser
            </button>
            <button
              type="button"
              onClick={() => void rebootEvolutionInstance().then(() => loadQr())}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
            >
              Redémarrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
