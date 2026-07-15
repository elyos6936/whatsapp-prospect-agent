import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { getStoredToken } from '@/lib/auth-storage';
import type { LegalKind } from '@/pages/LegalPage';

const LandingPage = lazy(() =>
  import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
const LegalPage = lazy(() =>
  import('@/pages/LegalPage').then((m) => ({ default: m.LegalPage })),
);
const AuthenticatedApp = lazy(() => import('@/AuthenticatedApp'));

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg-0 text-sm text-text-500">
      {children}
    </div>
  );
}

function SessionRetry({
  message,
  onRetry,
  onLogout,
}: {
  message: string;
  onRetry: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg-0 px-6 text-center">
      <p className="max-w-sm text-sm text-text-300">
        Session en cours, mais le serveur ne répond pas.
        <span className="mt-1 block text-text-500">{message}</span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Réessayer
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-xl border border-black/10 px-4 py-2 text-sm text-text-300 hover:bg-bg-100"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

function LegalRoute({ kind }: { kind: LegalKind }) {
  const navigate = useNavigate();
  return <LegalPage kind={kind} onBack={() => navigate('/')} />;
}

function PublicRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/mentions" element={<LegalRoute kind="mentions" />} />
      <Route path="/confidentialite" element={<LegalRoute kind="confidentialite" />} />
      <Route path="/contact" element={<LegalRoute kind="contact" />} />
      <Route path="/app" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const {
    user,
    loading: authLoading,
    sessionError,
    retrySession,
    logout,
  } = useAuth();

  const hasToken = typeof window !== 'undefined' && !!getStoredToken();

  if (!user && !hasToken) {
    return (
      <Suspense fallback={<FullScreen>Chargement…</FullScreen>}>
        <PublicRoutes />
      </Suspense>
    );
  }

  if (authLoading && !user) {
    return <FullScreen>Chargement…</FullScreen>;
  }

  if (!user && sessionError) {
    return (
      <SessionRetry
        message={sessionError}
        onRetry={() => void retrySession()}
        onLogout={logout}
      />
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<FullScreen>Chargement…</FullScreen>}>
        <PublicRoutes />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<FullScreen>Chargement…</FullScreen>}>
      <Routes>
        <Route path="/login" element={<Navigate to="/app" replace />} />
        <Route path="/register" element={<Navigate to="/app" replace />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </Suspense>
  );
}
