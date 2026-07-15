import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  LogOut,
  QrCode,
  RefreshCw,
  Smartphone,
  Store,
  Unplug,
} from 'lucide-react';
import {
  disconnectWhatsApp,
  fetchEvolutionQr,
  fetchSettings,
  saveBusinessProfile,
  setAutoReply,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { qrImageSrc } from '@/lib/qr';

type SettingsTab = 'connection' | 'business';

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
  const [savingBusiness, setSavingBusiness] = useState(false);

  const [autoReplyOn, setAutoReplyOn] = useState(true);
  const [autoReplyBusy, setAutoReplyBusy] = useState(false);
  const [autoReplyFb, setAutoReplyFb] = useState('');

  const [qrData, setQrData] = useState<{
    connected: boolean;
    message: string;
    base64?: string;
    pairingCode?: string;
  } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const connected = user?.whatsapp?.connected ?? false;

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSettings();
      setOwnerName(s.business.ownerName || user?.name || '');
      setOffer(s.business.offer || '');
      setPrice(s.business.price || '');
      setAutoReplyOn(s.autoReply !== false);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [user?.name]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const toggleAutoReply = useCallback(async () => {
    const next = !autoReplyOn;
    setAutoReplyBusy(true);
    setAutoReplyFb('');
    try {
      await setAutoReply(next);
      setAutoReplyOn(next);
      setAutoReplyFb(next ? 'Réponses auto activées.' : 'Réponses auto désactivées.');
    } catch (err) {
      setAutoReplyFb(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setAutoReplyBusy(false);
    }
  }, [autoReplyOn]);

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

  // Charge un QR uniquement au premier affichage déconnecté — pas en boucle (connect tue la session).
  useEffect(() => {
    if (tab !== 'connection' || connected) return;
    void loadQr();
  }, [tab, connected, loadQr]);

  // Quand déconnecté, on poll l'état (léger) pour basculer dès que la session revient.
  useEffect(() => {
    if (tab !== 'connection' || connected) return;
    const id = setInterval(() => void refreshUser(), 5_000);
    return () => clearInterval(id);
  }, [tab, connected, refreshUser]);

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Déconnecter ce numéro WhatsApp ? Tu pourras ensuite en connecter un autre en scannant un nouveau QR code.',
      )
    ) {
      return;
    }
    setDisconnecting(true);
    try {
      await disconnectWhatsApp();
      setQrData(null);
      await refreshUser();
      await loadQr();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Échec de la déconnexion.');
    } finally {
      setDisconnecting(false);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: typeof Smartphone }[] = [
    { id: 'connection', label: 'WhatsApp', icon: Smartphone },
    { id: 'business', label: 'Profil business', icon: Store },
  ];

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="brand-radial">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          {/* En-tête */}
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-2xl font-light text-text-100">Réglages</h1>
              <p className="mt-1 text-sm text-text-400">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-sm text-text-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          </div>

          {/* Onglets */}
          <div className="mb-6 inline-flex rounded-xl border border-black/10 bg-bg-100 p-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
                    tab === t.id
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-text-400 hover:bg-bg-200 hover:text-text-200',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="panel h-40 animate-pulse" />
          ) : tab === 'connection' ? (
            <div className="space-y-4">
              {/* Bandeau d'état */}
              <div className="panel p-5">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                      connected
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-amber-500/15 text-amber-400',
                    )}
                  >
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="status-dot"
                        style={{ background: connected ? '#34d399' : '#fbbf24' }}
                      />
                      <h2 className="text-sm font-semibold text-text-100">
                        {connected ? 'WhatsApp connecté' : 'WhatsApp non connecté'}
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-text-400">
                      {connected
                        ? 'Ton compte est lié. L’agent peut envoyer et répondre aux messages.'
                        : 'Scanne le QR code pour lier ton compte WhatsApp.'}
                    </p>
                  </div>
                </div>

                {connected && (
                  <div className="mt-5 border-t border-black/10 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-text-500">
                        Pour utiliser un autre numéro, déconnecte celui-ci puis scanne un nouveau QR.
                      </p>
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <Unplug className="h-4 w-4" />
                        {disconnecting ? 'Déconnexion…' : 'Déconnecter'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Interrupteur réponses auto */}
              <div className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-text-100">Réponses automatiques</h2>
                    <p className="mt-0.5 text-xs text-text-400">
                      Quand une campagne est active, l’agent répond seul aux prospects contactés.
                      {autoReplyOn ? '' : ' Actuellement OFF — les messages ne sont pas traités auto.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleAutoReply()}
                    disabled={autoReplyBusy}
                    className={cn(
                      'relative h-8 w-14 shrink-0 rounded-full transition',
                      autoReplyOn ? 'bg-brand' : 'bg-bg-300',
                      autoReplyBusy && 'opacity-50',
                    )}
                    aria-pressed={autoReplyOn}
                    aria-label="Activer ou désactiver les réponses auto"
                  >
                    <span
                      className={cn(
                        'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition',
                        autoReplyOn ? 'left-7' : 'left-1',
                      )}
                    />
                  </button>
                </div>
                <Feedback text={autoReplyFb} type={autoReplyFb.includes('Erreur') ? 'err' : 'ok'} />
              </div>

              {/* Panneau QR quand non connecté */}
              {!connected && (
                <div className="panel p-5">
                  <div className="flex flex-col items-center text-center">
                    {qrLoading && !qrData ? (
                      <div className="flex h-[240px] w-[240px] items-center justify-center rounded-2xl border border-black/10 bg-bg-0">
                        <RefreshCw className="h-6 w-6 animate-spin text-text-500" />
                      </div>
                    ) : qrData?.base64 ? (
                      <img
                        src={qrImageSrc(qrData.base64)}
                        alt="QR WhatsApp"
                        className="h-[240px] w-[240px] rounded-2xl border-4 border-white bg-white object-contain p-1 shadow-lg"
                      />
                    ) : (
                      <div className="flex h-[240px] w-[240px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/15 bg-bg-0 text-text-500">
                        <QrCode className="h-8 w-8" />
                        <span className="text-xs">QR indisponible</span>
                      </div>
                    )}

                    {qrData?.pairingCode && (
                      <p className="mt-4 font-mono text-lg tracking-widest text-text-100">
                        {qrData.pairingCode}
                      </p>
                    )}

                    <div className="mt-4 max-w-sm text-xs leading-relaxed text-text-400">
                      Ouvre <strong className="text-text-200">WhatsApp</strong> →{' '}
                      <strong className="text-text-200">Appareils connectés</strong> →{' '}
                      <strong className="text-text-200">Lier un appareil</strong>, puis scanne ce
                      code.
                    </div>

                    <button
                      type="button"
                      onClick={() => void loadQr()}
                      disabled={qrLoading}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-4 py-2 text-sm text-text-300 transition hover:bg-bg-200 disabled:opacity-50"
                    >
                      <RefreshCw className={cn('h-4 w-4', qrLoading && 'animate-spin')} />
                      Actualiser le QR
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="panel p-6">
              <div className="mb-5 flex items-center gap-2">
                <Store className="h-4 w-4 text-brand" />
                <h2 className="text-sm font-semibold text-text-100">Profil business</h2>
              </div>
              <p className="-mt-2 mb-5 text-xs text-text-400">
                Ces informations aident l’agent à personnaliser tes messages.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-400">Ton nom</label>
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Ex. Awa"
                    className="w-full rounded-xl border border-black/10 bg-bg-0 px-3.5 py-2.5 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand-border focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-400">Offre</label>
                  <textarea
                    value={offer}
                    onChange={(e) => setOffer(e.target.value)}
                    rows={3}
                    placeholder="Ex. Formation en marketing digital, coaching 1-1…"
                    className="w-full resize-none rounded-xl border border-black/10 bg-bg-0 px-3.5 py-2.5 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand-border focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-text-400">
                    Prix <span className="text-text-500">(optionnel)</span>
                  </label>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Ex. 25 000 FCFA"
                    className="w-full rounded-xl border border-black/10 bg-bg-0 px-3.5 py-2.5 text-sm text-text-100 outline-none transition placeholder:text-text-500 focus:border-brand-border focus:ring-2 focus:ring-brand/20"
                  />
                </div>
                <button
                  type="button"
                  disabled={savingBusiness}
                  onClick={async () => {
                    setSavingBusiness(true);
                    try {
                      await saveBusinessProfile({ ownerName, offer, price });
                      setBusinessFb('Profil enregistré.');
                    } catch (err) {
                      setBusinessFb(err instanceof Error ? err.message : 'Erreur');
                    } finally {
                      setSavingBusiness(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {savingBusiness ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <Feedback
                  text={businessFb}
                  type={businessFb.includes('Erreur') ? 'err' : 'ok'}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
