import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_STORAGE_KEY,
} from './theme';

function mockSystemDark(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    mockSystemDark(false);
  });

  it('recognises only the three supported values', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(true);
    expect(isTheme('solarized')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('defaults to system when nothing is stored', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('round-trips a stored preference', () => {
    storeTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('falls back to system when the stored value is corrupt', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readStoredTheme()).toBe('system');
  });

  it('resolves system against the OS preference', () => {
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');

    mockSystemDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('lets an explicit choice override the OS preference', () => {
    mockSystemDark(true);
    expect(resolveTheme('light')).toBe('light');
  });

  it('toggles the dark class and color-scheme on the document', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    expect(applyTheme('light')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
