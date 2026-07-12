import { useCallback, useEffect, useState } from 'react';
import { fetchEvolutionQr, rebootEvolutionInstance } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';

export function ConnectWhatsAppGate() {
  const { refreshUser } = useAuth();
  const [qrData, setQrData] = useState<{
    connected: boolean;
    message: string;
    base64?: string;
    pairingCode?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadQr = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEvolutionQr();
      setQrData(data);
      if (data.connected) void refreshUser();
    } catch (err) {
      setQrData({
        connected: false,
        message: err instanceof Error ? err.message : 'Erreur QR',
      });
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    void loadQr();
    const id = setInterval(() => void loadQr(), 5000);
    return () => clearInterval(id);
  }, [loadQr]);

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

        <div className="mt-8 rounded-2xl border border-white/10 bg-bg-100 p-6">
          {loading ? (
            <p className="text-sm text-text-500">Chargement du QR…</p>
          ) : qrData?.connected ? (
            <p className="text-sm text-emerald-400">{qrData.message || 'WhatsApp connecté !'}</p>
          ) : (
            <div className="space-y-4">
              {qrData?.base64 && (
                <img
                  src={`data:image/png;base64,${qrData.base64}`}
                  alt="QR WhatsApp"
                  className="mx-auto max-w-[220px] rounded-lg border border-white/10 bg-white p-2"
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
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
            >
              Actualiser
            </button>
            <button
              type="button"
              onClick={() => void rebootEvolutionInstance().then(() => loadQr())}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
            >
              Redémarrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
