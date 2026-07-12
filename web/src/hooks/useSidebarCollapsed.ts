import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'klanvio-sidebar-collapsed';

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((value) => !value);
  }, []);

  return [collapsed, toggle];
}
