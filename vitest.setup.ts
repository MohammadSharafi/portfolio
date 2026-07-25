import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom implements neither matchMedia nor IntersectionObserver, both of which the
// theme, motion-preference and scroll-spy code paths depend on.
//
// These are plain functions rather than `vi.fn().mockImplementation(...)`: with
// `restoreMocks` enabled, Vitest strips mock implementations between tests, which
// would leave matchMedia returning undefined.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

window.IntersectionObserver = MockIntersectionObserver;
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
