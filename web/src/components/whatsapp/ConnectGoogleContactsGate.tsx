import { useEffect, useState } from 'react';
import { Contact, Loader2 } from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import {
  dismissGoogleContactsPrompt,
  fetchIntegrations,
  startGoogleContactsConnect,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * Gate optionnelle après WhatsApp : connecter Google Contacts ou passer.
 * Même pattern early-return que ConnectWhatsAppGate.
 */
export function ConnectGoogleContactsGate() {
  const { refreshUser } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchIntegrations();
        if (cancelled) return;
        if (data.googleContactsGranted) {
          await dismissGoogleContactsPrompt();
          await refreshUser();
          return;
        }
      } catch {
        /* ignore — afficher la gate */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const { url } = await startGoogleContactsConnect();
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Impossible de démarrer OAuth Google Contacts.');
    }
  };

  const handleSkipConfirm = async () => {
    setSkipping(true);
    setError('');
    try {
      await dismissGoogleContactsPrompt();
      await refreshUser();
    } catch (err) {
      setSkipping(false);
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer le choix.');
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg-0 text-sm text-text-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-bg-0 px-4 py-10">
      <div className="pointer-events-none select-none text-center opacity-40">
        <div className="mb-4 flex justify-center">
          <KlanvioLogo variant="full" size="lg" />
        </div>
        <p className="text-sm text-text-400">Google Contacts — protection anti-blocage</p>
      </div>

      <div
        className={cn(
          'relative z-10 w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-lg',
        )}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#4285F4]/10 text-[#4285F4]">
          <Contact className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-text-100">Connecter Google Contacts</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-400">
          Avant chaque campagne, Klanvio peut enregistrer automatiquement les numéros prospectés
          dans Google Contacts. WhatsApp traite mieux les messages vers des contacts enregistrés —
          cela réduit le risque de blocage.
        </p>
        <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
          Important : connecte le <strong>même compte Google</strong> que celui synchronisé avec le
          téléphone où tourne WhatsApp. Un autre compte Google ne protégera pas ton numéro WhatsApp.
        </p>

        {!skipConfirm ? (
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              disabled={connecting}
              onClick={() => void handleConnect()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {connecting ? 'Redirection…' : 'Connecter Google Contacts'}
            </button>
            <button
              type="button"
              disabled={connecting}
              onClick={() => setSkipConfirm(true)}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-black/10 bg-bg-100 px-4 text-sm font-medium text-text-300 transition hover:bg-bg-200 disabled:opacity-50"
            >
              Passer
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-sm leading-relaxed text-text-300">
              Tu pourras connecter Google Contacts à tout moment dans{' '}
              <strong className="font-semibold text-text-100">Réglages → Intégrations</strong>.
            </p>
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-800">
              Sans contacts enregistrés, WhatsApp peut bloquer plus facilement un compte qui
              écrit à beaucoup de numéros inconnus. Si ton WhatsApp est bloqué dans ce cas,{' '}
              <strong>c’est à toi de l’assumer</strong> — Klanvio ne pourra pas compenser.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={skipping}
                onClick={() => setSkipConfirm(false)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-black/10 px-3 text-sm font-medium text-text-300"
              >
                Retour
              </button>
              <button
                type="button"
                disabled={skipping}
                onClick={() => void handleSkipConfirm()}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-text-100 px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {skipping ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                J’ai compris, continuer
              </button>
            </div>
          </div>
        )}

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
