const TOKEN_KEY = 'klanvio-token';

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

export function onAuthLogout(handler: () => void): () => void {
  const fn = () => handler();
  window.addEventListener('auth:logout', fn);
  return () => window.removeEventListener('auth:logout', fn);
}

export function emitAuthLogout(): void {
  clearStoredToken();
  window.dispatchEvent(new Event('auth:logout'));
}
