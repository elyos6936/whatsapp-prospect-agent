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
  fetchMe,
  loginUser,
  loginWithGoogle,
  registerUser,
  type AuthUser,
  type MeResponse,
} from '@/lib/api';
import { clearStoredToken, onAuthLogout, setStoredToken, getStoredToken } from '@/lib/auth-storage';

type AuthState = {
  user: MeResponse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginGoogle: (credential: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
      clearStoredToken();
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  useEffect(() => onAuthLogout(() => setUser(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await loginUser({ email, password });
    setStoredToken(token);
    const me = await fetchMe();
    setUser(me ?? { ...u, whatsapp: { connected: false, state: 'unknown', message: '' } });
  }, []);

  const loginGoogle = useCallback(async (credential: string) => {
    const { token, user: u } = await loginWithGoogle(credential);
    setStoredToken(token);
    const me = await fetchMe();
    setUser(me ?? { ...u, whatsapp: { connected: false, state: 'unknown', message: '' } });
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const { token, user: u } = await registerUser({ email, password, name });
    setStoredToken(token);
    const me = await fetchMe();
    setUser(me ?? { ...u, whatsapp: { connected: false, state: 'unknown', message: '' } });
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, loginGoogle, register, logout, refreshUser }),
    [user, loading, login, loginGoogle, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export type { AuthUser };
