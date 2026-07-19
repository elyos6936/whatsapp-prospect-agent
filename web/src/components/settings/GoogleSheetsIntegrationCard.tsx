import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2, Plus, Trash2, Unplug } from 'lucide-react';
import {
  addGoogleSheets,
  disconnectGoogle,
  fetchGooglePickerToken,
  fetchGoogleSheets,
  fetchIntegrations,
  removeGoogleSheet,
  startGoogleConnect,
  type ConnectedSheetSummary,
  type IntegrationStatus,
} from '@/lib/api';
import {
  GOOGLE_CLOUD_PROJECT_NUMBER,
  GOOGLE_PICKER_API_KEY,
} from '@/lib/config';
import { openGoogleSheetsPicker } from '@/lib/google-picker';
import { cn } from '@/lib/utils';

type Props = {
  flash?: { type: 'ok' | 'err'; text: string } | null;
};

export function GoogleSheetsIntegrationCard({ flash }: Props) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [serverReady, setServerReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sheets, setSheets] = useState<ConnectedSheetSummary[]>([]);
  const [maxSheets, setMaxSheets] = useState(50);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [fb, setFb] = useState<{ type: 'ok' | 'err'; text: string } | null>(flash ?? null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchIntegrations();
      setServerReady(data.googleConfigured);
      const g = data.integrations.find((i) => i.provider === 'google') ?? null;
      setStatus(g);
      return g;
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

  const loadSheets = useCallback(async () => {
    setSheetsLoading(true);
    try {
      const data = await fetchGoogleSheets();
      setSheets(data.sheets);
      setMaxSheets(data.max);
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de charger les Sheets.',
      });
    } finally {
      setSheetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (flash) setFb(flash);
  }, [flash]);

  useEffect(() => {
    void (async () => {
      const g = await loadStatus();
      if (g?.connected) await loadSheets();
    })();
  }, [loadStatus, loadSheets]);

  const handleConnect = async () => {
    setConnecting(true);
    setFb(null);
    try {
      const { url } = await startGoogleConnect();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de démarrer OAuth Google.',
      });
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Déconnecter Google ? Les Sheets liés seront retirés de Klanvio (les fichiers restent dans ton Drive).',
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setFb(null);
    try {
      await disconnectGoogle();
      setSheets([]);
      setStatus({
        provider: 'google',
        connected: false,
        email: null,
        accountId: null,
        connectedAt: null,
        scopes: null,
      });
      setFb({ type: 'ok', text: 'Google déconnecté.' });
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Échec déconnexion.',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleAddSheets = async () => {
    setPickerBusy(true);
    setFb(null);
    try {
      if (!GOOGLE_PICKER_API_KEY || !GOOGLE_CLOUD_PROJECT_NUMBER) {
        throw new Error(
          'Picker non configuré (VITE_GOOGLE_PICKER_API_KEY / VITE_GOOGLE_CLOUD_PROJECT_NUMBER).',
        );
      }
      if (sheets.length >= maxSheets) {
        throw new Error(
          `Limite atteinte : maximum ${maxSheets} Google Sheets connectés par compte.`,
        );
      }
      const { accessToken } = await fetchGooglePickerToken();
      const selected = await openGoogleSheetsPicker({
        accessToken,
        developerKey: GOOGLE_PICKER_API_KEY,
        appId: GOOGLE_CLOUD_PROJECT_NUMBER,
      });
      if (selected.length === 0) return;

      const remaining = maxSheets - sheets.length;
      if (selected.length > remaining) {
        setFb({
          type: 'err',
          text: `Tu ne peux plus ajouter que ${remaining} Sheet(s) (limite ${maxSheets}).`,
        });
        return;
      }

      const result = await addGoogleSheets(selected);
      setSheets(result.sheets);
      setMaxSheets(result.max);
      setFb({
        type: 'ok',
        text:
          result.added > 0
            ? `${result.added} Sheet(s) ajouté(s).`
            : 'Ces Sheets étaient déjà connectés.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec ouverture Picker.';
      setFb({ type: 'err', text: msg });
      if (/Reconnecte Google|révoqu|expirée|google_reauth/i.test(msg)) {
        await loadStatus();
        setSheets([]);
      }
    } finally {
      setPickerBusy(false);
    }
  };

  const handleRemove = async (spreadsheetId: string) => {
    setRemovingId(spreadsheetId);
    setFb(null);
    try {
      const data = await removeGoogleSheet(spreadsheetId);
      setSheets(data.sheets);
      setMaxSheets(data.max);
    } catch (err) {
      setFb({
        type: 'err',
        text: err instanceof Error ? err.message : 'Impossible de retirer ce Sheet.',
      });
    } finally {
      setRemovingId(null);
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="rounded-xl border border-black/10 bg-bg-0 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: '#0F9D58' }}
            aria-hidden
          >
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-100">Google Sheets</p>
            {loading ? (
              <p className="text-xs text-text-400">Chargement…</p>
            ) : connected ? (
              <p className="truncate text-xs text-emerald-600">
                Connecté
                {status?.email ? ` · ${status.email}` : ''}
              </p>
            ) : (
              <p className="text-xs text-text-400">Sélectionne des feuilles via le Picker</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {connected && (
            <button
              type="button"
              disabled={pickerBusy || sheets.length >= maxSheets}
              onClick={() => void handleAddSheets()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2 text-sm font-medium text-text-200 transition hover:border-brand-border hover:bg-brand/10 hover:text-brand disabled:opacity-50"
            >
              {pickerBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Ajouter des feuilles
            </button>
          )}
          {connected ? (
            <button
              type="button"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              <Unplug className="h-4 w-4" />
              {disconnecting ? '…' : 'Déconnecter'}
            </button>
          ) : (
            <button
              type="button"
              disabled={connecting || loading || !serverReady}
              onClick={() => void handleConnect()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-black/10 bg-bg-100 px-3.5 py-2 text-sm font-medium text-text-200 transition hover:border-brand-border hover:bg-brand/10 hover:text-brand disabled:opacity-50"
            >
              {connecting ? 'Redirection…' : 'Connecter'}
            </button>
          )}
        </div>
      </div>

      {!serverReady && !loading && (
        <p className="mt-3 text-xs text-amber-700">
          Google n’est pas encore configuré côté serveur (GOOGLE_INTEGRATIONS_CLIENT_ID /
          SECRET / clé de chiffrement).
        </p>
      )}

      {connected && (
        <div className="mt-4 border-t border-black/[0.06] pt-4">
          <p className="mb-2 text-xs font-medium text-text-300">
            Sheets connectés
            {sheets.length ? ` (${sheets.length}/${maxSheets})` : ''}
          </p>

          {sheetsLoading && sheets.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Chargement…
            </div>
          ) : sheets.length === 0 ? (
            <p className="text-xs text-text-500">
              Aucun Sheet connecté. Clique sur « Ajouter des feuilles ».
            </p>
          ) : (
            <ul className="max-h-52 space-y-1.5 overflow-y-auto custom-scrollbar">
              {sheets.map((s) => (
                <li
                  key={s.spreadsheetId}
                  className="flex items-center gap-2 rounded-lg bg-bg-100 px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text-200" title={s.title}>
                    {s.title}
                  </span>
                  <button
                    type="button"
                    disabled={removingId === s.spreadsheetId}
                    onClick={() => void handleRemove(s.spreadsheetId)}
                    className="shrink-0 rounded-lg p-1.5 text-text-400 transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
                    title="Retirer"
                    aria-label={`Retirer ${s.title}`}
                  >
                    {removingId === s.spreadsheetId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
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
