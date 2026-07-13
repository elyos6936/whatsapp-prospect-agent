export const API_BASE_URL = (
  import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3001'
).replace(/\/$/, '');

/** Client ID Google (OAuth). Vide = bouton Google masqué. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || '';
