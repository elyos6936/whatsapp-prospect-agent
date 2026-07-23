import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  fetchMe,
  loginUser,
  loginWithGoogle,
  registerUser,
  type AuthUser,
  type MeResponse,
} from '@/lib/api';
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  onAuthLogout,
  setStoredToken,
  setStoredUser,
} from '@/lib/auth-storage';

type AuthState = {
  user: MeResponse | null;
  loading: boolean;
  /** Token présent mais serveur injoignable au démarrage */
  sessionError: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  /** Met à jour immédiatement le statut WhatsApp côté UI (ex. après Déconnecter). */
  patchWhatsApp: (whatsapp: MeResponse['whatsapp']) => void;
  retrySession: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function toMe(user: AuthUser, fallbackWhatsApp?: MeResponse['whatsapp']): MeResponse {
  return {
    ...user,
    whatsapp: user.whatsapp ??
      fallbackWhatsApp ?? { connected: false, state: 'unknown', message: '' },
  };
}

function syncAppUrl(loggedIn: boolean): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (loggedIn) {
    // Après connexion : quitter landing / auth vers l'app
    if (path === '/' || path === '/login' || path === '/register') {
      window.history.pushState(null, '', '/app');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  // Après déconnexion : quitter seulement l'espace app
  if (path === '/app' || path.startsWith('/app/')) {
    window.history.pushState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const applyUser = useCallback((me: MeResponse | null) => {
    setUser(me);
    if (me) {
      setStoredUser(me);
      syncAppUrl(true);
    } else {
      syncAppUrl(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      applyUser(null);
      setSessionError(null);
      return;
    }

    try {
      const me = await fetchMe();
      applyUser(me);
      setSessionError(null);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      // Session invalide uniquement sur 401 — ne pas déconnecter sur une erreur réseau / 5xx
      if (status === 401) {
        clearSession();
        applyUser(null);
        setSessionError(null);
        return;
      }

      // Garder la session courante (mémoire ou cache) si le serveur est juste injoignable
      setUser((current) => {
        if (current) {
          setStoredUser(current);
          syncAppUrl(true);
          return current;
        }
        const cached = getStoredUser();
        if (cached) {
          syncAppUrl(true);
          return cached;
        }
        setSessionError(
          err instanceof Error ? err.message : 'Impossible de rejoindre le serveur',
        );
        return null;
      });
    }
  }, [applyUser]);

  const retrySession = useCallback(async () => {
    setLoading(true);
    setSessionError(null);
    await refreshUser();
    setLoading(false);
  }, [refreshUser]);

  useEffect(() => {
    void (async () => {
      // Restaurer immédiatement le profil en cache pour éviter un flash landing
      const token = getStoredToken();
      const cached = getStoredUser();
      if (token && cached) {
        setUser(cached);
        syncAppUrl(true);
      }
      await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  useEffect(
    () =>
      onAuthLogout(() => {
        applyUser(null);
        setSessionError(null);
      }),
    [applyUser],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user: u } = await loginUser({ email, password });
      setStoredToken(token);
      const me = await fetchMe();
      applyUser(me ?? toMe(u));
      setSessionError(null);
    },
    [applyUser],
  );

  const loginGoogle = useCallback(
    async (accessToken: string) => {
      const { token, user: u } = await loginWithGoogle(accessToken);
      setStoredToken(token);
      const me = await fetchMe();
      applyUser(me ?? toMe(u));
      setSessionError(null);
    },
    [applyUser],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const { token, user: u } = await registerUser({ email, password, name });
      setStoredToken(token);
      const me = await fetchMe();
      applyUser(me ?? toMe(u));
      setSessionError(null);
    },
    [applyUser],
  );

  const logout = useCallback(() => {
    clearSession();
    applyUser(null);
    setSessionError(null);
  }, [applyUser]);

  const patchWhatsApp = useCallback((whatsapp: MeResponse['whatsapp']) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, whatsapp };
      setStoredUser(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionError,
      login,
      loginGoogle,
      register,
      logout,
      refreshUser,
      patchWhatsApp,
      retrySession,
    }),
    [
      user,
      loading,
      sessionError,
      login,
      loginGoogle,
      register,
      logout,
      refreshUser,
      patchWhatsApp,
      retrySession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export type { AuthUser };
