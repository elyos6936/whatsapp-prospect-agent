import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Link2,
  LogOut,
  Smartphone,
  Unplug,
} from 'lucide-react';
import {
  disconnectWhatsApp,
  fetchSettings,
  setAutoReply,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { WhatsAppConnectModal } from '@/components/whatsapp/WhatsAppConnectModal';
import { TypeformIntegrationCard } from '@/components/settings/TypeformIntegrationCard';
import { GoogleSheetsIntegrationCard } from '@/components/settings/GoogleSheetsIntegrationCard';

type SettingsTab = 'connection' | 'integrations' | 'billing';

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

function readInitialTab(): SettingsTab {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') === 'integrations') return 'integrations';
  } catch {
    /* ignore */
  }
  return 'connection';
}

function readTypeformFlash(): { type: 'ok' | 'err'; text: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const tf = params.get('typeform');
    if (tf === 'connected') {
      return { type: 'ok', text: 'Typeform connecté avec succès.' };
    }
    if (tf === 'error') {
      return {
        type: 'err',
        text: params.get('message') || 'Échec de la connexion Typeform.',
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readGoogleFlash(): { type: 'ok' | 'err'; text: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g === 'connected') {
      return { type: 'ok', text: 'Google connecté avec succès.' };
    }
    if (g === 'error') {
      return {
        type: 'err',
        text: params.get('message') || 'Échec de la connexion Google.',
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clearIntegrationQueryParams() {
  try {
    const url = new URL(window.location.href);
    if (
      !url.searchParams.has('settings') &&
      !url.searchParams.has('typeform') &&
      !url.searchParams.has('google')
    ) {
      return;
    }
    url.searchParams.delete('settings');
    url.searchParams.delete('typeform');
    url.searchParams.delete('google');
    url.searchParams.delete('message');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();
  const [tab, setTab] = useState<SettingsTab>(() => readInitialTab());
  const [loading, setLoading] = useState(true);
  const typeformFlash = useMemo(() => readTypeformFlash(), []);
  const googleFlash = useMemo(() => readGoogleFlash(), []);

  const [autoReplyOn, setAutoReplyOn] = useState(true);
  const [autoReplyBusy, setAutoReplyBusy] = useState(false);
  const [autoReplyFb, setAutoReplyFb] = useState('');
  const [billingNote, setBillingNote] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);

  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  const connected = user?.whatsapp?.connected ?? false;

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSettings();
      setAutoReplyOn(s.autoReply !== false);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    // Nettoyer l’URL après lecture du flash OAuth
    if (
      typeformFlash ||
      googleFlash ||
      new URLSearchParams(window.location.search).get('settings')
    ) {
      clearIntegrationQueryParams();
    }
  }, [typeformFlash, googleFlash]);

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

  useEffect(() => {
    if (connected || !connectModalOpen) return;
    const id = setInterval(() => void refreshUser(), 5_000);
    return () => clearInterval(id);
  }, [connected, connectModalOpen, refreshUser]);

  useEffect(() => {
    if (connected && connectModalOpen) setConnectModalOpen(false);
  }, [connected, connectModalOpen]);

  const handleDisconnect = async () => {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setDisconnectError('');
    try {
      await disconnectWhatsApp();
      await refreshUser();
      setConnectModalOpen(true);
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : 'Échec de la déconnexion.',
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: typeof Smartphone }[] = [
    { id: 'connection', label: 'WhatsApp', icon: Smartphone },
    { id: 'integrations', label: 'Intégrations', icon: Link2 },
    { id: 'billing', label: 'Facturation', icon: CreditCard },
  ];

  const tabLabels: Record<SettingsTab, { short: string; full: string }> = {
    connection: { short: 'WhatsApp', full: 'WhatsApp' },
    integrations: { short: 'Intégrations', full: 'Intégrations' },
    billing: { short: 'Facturation', full: 'Facturation' },
  };

  return (
    <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar">
      <div className="brand-radial">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h1 className="font-serif text-2xl font-light text-text-100">Réglages</h1>
              <p className="mt-1 truncate text-sm text-text-400">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-xl border border-black/10 px-3 py-2 text-sm text-text-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">Se déconnecter</span>
            </button>
          </div>

          <div className="mb-6 grid w-full grid-cols-3 gap-1 rounded-xl border border-black/10 bg-bg-100 p-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const labels = tabLabels[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center text-[11px] font-medium transition sm:flex-row sm:gap-2 sm:px-3 sm:text-sm',
                    tab === t.id
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-text-400 hover:bg-bg-200 hover:text-text-200',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate sm:hidden">{labels.short}</span>
                  <span className="hidden truncate sm:inline">{labels.full}</span>
                </button>
              );
            })}
          </div>

          {loading && tab === 'connection' ? (
            <div className="panel h-40 animate-pulse" />
          ) : tab === 'connection' ? (
            <div className="space-y-4">
              {/* Contenu WhatsApp inchangé — même structure qu’avant */}
              <WhatsAppSettingsBlock
                connected={connected}
                disconnecting={disconnecting}
                disconnectError={disconnectError}
                autoReplyOn={autoReplyOn}
                autoReplyBusy={autoReplyBusy}
                autoReplyFb={autoReplyFb}
                onConnect={() => setConnectModalOpen(true)}
                onAskDisconnect={() => setConfirmDisconnect(true)}
                onToggleAutoReply={() => void toggleAutoReply()}
              />
            </div>
          ) : tab === 'integrations' ? (
            <div className="panel p-6">
              <div className="mb-1 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-brand" />
                <h2 className="text-sm font-semibold text-text-100">Intégrations</h2>
              </div>
              <p className="mb-5 text-xs text-text-400">
                Lie tes outils pour que Klanvio puisse y accéder en ton nom. Les webhooks et
                l’agent viendront dans une prochaine étape.
              </p>
              <div className="flex flex-col gap-3">
                <TypeformIntegrationCard flash={typeformFlash} />
                <GoogleSheetsIntegrationCard flash={googleFlash} />
              </div>
            </div>
          ) : (
            <div className="panel min-w-0 space-y-5 overflow-hidden p-4 sm:p-5">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text-100">Abonnement Klanvio</h2>
                <p className="mt-1 text-xs leading-relaxed text-text-400">
                  Plan Pro · 15€/mois · 7 jours d’essai inclus à l’inscription
                </p>
              </div>

              <div className="rounded-xl border border-black/10 bg-bg-0 px-4 py-3">
                <div className="flex flex-wrap items-end gap-1">
                  <span className="text-3xl font-semibold tracking-tight text-text-100">15€</span>
                  <span className="mb-1 text-sm text-text-400">/mois</span>
                </div>
                <p className="mt-1 text-xs text-text-500">Tout inclus · résiliable à tout moment</p>
              </div>

              <button
                type="button"
                disabled={billingBusy}
                onClick={() => {
                  setBillingBusy(true);
                  setBillingNote(null);
                  window.setTimeout(() => {
                    setBillingBusy(false);
                    setBillingNote(
                      'Le paiement sera bientôt disponible. L’API de paiement sera branchée ici.',
                    );
                  }, 450);
                }}
                className="inline-flex w-full max-w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4 shrink-0" />
                <span className="truncate">{billingBusy ? 'Redirection…' : 'Payer 15€ / mois'}</span>
              </button>

              {billingNote && (
                <p className="break-words rounded-xl border border-brand/20 bg-brand/5 px-3 py-2.5 text-xs leading-relaxed text-text-400">
                  {billingNote}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        title="Déconnecter WhatsApp ?"
        message="Tu pourras reconnecter ce numéro (ou un autre) immédiatement en scannant un nouveau QR code."
        confirmLabel="Oui, déconnecter"
        cancelLabel="Non"
        danger
        onConfirm={() => void handleDisconnect()}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <WhatsAppConnectModal
        open={connectModalOpen}
        dismissible
        title="Reconnecter WhatsApp"
        subtitle="Scanne le QR avec WhatsApp → Appareils connectés → Lier un appareil. Tu peux utiliser le même numéro ou un autre."
        onClose={() => setConnectModalOpen(false)}
        onConnected={() => setConnectModalOpen(false)}
      />
    </div>
  );
}

/** Bloc WhatsApp — même UX qu’avant le remplacement Profil business → Intégrations. */
function WhatsAppSettingsBlock({
  connected,
  disconnecting,
  disconnectError,
  autoReplyOn,
  autoReplyBusy,
  autoReplyFb,
  onConnect,
  onAskDisconnect,
  onToggleAutoReply,
}: {
  connected: boolean;
  disconnecting: boolean;
  disconnectError: string;
  autoReplyOn: boolean;
  autoReplyBusy: boolean;
  autoReplyFb: string;
  onConnect: () => void;
  onAskDisconnect: () => void;
  onToggleAutoReply: () => void;
}) {
  return (
    <>
      <div className="panel p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400',
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

        <div className="mt-5 border-t border-black/10 pt-4">
          {connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-text-500">
                Pour changer de numéro, déconnecte puis reconnecte via le QR.
              </p>
              <button
                type="button"
                onClick={onAskDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                <Unplug className="h-4 w-4" />
                {disconnecting ? 'Déconnexion…' : 'Déconnecter'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-text-500">
                Relie ton compte en quelques secondes via un QR code.
              </p>
              <button
                type="button"
                onClick={onConnect}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
              >
                <Smartphone className="h-4 w-4" />
                Connecter WhatsApp
              </button>
            </div>
          )}
          {disconnectError && <p className="mt-2 text-xs text-red-400">{disconnectError}</p>}
        </div>
      </div>

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
            onClick={onToggleAutoReply}
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
    </>
  );
}
