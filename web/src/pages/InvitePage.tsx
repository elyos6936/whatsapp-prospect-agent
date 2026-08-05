import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Users } from 'lucide-react';
import { acceptTeamInvite, fetchTeamInvitePreview } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshUser } = useAuth();
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
  const autoAcceptStarted = useRef(false);

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
      await refreshUser();
      navigate('/app?settings=team', { replace: true });
      window.location.assign('/app?settings=team');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’accepter l’invitation.');
      setBusy(false);
    }
  };

  // Invitation déjà acceptée (ex. auto à l'inscription) → entrer dans l'app
  useEffect(() => {
    if (authLoading || loading || !preview || !user) return;
    if (preview.accepted) {
      navigate('/app', { replace: true });
    }
  }, [authLoading, loading, preview, user, navigate]);

  // Connecté avec le bon email → accepter automatiquement
  useEffect(() => {
    if (authLoading || loading || !token || !preview || !user) return;
    if (preview.expired || preview.accepted) return;
    if (user.email.toLowerCase() !== preview.email.toLowerCase()) return;
    if (autoAcceptStarted.current || busy) return;
    autoAcceptStarted.current = true;
    void handleAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-accept
  }, [authLoading, loading, token, preview, user]);

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
  const inviteQs = token
    ? `?redirect=${encodeURIComponent(`/invite/${token}`)}`
    : '';

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
                  to={`/register${inviteQs}`}
                  className="rounded-xl bg-brand px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-dark"
                >
                  Créer un compte pour rejoindre
                </Link>
                <Link
                  to={`/login${inviteQs}`}
                  className="rounded-xl border border-black/10 px-4 py-2.5 text-center text-sm text-text-300 hover:bg-bg-200"
                >
                  Déjà un compte ? Se connecter
                </Link>
              </>
            ) : emailMismatch ? (
              <p className="text-sm text-amber-500">
                Connectez-vous avec <strong>{preview.email}</strong> pour accepter cette invitation.
              </p>
            ) : busy ? (
              <p className="inline-flex items-center justify-center gap-2 text-sm text-text-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Intégration à l’équipe…
              </p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAccept()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                Rejoindre l’équipe
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
