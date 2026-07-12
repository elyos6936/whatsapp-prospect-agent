import { useCallback, useEffect, useState } from 'react';
import {
  fetchEvolutionQr,
  fetchSettings,
  rebootEvolutionInstance,
  resetOutboundQuota,
  saveBusinessProfile,
  saveEvolutionSettings,
  saveOpenAiKey,
  setAutoReply,
  testEvolution,
  type AppSettings,
} from '@/lib/api';
import type { HealthStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

type SettingsTab = 'openai' | 'evolution' | 'business' | 'connection';

type SettingsPageProps = {
  health: HealthStatus | null;
  onRefreshHealth: () => void;
};

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

export function SettingsPage({ health, onRefreshHealth }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>('openai');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiFb, setOpenaiFb] = useState('');

  const [evoBaseUrl, setEvoBaseUrl] = useState('');
  const [evoApiKey, setEvoApiKey] = useState('');
  const [evoInstance, setEvoInstance] = useState('');
  const [evoWebhook, setEvoWebhook] = useState('');
  const [evoFb, setEvoFb] = useState('');

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
      setSettings(s);
      setEvoBaseUrl(s.evolution.baseUrl || '');
      setEvoInstance(s.evolution.instanceName || '');
      setOwnerName(s.business.ownerName || '');
      setOffer(s.business.offer || '');
      setPrice(s.business.price || '');
      setAutoReplyLocal(s.autoReply);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadQr = useCallback(async () => {
    setQrLoading(true);
    try {
      const data = await fetchEvolutionQr();
      setQrData(data);
    } catch (err) {
      setQrData({
        connected: false,
        message: err instanceof Error ? err.message : 'Erreur QR',
      });
    } finally {
      setQrLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'connection') void loadQr();
  }, [tab, loadQr]);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'evolution', label: 'Evolution API' },
    { id: 'business', label: 'Profil' },
    { id: 'connection', label: 'Connexion WA' },
  ];

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-serif text-2xl font-light text-text-100">Réglages</h1>
        <p className="mt-2 text-sm text-text-400">
          Configurez OpenAI, Evolution API et le profil business de l&apos;agent.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm transition',
                tab === t.id
                  ? 'border border-brand-border bg-brand-muted text-brand'
                  : 'border border-white/10 text-text-400 hover:bg-bg-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="mt-6 text-sm text-text-500">Chargement…</p>}

        {tab === 'openai' && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <h2 className="text-sm font-medium text-text-200">Clé API OpenAI</h2>
            <p className="mt-1 text-xs text-text-500">
              Actuel : {settings?.openai.configured ? settings.openai.maskedKey : 'Non configuré'}
            </p>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              className="mt-4 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
            />
            <button
              type="button"
              className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              onClick={async () => {
                try {
                  const r = await saveOpenAiKey(openaiKey);
                  setOpenaiFb(r.message);
                  setOpenaiKey('');
                  void loadSettings();
                  onRefreshHealth();
                } catch (err) {
                  setOpenaiFb(err instanceof Error ? err.message : 'Erreur');
                }
              }}
            >
              Enregistrer OpenAI
            </button>
            <Feedback text={openaiFb} type={openaiFb.includes('Erreur') ? 'err' : 'ok'} />
          </section>
        )}

        {tab === 'evolution' && (
          <section className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <h2 className="text-sm font-medium text-text-200">Evolution API</h2>
            <p className="text-xs text-text-500">
              <a
                href="https://docs.evolutionfoundation.com.br/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Documentation Evolution
              </a>
            </p>
            <label className="block text-xs text-text-400">
              URL de base
              <input
                type="url"
                value={evoBaseUrl}
                onChange={(e) => setEvoBaseUrl(e.target.value)}
                placeholder="https://evolution.example.com"
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Clé API
              <input
                type="password"
                value={evoApiKey}
                onChange={(e) => setEvoApiKey(e.target.value)}
                placeholder={settings?.evolution.maskedKey || 'apikey_…'}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Nom d&apos;instance
              <input
                type="text"
                value={evoInstance}
                onChange={(e) => setEvoInstance(e.target.value)}
                placeholder="klanvio"
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Webhook URL
              <input
                type="url"
                value={evoWebhook}
                onChange={(e) => setEvoWebhook(e.target.value)}
                placeholder="https://…/api/evolution/webhook"
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <p className="text-[11px] text-text-500">
              En local : <code className="rounded bg-bg-200 px-1">npm run tunnel</code> puis collez
              l&apos;URL + <strong>/api/evolution/webhook</strong>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
                onClick={async () => {
                  try {
                    const r = await testEvolution();
                    setEvoFb(r.message);
                    onRefreshHealth();
                  } catch (err) {
                    setEvoFb(err instanceof Error ? err.message : 'Erreur');
                  }
                }}
              >
                Tester
              </button>
              <button
                type="button"
                className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
                onClick={async () => {
                  try {
                    const r = await saveEvolutionSettings({
                      baseUrl: evoBaseUrl,
                      apiKey: evoApiKey,
                      instanceName: evoInstance,
                      webhookUrl: evoWebhook || undefined,
                    });
                    setEvoFb(r.message);
                    setEvoApiKey('');
                    void loadSettings();
                    onRefreshHealth();
                  } catch (err) {
                    setEvoFb(err instanceof Error ? err.message : 'Erreur');
                  }
                }}
              >
                Enregistrer
              </button>
            </div>
            <Feedback text={evoFb} />
          </section>
        )}

        {tab === 'business' && (
          <section className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <h2 className="text-sm font-medium text-text-200">Profil business</h2>
            <label className="block text-xs text-text-400">
              Votre prénom
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Offre
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs text-text-400">
              Prix
              <input
                type="text"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/10 bg-bg-0 px-4 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
              />
            </label>
            <button
              type="button"
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              onClick={async () => {
                try {
                  const r = await saveBusinessProfile({ ownerName, offer, price });
                  setBusinessFb(r.message);
                } catch (err) {
                  setBusinessFb(err instanceof Error ? err.message : 'Erreur');
                }
              }}
            >
              Enregistrer le profil
            </button>
            <Feedback text={businessFb} type="ok" />
          </section>
        )}

        {tab === 'connection' && (
          <section className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-bg-100 p-5">
            <h2 className="text-sm font-medium text-text-200">Connexion WhatsApp</h2>
            <p className="text-xs text-text-500">
              Scannez le QR avec WhatsApp → Appareils connectés.
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
                    className="mx-auto max-w-[240px] rounded-xl border border-white/10"
                  />
                )}
                {qrData?.pairingCode && (
                  <p className="text-center text-sm text-text-300">
                    Code d&apos;appairage : <strong>{qrData.pairingCode}</strong>
                  </p>
                )}
                {qrData?.message && (
                  <p className="text-center text-xs text-text-500">{qrData.message}</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
                onClick={() => void loadQr()}
              >
                Actualiser QR
              </button>
              <button
                type="button"
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
                onClick={async () => {
                  if (!confirm("Redémarrer l'instance Evolution API ?")) return;
                  try {
                    await rebootEvolutionInstance();
                    void loadQr();
                    onRefreshHealth();
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Erreur');
                  }
                }}
              >
                Redémarrer instance
              </button>
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-white/10 bg-bg-100 p-5">
          <h2 className="text-sm font-medium text-text-200">Réponses automatiques</h2>
          <label className="mt-4 flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={autoReply}
              onChange={async (e) => {
                const v = e.target.checked;
                setAutoReplyLocal(v);
                try {
                  await setAutoReply(v);
                  onRefreshHealth();
                } catch {
                  setAutoReplyLocal(!v);
                }
              }}
              className="h-4 w-4 rounded border-white/20 accent-brand"
            />
            <span className="text-sm text-text-300">Activer les réponses automatiques</span>
          </label>
          {!autoReply && (
            <p className="mt-2 text-xs text-amber-400">
              Les messages entrants s&apos;affichent mais l&apos;agent ne répond pas.
            </p>
          )}
          <p className="mt-3 text-xs text-text-500">
            Quota sortant : {health?.outbound?.today ?? 0}/{health?.outbound?.limit ?? 30}{' '}
            aujourd&apos;hui
            {health?.outbound?.bonus ? ` (+${health.outbound.bonus} bonus)` : ''}
          </p>
          <button
            type="button"
            className="mt-3 rounded-xl border border-white/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-200"
            onClick={async () => {
              try {
                const r = await resetOutboundQuota();
                setQuotaFb(r.message);
                onRefreshHealth();
              } catch (err) {
                setQuotaFb(err instanceof Error ? err.message : 'Erreur');
              }
            }}
          >
            Débloquer le quota du jour
          </button>
          <Feedback text={quotaFb} type="ok" />
        </section>
      </div>
    </div>
  );
}
