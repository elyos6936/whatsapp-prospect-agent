import { useCallback, useEffect, useState } from 'react';
import {
  fetchEvolutionQr,
  fetchSettings,
  rebootEvolutionInstance,
  resetOutboundQuota,
  saveBusinessProfile,
  setAutoReply,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type SettingsTab = 'business' | 'connection';

function Feedback({ text, type }: { text: string; type?: 'ok' | 'err' }) {
  if (!text) return null;
  return (
    <p
      className={cn(
        'mt-2 text-sm',
        type === 'ok' && 'text-emerald-400',
        type === 'err' && 'text-red-400',
        !type && 'text-text-400',
      )}
    >
      {text}
    </p>
  );
}

export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();
  const [tab, setTab] = useState<SettingsTab>('connection');
  const [loading, setLoading] = useState(true);

  const [ownerName, setOwnerName] = useState('');
  const [offer, setOffer] = useState('');
  const [price, setPrice] = useState('');
  const [businessFb, setBusinessFb] = useState('');

  const [autoReply, setAutoReplyLocal] = useState(true);
  const [quotaFb, setQuotaFb] = useState('');

  const [qrData, setQrData] = useState<{
    connected: boolean;
    message: string;
    base64?: string;
    pairingCode?: string;
  } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSettings();
      setOwnerName(s.business.ownerName || user?.name || '');
      setOffer(s.business.offer || '');
      setPrice(s.business.price || '');
      setAutoReplyLocal(s.autoReply);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [user?.name]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadQr = useCallback(async () => {
    setQrLoading(true);
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
      setQrLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (tab === 'connection') void loadQr();
  }, [tab, loadQr]);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'connection', label: 'Connexion WhatsApp' },
    { id: 'business', label: 'Profil business' },
  ];

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-medium text-text-100">Réglages</h1>
            <p className="mt-1 text-sm text-text-500">
              Connecté en tant que {user?.email}
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-text-400 hover:bg-bg-100 hover:text-red-400"
          >
            Déconnexion
          </button>
        </div>

        <div className="mb-6 flex gap-2 border-b border-white/10 pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm transition',
                tab === t.id
                  ? 'bg-brand-muted font-medium text-brand'
                  : 'text-text-500 hover:text-text-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-text-500">Chargement…</p>
        ) : tab === 'connection' ? (
          <section className="space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <h2 className="text-sm font-medium text-text-200">Connexion WhatsApp</h2>
            <p className="text-xs text-text-500">
              Scannez le QR avec WhatsApp → Appareils connectés. Votre instance est provisionnée
              automatiquement.
            </p>

            {qrLoading ? (
              <p className="text-sm text-text-500">Chargement du QR…</p>
            ) : qrData?.connected ? (
              <p className="text-sm text-emerald-400">{qrData.message || 'WhatsApp connecté.'}</p>
            ) : (
              <div className="space-y-3">
                {qrData?.base64 && (
                  <img
                    src={`data:image/png;base64,${qrData.base64}`}
                    alt="QR WhatsApp"
                    className="max-w-[220px] rounded-lg border border-white/10 bg-white p-2"
                  />
                )}
                {qrData?.pairingCode && (
                  <p className="font-mono text-sm text-text-200">Code : {qrData.pairingCode}</p>
                )}
                {qrData?.message && <p className="text-xs text-text-500">{qrData.message}</p>}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadQr()}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-text-300 hover:bg-bg-200"
              >
                Actualiser QR
              </button>
              <button
                type="button"
                onClick={() => void rebootEvolutionInstance().then(() => loadQr())}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-text-300 hover:bg-bg-200"
              >
                Redémarrer instance
              </button>
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-300">
                <input
                  type="checkbox"
                  checked={autoReply}
                  onChange={(e) => {
                    setAutoReplyLocal(e.target.checked);
                    void setAutoReply(e.target.checked);
                  }}
                  className="rounded border-white/20"
                />
                Réponses automatiques WhatsApp
              </label>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await resetOutboundQuota();
                    setQuotaFb(`Quota réinitialisé : ${r.outbound.limit} messages/jour`);
                  } catch (err) {
                    setQuotaFb(err instanceof Error ? err.message : 'Erreur');
                  }
                }}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-text-300 hover:bg-bg-200"
              >
                Réinitialiser quota du jour
              </button>
              <Feedback text={quotaFb} type={quotaFb.includes('Erreur') ? 'err' : 'ok'} />
            </div>
          </section>
        ) : (
          <section className="space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <h2 className="text-sm font-medium text-text-200">Profil business</h2>
            <p className="text-xs text-text-500">
              Ces informations sont utilisées par l&apos;agent pour personnaliser vos messages.
            </p>
            <div>
              <label className="mb-1 block text-xs text-text-500">Votre nom</label>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-500">Offre</label>
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border border-white/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-500">Prix (optionnel)</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand"
              />
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await saveBusinessProfile({
                    ownerName,
                    offer,
                    price,
                  });
                  setBusinessFb('Profil enregistré.');
                } catch (err) {
                  setBusinessFb(err instanceof Error ? err.message : 'Erreur');
                }
              }}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Enregistrer
            </button>
            <Feedback text={businessFb} type={businessFb.includes('Erreur') ? 'err' : 'ok'} />
          </section>
        )}
      </div>
    </div>
  );
}
