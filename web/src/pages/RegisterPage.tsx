import { useState } from 'react';
import { AuthUI } from '@/components/ui/auth-fuse';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

type AuthPageProps = {
  onGoLogin: () => void;
  onGoBack?: () => void;
};

export function RegisterPage({ onGoLogin, onGoBack }: AuthPageProps) {
  const { register, loginGoogle } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthUI
      initialSignIn={false}
      onBack={onGoBack}
      onModeChange={(isSignIn) => {
        if (isSignIn) onGoLogin();
      }}
      handlers={{
        busy,
        error,
        onSignIn: async () => {
          onGoLogin();
        },
        onSignUp: async (name, email, password) => {
          setError('');
          if (password.length < 6) {
            setError('Le mot de passe doit faire au moins 6 caractères.');
            return;
          }
          setBusy(true);
          try {
            await register(email, password, name);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Erreur inscription');
          } finally {
            setBusy(false);
          }
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
