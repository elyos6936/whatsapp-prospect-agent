import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, RefreshCw, Unplug } from 'lucide-react';
import {
  connectTally,
  disconnectTally,
  fetchIntegrations,
  fetchTallyForms,
  type IntegrationStatus,
  type TallyFormSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { TallyLogo } from '@/components/brand/IntegrationLogos';

type Cache = { items: TallyFormSummary[]; fetchedAt: number };
const cache = new Map<string, Cache>();
const CACHE_TTL_MS = 60_000;

export function TallyIntegrationCard() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [serverReady, setServerReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [forms, setForms] = useState<TallyFormSummary[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [fb, setFb] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const loadedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchIntegrations();
      setServerReady(Boolean(data.tallyConfigured ?? true));
      const row = data.integrations.find((i) => i.provider === 'tally') ?? null;
      setStatus(row);
      return row;
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

  const loadForms = useCallback(
    async (opts?: { force?: boolean }) => {
      const key = 'tally';
      const cached = cache.get(key);
      if (!opts?.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        setForms(cached.items);
        return;
      }
      setFormsLoading(true);
      setFb(null);
      try {
        const data = await fetchTallyForms();
        setForms(data.forms);
        cache.set(key, { items: data.forms, fetchedAt: Date.now() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur chargement Tally.';
        setForms([]);
        cache.delete(key);
        setFb({ type: 'err', text: msg });
        if (/Reconnecte Tally|révoqu|tally_reauth/i.test(msg)) {
          loadedRef.current = false;
          await loadStatus();
        }
      } finally {
        setFormsLoading(false);
      }
    },
    [loadStatus],
  );

  useEffect(() => {
    void (async () => {
      const row = await loadStatus();
      if (row?.connected && !loadedRef.current) {
        loadedRef.current = true;
        await loadForms();
      }
    })();
  }, [loadStatus, loadForms]);

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setConnecting(true);
    setFb(null);
    try {
      await connectTally(apiKey.trim());
      setApiKey('');
      loadedRef.current = true;
      await loadStatus();
      await loadForms({ force: true });
      setFb({ type: 'ok', text: 'Tally connecté.' });
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Clé API refusée.',
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Déconnecter Tally ? L’agent ne pourra plus lire vos formulaires.')) return;
    setDisconnecting(true);
    setFb(null);
    try {
      await disconnectTally();
      cache.delete('tally');
      setForms([]);
      loadedRef.current = false;
      setStatus({
        provider: 'tally',
        connected: false,
        email: null,
        accountId: null,
        connectedAt: null,
        scopes: null,
      });
      setFb({ type: 'ok', text: 'Tally déconnecté.' });
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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl">
            <TallyLogo className="h-11 w-11" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-100">Tally</p>
            {loading ? (
              <p className="text-xs text-text-400">Chargement…</p>
            ) : connected ? (
              <p className="truncate text-xs text-emerald-600">Connecté · clé API</p>
            ) : (
              <p className="text-xs text-text-400">Formulaires &amp; soumissions → leads WhatsApp</p>
            )}
          </div>
        </div>

        {connected && (
          <button
            type="button"
            disabled={disconnecting}
            onClick={() => void handleDisconnect()}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-500/20 disabled:opacity-50 sm:self-auto"
          >
            <Unplug className="h-4 w-4" />
            {disconnecting ? '…' : 'Déconnecter'}
          </button>
        )}
      </div>

      {!serverReady && !loading && (
        <p className="mt-3 text-xs text-amber-700">
          Chiffrement tokens manquant côté serveur (TOKENS_ENCRYPTION_KEY).
        </p>
      )}

      {!connected && (
        <div className="mt-4 space-y-2 border-t border-black/[0.06] pt-4">
          <label className="block text-xs font-medium text-text-300" htmlFor="tally-api-key">
            Clé API Tally
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="tally-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="tly-…"
              className="min-w-0 flex-1 rounded-xl border border-black/10 bg-bg-100 px-3 py-2 text-sm text-text-100 outline-none focus:border-brand/40"
            />
            <button
              type="button"
              disabled={connecting || loading || !serverReady || !apiKey.trim()}
              onClick={() => void handleConnect()}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2 text-sm font-medium text-text-200 transition hover:border-brand-border hover:bg-brand/10 hover:text-brand disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              {connecting ? '…' : 'Connecter'}
            </button>
          </div>
          <p className="text-[11px] text-text-500">
            Créez une clé sur tally.so → Settings → API keys, puis collez-la ici.
          </p>
        </div>
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
              Chargement…
            </div>
          ) : forms.length === 0 ? (
            <p className="text-xs text-text-500">Aucun formulaire trouvé.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto custom-scrollbar">
              {forms.map((f) => (
                <li
                  key={f.id}
                  className="truncate rounded-lg bg-bg-100 px-3 py-2 text-sm text-text-200"
                  title={f.name}
                >
                  {f.name}
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
