export const API_BASE_URL = (
  import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3001'
).replace(/\/$/, '');

/**
 * Client ID Google OAuth.
 * Fallback = ID prod Netlify (même client) pour que le bouton reste visible en local
 * quand `web/.env` n’est pas configuré.
 */
const PROD_GOOGLE_CLIENT_ID =
  '505015578658-o30f55iuphed69go2klr2lnn1n3esj31.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || PROD_GOOGLE_CLIENT_ID;
