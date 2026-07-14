import type { MeResponse } from '@/lib/api';

const TOKEN_KEY = 'klanvio-token';
const USER_KEY = 'klanvio-user';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredUser(): MeResponse | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MeResponse;
  } catch {
    return null;
  }
}

export function setStoredUser(user: MeResponse): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function clearStoredUser(): void {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  clearStoredToken();
  clearStoredUser();
}

export function onAuthLogout(handler: () => void): () => void {
  const fn = () => handler();
  window.addEventListener('auth:logout', fn);
  return () => window.removeEventListener('auth:logout', fn);
}

export function emitAuthLogout(): void {
  clearSession();
  window.dispatchEvent(new Event('auth:logout'));
}
