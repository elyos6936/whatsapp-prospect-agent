import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { GOOGLE_CLIENT_ID } from '@/lib/config';

type AuthPageProps = {
  onGoRegister: () => void;
  onGoBack?: () => void;
};

export function LoginPage({ onGoRegister, onGoBack }: AuthPageProps) {
  const { login, loginGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de connexion');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async (accessToken: string) => {
    setError('');
    setBusy(true);
    try {
      await loginGoogle(accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion Google échouée');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg-0 px-4 py-10">
      <div className="w-full max-w-sm animate-fade-in">
        {onGoBack && (
          <button
            type="button"
            onClick={onGoBack}
            className="mb-4 text-sm text-text-500 transition hover:text-text-200"
          >
            ← Retour
          </button>
        )}
        <div className="mb-8 flex justify-center">
          <KlanvioLogo variant="full" size="lg" />
        </div>
        <h1 className="text-center text-xl font-medium text-text-100">Connexion</h1>
        <p className="mt-2 text-center text-sm text-text-400">
          Automatisez votre prospection WhatsApp à 100&nbsp;%
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-xs text-text-500">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-bg-0 px-3 py-2.5 text-sm text-text-100 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-500">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-bg-0 px-3 py-2.5 pr-10 text-sm text-text-100 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                title={showPassword ? 'Masquer' : 'Afficher'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-text-500 transition hover:text-text-100"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        {GOOGLE_CLIENT_ID && (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/10" />
              <span className="text-xs text-text-500">ou</span>
              <span className="h-px flex-1 bg-black/10" />
            </div>
            <GoogleSignInButton
              label="Se connecter avec Google"
              onToken={(t) => void handleGoogle(t)}
              onError={setError}
              disabled={busy}
            />
          </>
        )}

        <p className="mt-6 text-center text-sm text-text-500">
          Pas encore de compte ?{' '}
          <button
            type="button"
            onClick={onGoRegister}
            className="text-brand hover:underline"
          >
            Créer un compte
          </button>
        </p>
      </div>
    </div>
  );
}
