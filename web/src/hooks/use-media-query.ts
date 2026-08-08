import { useEffect, useState } from 'react';

function getMatches(query: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(query).matches;
}

/** Media query hook — syncs immediately on the client to avoid layout flash. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);

  return matches;
}
