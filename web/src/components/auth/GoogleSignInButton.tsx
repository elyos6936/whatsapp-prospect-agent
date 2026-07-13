import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '@/lib/config';

type GoogleCredentialResponse = { credential?: string };

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: Record<string, string | number>,
  ) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
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

type Props = {
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with';
};

export function GoogleSignInButton({ onCredential, onError, text = 'continue_with' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Garde une réf stable vers le callback pour éviter de réinitialiser GIS.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled) return;
        const id = window.google?.accounts?.id;
        const parent = containerRef.current;
        if (!id || !parent) return;

        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response.credential) onCredentialRef.current(response.credential);
          },
        });
        parent.innerHTML = '';
        id.renderButton(parent, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text,
          shape: 'pill',
          logo_alignment: 'center',
          width: 320,
        });
        setReady(true);
      })
      .catch(() => onError?.('Impossible de charger la connexion Google.'));

    return () => {
      cancelled = true;
    };
  }, [text, onError]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="flex flex-col items-center">
      <div ref={containerRef} className="flex min-h-[44px] justify-center" />
      {!ready && <p className="text-xs text-text-500">Chargement de Google…</p>}
    </div>
  );
}
