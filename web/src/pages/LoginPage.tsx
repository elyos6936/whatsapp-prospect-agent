import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthUI } from '@/components/ui/auth-fuse';
import { SeoHead } from '@/components/SeoHead';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loginGoogle } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          if (!isSignIn) navigate('/register');
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
            navigate('/register');
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
