const PROD_API_DIRECT_URL = 'https://api.klanvio.com';
const DEV_API_URL = 'http://localhost:3001';

function isLocalhostApiUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(url);
}

/**
 * URL de base de l’API.
 * Prod sans env valide → same-origin (`/api/*` proxy Vercel/Netlify) pour éviter CORS
 * et les builds avec VITE_API_URL=localhost par erreur.
 */
function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv && !(import.meta.env.PROD && isLocalhostApiUrl(fromEnv))) {
    return fromEnv;
  }
  if (import.meta.env.PROD) return '';
  return DEV_API_URL;
}

export const API_BASE_URL = resolveApiBaseUrl().replace(/\/$/, '');

/** URL absolue Hostinger (uploads, liens directs). */
export const PROD_API_URL = PROD_API_DIRECT_URL;

/**
 * Client ID Google OAuth.
 * Fallback = ID prod Netlify (même client) pour que le bouton reste visible en local
 * quand `web/.env` n’est pas configuré.
 */
const PROD_GOOGLE_CLIENT_ID =
  '505015578658-o30f55iuphed69go2klr2lnn1n3esj31.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || PROD_GOOGLE_CLIENT_ID;

/** Clé API restreinte pour le Google Picker (référers HTTP). */
export const GOOGLE_PICKER_API_KEY =
  import.meta.env.VITE_GOOGLE_PICKER_API_KEY?.trim() || '';

/**
 * Project number (chiffres) — pas le Project ID.
 * Console → IAM & Admin → Settings → Project number.
 */
export const GOOGLE_CLOUD_PROJECT_NUMBER =
  import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER?.trim() || '';

