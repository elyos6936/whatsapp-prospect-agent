import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Remonte en haut à chaque navigation SPA (pages marketing / légales / auth).
 * scrollRestoration navigateur désactivé pour éviter de rester en bas.
 */
export function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    // Ancres landing (#pricing…) : gérées ailleurs
    if (hash) return;

    const reset = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const root = document.getElementById('root');
      if (root) root.scrollTop = 0;
    };

    reset();
    // Après paint / layout de la nouvelle page
    const id = window.requestAnimationFrame(() => {
      reset();
      window.setTimeout(reset, 0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pathname, search, hash]);

  return null;
}
