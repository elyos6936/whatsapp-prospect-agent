import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Link2,
  LogOut,
  Smartphone,
  Unplug,
} from 'lucide-react';
import {
  createMoneyFusionCheckout,
  disconnectWhatsApp,
  fetchSettings,
  setAutoReply,
  verifyMoneyFusionPayment,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { WhatsAppConnectModal } from '@/components/whatsapp/WhatsAppConnectModal';
import { TypeformIntegrationCard } from '@/components/settings/TypeformIntegrationCard';
import { GoogleSheetsIntegrationCard } from '@/components/settings/GoogleSheetsIntegrationCard';
import { GoogleContactsIntegrationCard } from '@/components/settings/GoogleContactsIntegrationCard';
import {
  PLANS,
  TRIAL_DAYS,
  accountsLabel,
  formatEuro,
  getPlan,
  periodSuffix,
  planPrice,
  type BillingPeriod,
  type PlanId,
} from '@/lib/pricing';

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
  return 'billing';
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
      return { type: 'ok', text: 'Google Sheets connecté avec succès.' };
    }
    if (g === 'contacts_connected') {
      return { type: 'ok', text: 'Google Contacts connecté avec succès.' };
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
      !url.searchParams.has('google') &&
      !url.searchParams.has('provider') &&
      !url.searchParams.has('token') &&
      !url.searchParams.has('tokenPay')
    ) {
      return;
    }
    url.searchParams.delete('settings');
    url.searchParams.delete('typeform');
    url.searchParams.delete('google');
    url.searchParams.delete('message');
    url.searchParams.delete('provider');
    url.searchParams.delete('token');
    url.searchParams.delete('tokenPay');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

function readMoneyFusionReturnToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') !== 'moneyfusion') return null;
    return params.get('token') || params.get('tokenPay');
  } catch {
    return null;
  }
}

