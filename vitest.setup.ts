import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Node 22+ ships its own `globalThis.localStorage` and leaves it `undefined`
// unless the process was started with `--localstorage-file`. Vitest's jsdom
// environment only copies a window property onto the global when the global does
// not already own that name, so Node's undefined one wins and jsdom's Storage
// never becomes reachable — and because Vitest makes `window`, `globalThis` and
// `document.defaultView` the same proxy, there is no second window object to
// borrow a working implementation from.
//
// That breaks the code under test, not just the assertions: `theme.ts` reads and
// writes bare `localStorage` inside a try/catch, so the TypeError is swallowed
// and persistence silently degrades to a no-op. Supplying storage here keeps
// `localStorage` behaving the way it does in a browser.
//
// Like the mocks below, this is a plain object rather than `vi.fn()`: with
// `restoreMocks` enabled, Vitest would strip the implementations between tests.
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  clear(): void {
    this.#entries.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  writable: true,
  configurable: true,
  value: new MemoryStorage(),
});

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
