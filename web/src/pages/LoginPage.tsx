import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthUI } from '@/components/ui/auth-fuse';
import { SeoHead } from '@/components/SeoHead';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

function redirectQuery(searchParams: URLSearchParams): string {
  const redirect = searchParams.get('redirect');
  if (!redirect) return '';
  return `?redirect=${encodeURIComponent(redirect)}`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, loginGoogle } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const qs = redirectQuery(searchParams);

  return (
    <>
      <SeoHead
        title="Connexion | Klanvio"
        description="Connectez-vous à Klanvio pour piloter votre agent WhatsApp IA : campagnes, relances et closing."
        path="/login"
        robots="noindex,follow"
      />
      <AuthUI
        initialSignIn
        onBack={() => navigate('/')}
        onModeChange={(isSignIn) => {
          if (!isSignIn) navigate(`/register${qs}`);
        }}
        handlers={{
          busy,
          error,
          onSignIn: async (email, password) => {
            setError('');
            setBusy(true);
            try {
              await login(email, password);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Erreur de connexion');
            } finally {
              setBusy(false);
            }
          },
          onSignUp: async () => {
            navigate(`/register${qs}`);
          },
          onGoogle: async (accessToken) => {
            setError('');
            setBusy(true);
            try {
              await loginGoogle(accessToken);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Connexion Google échouée');
            } finally {
              setBusy(false);
            }
          },
          onGoogleError: setError,
        }}
      />
    </>
  );
}
