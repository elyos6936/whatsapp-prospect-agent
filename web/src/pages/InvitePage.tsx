import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users } from 'lucide-react';
import { acceptTeamInvite, fetchTeamInvitePreview } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<{
    workspaceName: string;
    email: string;
    role: string;
    expired: boolean;
    accepted: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    void fetchTeamInvitePreview(token)
      .then(setPreview)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Invitation introuvable.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await acceptTeamInvite(token);
      navigate('/app?settings=team', { replace: true });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’accepter l’invitation.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-0 text-text-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-0 px-6 text-center">
        <p className="text-sm text-red-400">{error || 'Invitation introuvable.'}</p>
        <Link to="/" className="text-sm text-brand hover:underline">
          Retour à l’accueil
        </Link>
      </div>
    );
  }

  const roleLabel = preview.role === 'admin' ? 'administrateur' : 'membre';
  const emailMismatch =
    user && user.email.toLowerCase() !== preview.email.toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-0 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-bg-100 p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-brand" />
          <h1 className="font-serif text-xl font-light text-text-100">Invitation équipe</h1>
        </div>

        {preview.accepted ? (
          <p className="text-sm text-text-300">Cette invitation a déjà été acceptée.</p>
        ) : preview.expired ? (
          <p className="text-sm text-red-400">Cette invitation a expiré.</p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-text-300">
              Vous êtes invité à rejoindre{' '}
              <strong className="font-medium text-text-100">{preview.workspaceName}</strong> en
              tant que <strong className="font-medium text-text-100">{roleLabel}</strong>.
            </p>
            <p className="mt-2 text-xs text-text-500">
              Adresse attendue : <span className="text-text-300">{preview.email}</span>
            </p>
          </>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {!preview.accepted && !preview.expired && (
          <div className="mt-6 flex flex-col gap-2">
            {!user ? (
              <>
                <Link
                  to={`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`}
                  className="rounded-xl bg-brand px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-dark"
                >
                  Se connecter pour accepter
                </Link>
                <Link
                  to={`/register?redirect=${encodeURIComponent(`/invite/${token}`)}`}
                  className="rounded-xl border border-black/10 px-4 py-2.5 text-center text-sm text-text-300 hover:bg-bg-200"
                >
                  Créer un compte
                </Link>
              </>
            ) : emailMismatch ? (
              <p className="text-sm text-amber-500">
                Connectez-vous avec <strong>{preview.email}</strong> pour accepter cette invitation.
              </p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAccept()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Rejoindre l’équipe
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
