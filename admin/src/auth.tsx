import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, clearToken, getToken, setToken } from "./api";

type AuthState = {
  email: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ email: string }>("/api/admin/auth/me")
      .then((me) => setEmail(me.email))
      .catch(() => {
        clearToken();
        setEmail(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (mail: string, password: string) => {
    const res = await api<{ token: string; email: string }>("/api/admin/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: mail, password }),
    });
    setToken(res.token);
    setEmail(res.email);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setEmail(null);
  }, []);

  const value = useMemo(
    () => ({ email, loading, login, logout }),
    [email, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
