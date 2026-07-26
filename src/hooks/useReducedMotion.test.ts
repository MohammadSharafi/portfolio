import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReducedMotion } from './useReducedMotion';

type Listener = (event: { matches: boolean }) => void;

/** Installs a matchMedia whose value can be changed to fire a `change` event. */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  let matches = initial;

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    }),
  });

  return {
    // Wrapped in act: the listeners call setState outside React's own events.
    set(next: boolean) {
      act(() => {
        matches = next;
        listeners.forEach((fn) => fn({ matches: next }));
      });
    },
    listenerCount: () => listeners.size,
  };
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    document.documentElement.className = '';
  });

  it('reports false when the OS expresses no preference', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
    expect(document.documentElement).not.toHaveClass('reduce-motion');
  });

  it('reports true and marks the document when reduced motion is preferred', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
    expect(document.documentElement).toHaveClass('reduce-motion');
  });

  it('follows the preference changing while the page is open', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    media.set(true);
    expect(document.documentElement).toHaveClass('reduce-motion');

    media.set(false);
    expect(document.documentElement).not.toHaveClass('reduce-motion');
  });

  it('detaches its listener on unmount', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('does not throw where matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });

    expect(() => renderHook(() => useReducedMotion())).not.toThrow();
    vi.restoreAllMocks();
  });
});
