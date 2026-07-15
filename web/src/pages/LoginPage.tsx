import { useState } from 'react';
import { AuthUI } from '@/components/ui/auth-fuse';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

type AuthPageProps = {
  onGoRegister: () => void;
  onGoBack?: () => void;
};

export function LoginPage({ onGoRegister, onGoBack }: AuthPageProps) {
  const { login, loginGoogle } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthUI
      initialSignIn
      onBack={onGoBack}
      onModeChange={(isSignIn) => {
        if (!isSignIn) onGoRegister();
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
          onGoRegister();
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
  );
}
