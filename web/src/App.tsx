import { lazy, Suspense, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';

// Toute l'expérience connectée (chat, markdown, coloration syntaxique,
// automations, réglages) est isolée dans un chunk chargé à la demande, pour que
// la landing et l'authentification restent ultra-légères au premier affichage.
const AuthenticatedApp = lazy(() => import('@/AuthenticatedApp'));

type AuthScreen = 'landing' | 'login' | 'register';

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg-0 text-sm text-text-500">
      {children}
    </div>
  );
}

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const [authScreen, setAuthScreen] = useState<AuthScreen>('landing');

  if (authLoading) {
    return <FullScreen>Chargement…</FullScreen>;
  }

  if (!user) {
    if (authScreen === 'landing') {
      return (
        <LandingPage
          onLogin={() => setAuthScreen('login')}
          onRegister={() => setAuthScreen('register')}
        />
      );
    }
    return authScreen === 'login' ? (
      <LoginPage
        onGoRegister={() => setAuthScreen('register')}
        onGoBack={() => setAuthScreen('landing')}
      />
    ) : (
      <RegisterPage
        onGoLogin={() => setAuthScreen('login')}
        onGoBack={() => setAuthScreen('landing')}
      />
    );
  }

  return (
    <Suspense fallback={<FullScreen>Chargement…</FullScreen>}>
      <AuthenticatedApp />
    </Suspense>
  );
}
