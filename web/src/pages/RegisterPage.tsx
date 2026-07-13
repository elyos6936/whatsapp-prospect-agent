import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { KlanvioLogo } from '@/components/brand/KlanvioLogo';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

type AuthPageProps = {
  onGoLogin: () => void;
  onGoBack?: () => void;
};

export function RegisterPage({ onGoLogin, onGoBack }: AuthPageProps) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        <h1 className="text-center text-xl font-medium text-text-100">Créer un compte</h1>
        <p className="mt-2 text-center text-sm text-text-400">
          Rejoignez Klanvio en quelques secondes
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
          <div>
            <label className="mb-1 block text-xs text-text-500">Prénom ou nom</label>
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-bg-100 px-3 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-500">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-bg-100 px-3 py-2.5 text-sm text-text-100 outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-500">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bg-100 px-3 py-2.5 pr-10 text-sm text-text-100 outline-none focus:border-brand"
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
            {busy ? 'Création…' : "S'inscrire"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-text-500">
          Déjà un compte ?{' '}
          <button type="button" onClick={onGoLogin} className="text-brand hover:underline">
            Se connecter
          </button>
        </p>
      </div>
    </div>
  );
}
