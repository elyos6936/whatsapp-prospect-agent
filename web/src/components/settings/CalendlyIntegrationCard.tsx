import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, RefreshCw, Unplug } from 'lucide-react';
import {
  disconnectCalendly,
  fetchCalendlyContactsList,
  fetchCalendlyEventTypes,
  fetchIntegrations,
  startCalendlyConnect,
  type CalendlyContactSummary,
  type CalendlyEventTypeSummary,
  type IntegrationStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { CalendlyLogo } from '@/components/brand/IntegrationLogos';

type Props = {
  flash?: { type: 'ok' | 'err'; text: string } | null;
};

type BundleCache = {
  eventTypes: CalendlyEventTypeSummary[];
  contacts: CalendlyContactSummary[];
  contactsNote: string | null;
  fetchedAt: number;
};
const cache = new Map<string, BundleCache>();
const CACHE_TTL_MS = 60_000;

export function CalendlyIntegrationCard({ flash }: Props) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [serverReady, setServerReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [eventTypes, setEventTypes] = useState<CalendlyEventTypeSummary[]>([]);
  const [contacts, setContacts] = useState<CalendlyContactSummary[]>([]);
  const [contactsNote, setContactsNote] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [fb, setFb] = useState<{ type: 'ok' | 'err'; text: string } | null>(flash ?? null);
  const loadedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchIntegrations();
      setServerReady(Boolean(data.calendlyConfigured));
      const row = data.integrations.find((i) => i.provider === 'calendly') ?? null;
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

  const applyBundle = (bundle: BundleCache) => {
    setEventTypes(bundle.eventTypes);
    setContacts(bundle.contacts);
    setContactsNote(bundle.contactsNote);
  };

  const loadLists = useCallback(
    async (opts?: { force?: boolean }) => {
      const key = 'calendly';
      const cached = cache.get(key);
      if (!opts?.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        applyBundle(cached);
        return;
      }
      setListLoading(true);
      setFb(null);
      try {
        const [et, ctResult] = await Promise.all([
          fetchCalendlyEventTypes(),
          fetchCalendlyContactsList()
            .then((data) => ({ ok: true as const, data }))
            .catch((err: unknown) => {
              const msg =
                err instanceof Error ? err.message : 'Contacts Calendly indisponibles.';
              // Soft-fail : ne pas déconnecter pour un échec Contacts seul
              if (/contacts:read|Contacts indisponible|carnet Contacts/i.test(msg)) {
                return { ok: false as const, message: msg };
              }
              if (/Reconnecte Calendly|révoqu|expirée|calendly_reauth/i.test(msg)) {
                throw err;
              }
              return { ok: false as const, message: msg };
            }),
        ]);
        const bundle: BundleCache = {
          eventTypes: et.eventTypes,
          contacts: ctResult.ok ? ctResult.data.contacts : [],
          contactsNote: ctResult.ok ? null : ctResult.message,
          fetchedAt: Date.now(),
        };
        cache.set(key, bundle);
        applyBundle(bundle);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur chargement Calendly.';
        setEventTypes([]);
        setContacts([]);
        setContactsNote(null);
        cache.delete(key);
        setFb({ type: 'err', text: msg });
        if (/Reconnecte Calendly|révoqu|expirée|calendly_reauth/i.test(msg)) {
          loadedRef.current = false;
          await loadStatus();
        }
      } finally {
        setListLoading(false);
      }
    },
    [loadStatus],
  );

  useEffect(() => {
    if (flash) setFb(flash);
  }, [flash]);

  useEffect(() => {
    void (async () => {
      const row = await loadStatus();
      if (row?.connected && !loadedRef.current) {
        loadedRef.current = true;
        await loadLists();
      }
    })();
  }, [loadStatus, loadLists]);

  const handleConnect = async () => {
    setConnecting(true);
    setFb(null);
    try {
      const { url } = await startCalendlyConnect();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de démarrer OAuth Calendly.',
      });
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Déconnecter Calendly ? L’agent ne pourra plus lire vos types d’événements, RDV ni contacts.',
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setFb(null);
    try {
      await disconnectCalendly();
      cache.delete('calendly');
      setEventTypes([]);
      setContacts([]);
      setContactsNote(null);
      loadedRef.current = false;
      setStatus({
        provider: 'calendly',
        connected: false,
        email: null,
        accountId: null,
        connectedAt: null,
        scopes: null,
      });
      setFb({ type: 'ok', text: 'Calendly déconnecté.' });
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

  const renderList = (
    title: string,
    items: Array<{ key: string; label: string }>,
    empty: string,
  ) => (
    <div className="mt-4 border-t border-black/[0.06] pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-300">
          {title}
          {items.length ? ` (${items.length})` : ''}
        </p>
      </div>
      {listLoading && items.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-text-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Chargement…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-text-500">{empty}</p>
      ) : (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto custom-scrollbar">
          {items.map((item) => (
            <li
              key={item.key}
              className="truncate rounded-lg bg-bg-100 px-3 py-2 text-sm text-text-200"
              title={item.label}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-black/10 bg-bg-0 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl">
            <CalendlyLogo className="h-11 w-11" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-100">Calendly</p>
            {loading ? (
              <p className="text-xs text-text-400">Chargement…</p>
            ) : connected ? (
              <p className="truncate text-xs text-emerald-600">
                Connecté
                {status?.email ? ` · ${status.email}` : ''}
              </p>
            ) : (
              <p className="text-xs text-text-400">RDV &amp; Contacts → leads WhatsApp</p>
            )}
          </div>
        </div>

        {connected ? (
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              disabled={listLoading}
              onClick={() => void loadLists({ force: true })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3 py-2 text-sm font-medium text-text-300 transition hover:bg-bg-200 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
              Actualiser
            </button>
            <button
              type="button"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              <Unplug className="h-4 w-4" />
              {disconnecting ? '…' : 'Déconnecter'}
            </button>
          </div>
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
          Calendly n’est pas encore configuré côté serveur (CLIENT_ID / SECRET).
        </p>
      )}

      {connected && (
        <>
          {renderList(
            'Types d’événements',
            eventTypes.map((t) => ({ key: t.uri, label: t.name })),
            'Aucun type d’événement trouvé.',
          )}
          {renderList(
            'Contacts',
            contacts.map((c) => ({
              key: c.uri,
              label: [c.name || 'Sans nom', c.email, c.phone].filter(Boolean).join(' · '),
            })),
            contactsNote || 'Aucun contact (carnet vide ou scope contacts:read).',
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-text-500">
            L’agent lit les RDV / invitees (et Contacts si le scope est accordé). Un échec Contacts
            n’empêche pas d’utiliser les rendez-vous.
          </p>
        </>
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
