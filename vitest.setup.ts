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

// Node 26 ships its own `localStorage` global, and it is `undefined` unless the
// process was started with `--localstorage-file`. It is defined before the jsdom
// environment is installed and wins, so `localStorage`, `window.localStorage`
// and `globalThis.localStorage` are all undefined inside a jsdom test while
// `document` works perfectly — which is what made this look like the test file
// running under the wrong environment. It is not; it is a Node upgrade
// shadowing one global.
//
// Installed only when the platform has not provided a working one, so a future
// Node or jsdom that does keeps its own.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  class MemoryStorage implements Storage {
    #entries = new Map<string, string>();

    get length() {
      return this.#entries.size;
    }
    key(index: number) {
      return [...this.#entries.keys()][index] ?? null;
    }
    getItem(key: string) {
      return this.#entries.get(key) ?? null;
    }
    // The DOM spec stringifies both, and the difference shows up the moment a
    // test stores a non-string and reads back `"undefined"` rather than undefined.
    setItem(key: string, value: string) {
      this.#entries.set(String(key), String(value));
    }
    removeItem(key: string) {
      this.#entries.delete(key);
    }
    clear() {
      this.#entries.clear();
    }
  }

  Object.defineProperty(globalThis, 'localStorage', {
    writable: true,
    configurable: true,
    value: new MemoryStorage(),
  });
}

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
