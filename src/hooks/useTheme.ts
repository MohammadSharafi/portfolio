import { useCallback, useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, resolveTheme, storeTheme, type Theme } from '@/lib/theme';

interface UseThemeResult {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    resolveTheme(readStoredTheme())
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    storeTheme(next);
    setResolvedTheme(applyTheme(next));
  }, []);

  // An explicit choice wins; "system" keeps tracking the OS while the tab is open.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolvedTheme(applyTheme('system'));

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