export function SettingsPage() {
  const { user, logout, refreshUser, patchWhatsApp } = useAuth();
  const [tab, setTab] = useState<SettingsTab>(() => readInitialTab());
  const [loading, setLoading] = useState(true);
  const typeformFlash = useMemo(() => readTypeformFlash(), []);
  const googleFlash = useMemo(() => readGoogleFlash(), []);

  const [autoReplyOn, setAutoReplyOn] = useState(true);
  const [autoReplyBusy, setAutoReplyBusy] = useState(false);
  const [autoReplyFb, setAutoReplyFb] = useState('');
  const [billingNote, setBillingNote] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingPlan, setBillingPlan] = useState<PlanId>('pro');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [billingPhone, setBillingPhone] = useState('');

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
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') === 'moneyfusion') return;
    if (
      typeformFlash ||
      googleFlash ||
      params.get('settings')
    ) {
      clearIntegrationQueryParams();
    }
  }, [typeformFlash, googleFlash]);

  useEffect(() => {
    const token = readMoneyFusionReturnToken();
    if (!token) return;
    setTab('billing');
    setBillingBusy(true);
    setBillingNote('Verification du paiement MoneyFusion en cours...');
    void verifyMoneyFusionPayment(token)
      .then((res) => {
        if (res.payment.status === 'paid') {
          setBillingNote('Paiement confirme. Ton abonnement est maintenant actif.');
          void refreshUser();
          return;
        }
        if (res.payment.status === 'pending') {
          setBillingNote('Paiement en attente de confirmation. Reessaye dans quelques secondes.');
          return;
        }
        if (res.payment.status === 'cancelled') {
          setBillingNote('Paiement annule. Tu peux relancer le paiement.');
          return;
        }
        setBillingNote('Paiement non valide. Verifie puis relance.');
      })
      .catch((err) => {
        setBillingNote(err instanceof Error ? err.message : 'Impossible de verifier le paiement.');
      })
      .finally(() => {
        setBillingBusy(false);
        clearIntegrationQueryParams();
      });
  }, [refreshUser]);

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
      const res = await disconnectWhatsApp();
      // Optimistic + réponse API : l’UI passe « déconnecté » sans attendre sticky/poll.
      patchWhatsApp(
        res.whatsapp ?? {
          connected: false,
          state: 'close',
          message: 'WhatsApp déconnecté.',
        },
      );
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
    { id: 'billing', label: 'Facturation', icon: CreditCard },
    { id: 'integrations', label: 'Intégrations', icon: Link2 },
    { id: 'connection', label: 'WhatsApp', icon: Smartphone },
  ];

  const tabLabels: Record<SettingsTab, { short: string; full: string }> = {
    billing: { short: 'Facturation', full: 'Facturation' },
    integrations: { short: 'Intégrations', full: 'Intégrations' },
    connection: { short: 'WhatsApp', full: 'WhatsApp' },
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
                <GoogleContactsIntegrationCard
                  flash={
                    googleFlash && /contacts/i.test(googleFlash.text) ? googleFlash : null
                  }
                />
                <TypeformIntegrationCard flash={typeformFlash} />
                <GoogleSheetsIntegrationCard
                  flash={
                    googleFlash && !/contacts/i.test(googleFlash.text) ? googleFlash : null
                  }
                />
              </div>
            </div>
          ) : (
            <div className="panel min-w-0 space-y-5 overflow-hidden p-4 sm:p-5">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text-100">Abonnement Klanvio</h2>
                <p className="mt-1 text-xs leading-relaxed text-text-400">
                  Choisissez votre palier · essai {TRIAL_DAYS} jours inclus · résiliable à tout
                  moment
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={billingPeriod === 'annual'}
                  onClick={() =>
                    setBillingPeriod((p) => (p === 'annual' ? 'monthly' : 'annual'))
                  }
                  className={cn(
                    'relative h-7 w-[46px] shrink-0 rounded-full border transition-colors',
                    billingPeriod === 'annual'
                      ? 'border-brand bg-brand'
                      : 'border-black/10 bg-bg-0',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform',
                      billingPeriod === 'annual' && 'translate-x-[18px]',
                    )}
                  />
                </button>
                <span className="text-xs text-text-400">
                  Facturation{' '}
                  <strong className="font-semibold text-text-200">
                    {billingPeriod === 'annual' ? 'annuelle' : 'mensuelle'}
                  </strong>
                </span>
                <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">
                  Annuel = 2 mois offerts
                </span>
              </div>

              <div className="grid gap-2">
                {PLANS.map((plan) => {
                  const selected = billingPlan === plan.id;
                  const price = planPrice(plan, billingPeriod);
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setBillingPlan(plan.id)}
                      className={cn(
                        'flex min-w-0 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition',
                        selected
                          ? 'border-brand bg-brand/[0.06] ring-1 ring-brand/20'
                          : 'border-black/10 bg-bg-0 hover:border-black/15',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-100">
                          {plan.name}
                          {plan.featured ? (
                            <span className="ml-2 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                              Populaire
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-500">
                          {accountsLabel(plan.accounts)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-base font-semibold text-text-100">
                          {formatEuro(price)}
                          <span className="text-xs font-normal text-text-500">
                            {periodSuffix(billingPeriod)}
                          </span>
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={billingBusy}
                onClick={() => {
                  const cleanPhone = billingPhone.trim();
                  if (cleanPhone.replace(/\D/g, '').length < 8) {
                    setBillingNote('Entre un numero valide (minimum 8 chiffres) pour payer.');
                    return;
                  }
                  setBillingBusy(true);
                  setBillingNote(null);
                  void createMoneyFusionCheckout({
                    planId: billingPlan,
                    billingPeriod,
                    customerPhone: cleanPhone,
                  })
                    .then((res) => {
                      window.location.href = res.checkoutUrl;
                    })
                    .catch((err) => {
                      setBillingNote(
                        err instanceof Error ? err.message : 'Impossible de demarrer le paiement.',
                      );
                    })
                    .finally(() => {
                      setBillingBusy(false);
                    });
                }}
                className="inline-flex w-full max-w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {billingBusy
                    ? 'Redirection…'
                    : `Continuer — ${formatEuro(planPrice(getPlan(billingPlan), billingPeriod))}${periodSuffix(billingPeriod)}`}
                </span>
              </button>

              <label className="block">
                <span className="mb-1 block text-xs text-text-400">
                  Numero Mobile Money (MoneyFusion)
                </span>
                <input
                  type="tel"
                  value={billingPhone}
                  onChange={(e) => setBillingPhone(e.target.value)}
                  placeholder="Ex: 0700000000"
                  className="w-full rounded-xl border border-black/10 bg-bg-0 px-3 py-2 text-sm text-text-100 outline-none transition focus:border-brand"
                />
              </label>

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
