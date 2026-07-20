import { useCallback, useEffect, useState } from 'react';
import { Contact, Loader2 } from 'lucide-react';
import {
  disconnectGoogleContacts,
  fetchIntegrations,
  startGoogleContactsConnect,
  type IntegrationStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  flash?: { type: 'ok' | 'err'; text: string } | null;
};

export function GoogleContactsIntegrationCard({ flash }: Props) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [contactsGranted, setContactsGranted] = useState(false);
  const [serverReady, setServerReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fb, setFb] = useState<{ type: 'ok' | 'err'; text: string } | null>(flash ?? null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchIntegrations();
      setServerReady(data.googleConfigured);
      setContactsGranted(Boolean(data.googleContactsGranted));
      const g =
        data.integrations.find((i) => i.provider === 'google_contacts') ?? null;
      setStatus(g);
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de charger les intégrations.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (flash) setFb(flash);
  }, [flash]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setFb(null);
    try {
      const { url } = await startGoogleContactsConnect();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de démarrer OAuth Google Contacts.',
      });
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Déconnecter Google Contacts ? Les campagnes ne créeront plus de fiches Contacts automatiquement. Google Sheets n’est pas affecté.',
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setFb(null);
    try {
      await disconnectGoogleContacts();
      setContactsGranted(false);
      setStatus({
        provider: 'google_contacts',
        connected: false,
        email: null,
        accountId: null,
        connectedAt: null,
        scopes: null,
      });
      setFb({ type: 'ok', text: 'Google Contacts déconnecté.' });
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Échec déconnexion Contacts.',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const ready = contactsGranted;

  return (
    <div className="rounded-xl border border-black/10 bg-bg-0 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: '#4285F4' }}
            aria-hidden
          >
            <Contact className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-100">Google Contacts</p>
            {loading ? (
              <p className="text-xs text-text-400">Chargement…</p>
            ) : ready ? (
              <p className="truncate text-xs text-emerald-600">
                Connecté
                {status?.email ? ` · ${status.email}` : ''}
              </p>
            ) : (
              <p className="text-xs text-text-400">Non connecté</p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-text-500">
              Utilise le compte Google synchronisé avec le téléphone de ton WhatsApp. Sinon les
              contacts créés ne serviront pas contre le blocage.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {ready ? (
            <button
              type="button"
              disabled={disconnecting || loading}
              onClick={() => void handleDisconnect()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2 text-sm font-medium text-text-200 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  …
                </>
              ) : (
                'Déconnecter'
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={connecting || loading || !serverReady}
              onClick={() => void handleConnect()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2 text-sm font-medium text-text-200 transition hover:border-brand-border hover:bg-brand/10 hover:text-brand disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirection…
                </>
              ) : (
                'Connecter'
              )}
            </button>
          )}
        </div>
      </div>

      {!serverReady && !loading && (
        <p className="mt-3 text-xs text-amber-700">
          Google n’est pas encore configuré côté serveur (GOOGLE_INTEGRATIONS_CLIENT_ID / SECRET).
        </p>
      )}

      {fb && (
        <p
          className={cn(
            'mt-3 text-xs',
            fb.type === 'ok' ? 'text-emerald-600' : 'text-red-600',
          )}
        >
          {fb.text}
        </p>
      )}
    </div>
  );
}
