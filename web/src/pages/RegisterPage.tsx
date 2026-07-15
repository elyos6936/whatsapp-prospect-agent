import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthUI } from '@/components/ui/auth-fuse';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export function RegisterPage() {
  const navigate = useNavigate();
  const { register, loginGoogle } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <AuthUI
      initialSignIn={false}
      onBack={() => navigate('/')}
      onModeChange={(isSignIn) => {
        if (isSignIn) navigate('/login');
      }}
      handlers={{
        busy,
        error,
        onSignIn: async () => {
          navigate('/login');
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
