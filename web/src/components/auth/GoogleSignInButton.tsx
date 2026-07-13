import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '@/lib/config';

type TokenResponse = { access_token?: string; error?: string };

type TokenClient = { requestAccessToken: () => void };

type GoogleOAuth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }) => TokenClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      // Le script est peut-être déjà chargé : on résout tout de suite si l'API
      // est prête, sinon on attend l'événement load (et l'erreur éventuelle).
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gsi_load_failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('gsi_load_failed'));
    document.head.appendChild(script);
  });
}

function GoogleGlyph() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.583 9 3.583Z"
      />
    </svg>
  );
}

type Props = {
  onToken: (accessToken: string) => void;
  onError?: (message: string) => void;
  label?: string;
  disabled?: boolean;
};

export function GoogleSignInButton({ onToken, onError, label = 'Continuer avec Google', disabled }: Props) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const tokenClientRef = useRef<TokenClient | null>(null);

  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled) return;
        const oauth2 = window.google?.accounts?.oauth2;
        if (!oauth2) throw new Error('gsi_unavailable');

        tokenClientRef.current = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile',
          callback: (response) => {
            if (response.access_token) {
              onTokenRef.current(response.access_token);
            } else if (response.error && response.error !== 'popup_closed') {
              onErrorRef.current?.('Connexion Google annulée ou refusée.');
            }
          },
          error_callback: (error) => {
            if (error?.type && error.type !== 'popup_closed') {
              onErrorRef.current?.('Connexion Google impossible. Réessayez.');
            }
          },
        });
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onErrorRef.current?.('Impossible de charger Google. Vérifiez votre connexion ou un bloqueur.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;

  const handleClick = () => {
    if (!ready || !tokenClientRef.current) return;
    tokenClientRef.current.requestAccessToken();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || !ready || failed}
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-black/15 bg-bg-0 px-4 py-2.5 text-sm font-medium text-text-100 shadow-sm transition hover:bg-bg-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleGlyph />
      <span>{failed ? 'Google indisponible' : label}</span>
    </button>
  );
}
