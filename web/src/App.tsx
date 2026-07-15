import { lazy, Suspense, useState } from 'react';
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

type AuthScreen = 'landing' | 'login' | 'register' | LegalKind;

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

function AnonymousScreens({
  authScreen,
  setAuthScreen,
}: {
  authScreen: AuthScreen;
  setAuthScreen: (s: AuthScreen) => void;
}) {
  if (authScreen === 'mentions' || authScreen === 'confidentialite' || authScreen === 'contact') {
    return <LegalPage kind={authScreen} onBack={() => setAuthScreen('landing')} />;
  }
  if (authScreen === 'login') {
    return (
      <LoginPage
        onGoRegister={() => setAuthScreen('register')}
        onGoBack={() => setAuthScreen('landing')}
      />
    );
  }
  if (authScreen === 'register') {
    return (
      <RegisterPage
        onGoLogin={() => setAuthScreen('login')}
        onGoBack={() => setAuthScreen('landing')}
      />
    );
  }
  return (
    <LandingPage
      onLogin={() => setAuthScreen('login')}
      onRegister={() => setAuthScreen('register')}
      onOpenLegal={(kind) => setAuthScreen(kind)}
    />
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
  const [authScreen, setAuthScreen] = useState<AuthScreen>(() =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/app')
      ? 'login'
      : 'landing',
  );

  const hasToken = typeof window !== 'undefined' && !!getStoredToken();

  if (!user && !hasToken) {
    return (
      <Suspense fallback={<FullScreen>Chargement…</FullScreen>}>
        <AnonymousScreens authScreen={authScreen} setAuthScreen={setAuthScreen} />
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
        <AnonymousScreens authScreen={authScreen} setAuthScreen={setAuthScreen} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<FullScreen>Chargement…</FullScreen>}>
      <AuthenticatedApp />
    </Suspense>
  );
}
