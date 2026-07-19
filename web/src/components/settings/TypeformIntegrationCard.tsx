import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, RefreshCw, Unplug } from 'lucide-react';
import {
  disconnectTypeform,
  fetchIntegrations,
  fetchTypeformForms,
  startTypeformConnect,
  type IntegrationStatus,
  type TypeformFormSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  /** Message flash après retour OAuth (connected / error). */
  flash?: { type: 'ok' | 'err'; text: string } | null;
};

type FormsCache = {
  forms: TypeformFormSummary[];
  fetchedAt: number;
};

const formsCacheByUser = new Map<string, FormsCache>();
const CACHE_TTL_MS = 60_000;

export function TypeformIntegrationCard({ flash }: Props) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [serverReady, setServerReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [forms, setForms] = useState<TypeformFormSummary[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [fb, setFb] = useState<{ type: 'ok' | 'err'; text: string } | null>(flash ?? null);
  const loadedFormsRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchIntegrations();
      setServerReady(data.typeformConfigured);
      const tf = data.integrations.find((i) => i.provider === 'typeform') ?? null;
      setStatus(tf);
      return tf;
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de charger les intégrations.',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadForms = useCallback(async (opts?: { force?: boolean }) => {
    const cacheKey = 'typeform';
    const cached = formsCacheByUser.get(cacheKey);
    if (!opts?.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setForms(cached.forms);
      return;
    }
    setFormsLoading(true);
    setFb(null);
    try {
      const data = await fetchTypeformForms();
      setForms(data.forms);
      formsCacheByUser.set(cacheKey, { forms: data.forms, fetchedAt: Date.now() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur chargement formulaires.';
      setForms([]);
      formsCacheByUser.delete(cacheKey);
      setFb({ type: 'err', text: msg });
      if (/Reconnecte Typeform|révoqu|expirée|typeform_reauth/i.test(msg)) {
        loadedFormsRef.current = false;
        await loadStatus();
      }
    } finally {
      setFormsLoading(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    if (flash) setFb(flash);
  }, [flash]);

  useEffect(() => {
    void (async () => {
      const tf = await loadStatus();
      if (tf?.connected && !loadedFormsRef.current) {
        loadedFormsRef.current = true;
        await loadForms();
      }
    })();
  }, [loadStatus, loadForms]);

  const handleConnect = async () => {
    setConnecting(true);
    setFb(null);
    try {
      const { url } = await startTypeformConnect();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de démarrer OAuth Typeform.',
      });
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Déconnecter Typeform ? L’agent ne pourra plus accéder à tes formulaires.')) {
      return;
    }
    setDisconnecting(true);
    setFb(null);
    try {
      await disconnectTypeform();
      formsCacheByUser.delete('typeform');
      setForms([]);
      loadedFormsRef.current = false;
      setStatus({
        provider: 'typeform',
        connected: false,
        email: null,
        accountId: null,
        connectedAt: null,
        scopes: null,
      });
      setFb({ type: 'ok', text: 'Typeform déconnecté.' });
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Échec déconnexion.',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="rounded-xl border border-black/10 bg-bg-0 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ background: '#262627' }}
            aria-hidden
          >
            Tf
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-100">Typeform</p>
            {loading ? (
              <p className="text-xs text-text-400">Chargement…</p>
            ) : connected ? (
              <p className="truncate text-xs text-emerald-600">
                Connecté
                {status?.email ? ` · ${status.email}` : ''}
              </p>
            ) : (
              <p className="text-xs text-text-400">
                Formulaires → leads WhatsApp &amp; campagnes
              </p>
            )}
          </div>
        </div>

        {connected ? (
          <button
            type="button"
            disabled={disconnecting}
            onClick={() => void handleDisconnect()}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-500/20 disabled:opacity-50 sm:self-auto"
          >
            <Unplug className="h-4 w-4" />
            {disconnecting ? '…' : 'Déconnecter'}
          </button>
        ) : (
          <button
            type="button"
            disabled={connecting || loading || !serverReady}
            onClick={() => void handleConnect()}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2 text-sm font-medium text-text-200 transition hover:border-brand-border hover:bg-brand/10 hover:text-brand disabled:opacity-50 sm:self-auto"
          >
            <Link2 className="h-4 w-4" />
            {connecting ? 'Redirection…' : 'Connecter'}
          </button>
        )}
      </div>

      {!serverReady && !loading && (
        <p className="mt-3 text-xs text-amber-700">
          Typeform n’est pas encore configuré côté serveur (CLIENT_ID / SECRET / clé de
          chiffrement).
        </p>
      )}

      {connected && (
        <div className="mt-4 border-t border-black/[0.06] pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-text-300">
              Formulaires{forms.length ? ` (${forms.length})` : ''}
            </p>
            <button
              type="button"
              disabled={formsLoading}
              onClick={() => void loadForms({ force: true })}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-text-400 transition hover:bg-bg-200 hover:text-text-100 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', formsLoading && 'animate-spin')} />
              Actualiser
            </button>
          </div>
          {formsLoading && forms.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Chargement des formulaires…
            </div>
          ) : forms.length === 0 ? (
            <p className="text-xs text-text-500">Aucun formulaire trouvé sur ce compte.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto custom-scrollbar">
              {forms.map((f) => (
                <li
                  key={f.id}
                  className="truncate rounded-lg bg-bg-100 px-3 py-2 text-sm text-text-200"
                  title={f.title}
                >
                  {f.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {fb && (
        <p
          className={cn(
            'mt-3 text-sm',
            fb.type === 'ok' && 'text-emerald-600',
            fb.type === 'err' && 'text-red-500',
          )}
        >
          {fb.text}
        </p>
      )}
    </div>
  );
}
