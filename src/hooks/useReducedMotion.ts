import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Tracks the OS reduced-motion preference and keeps a `.reduce-motion` class on
 * the document in sync, so CSS animations outside React honour it too.
 */
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setPrefersReduced(event.matches);
      document.documentElement.classList.toggle('reduce-motion', event.matches);
    };

    onChange(query);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return prefersReduced;
}
