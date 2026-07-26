import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveSection } from './useActiveSection';

const IDS = ['about', 'skills', 'projects'] as const;

/**
 * jsdom gives every element a zero-size rect, so section geometry is stubbed
 * directly. `tops` maps a section id to its viewport-relative top.
 */
function mountSections(tops: Record<string, number>, height = 600) {
  // jsdom reports scrollHeight 0; give the page a real height so the hook does
  // not treat it as an unscrollable short page.
  Object.defineProperty(document.body, 'scrollHeight', {
    value: 5000,
    writable: true,
    configurable: true,
  });

  Object.entries(tops).forEach(([id, top]) => {
    const el = document.createElement('section');
    el.id = id;
    el.getBoundingClientRect = () =>
      ({ top, bottom: top + height, left: 0, right: 0, width: 0, height }) as DOMRect;
    document.body.append(el);
  });
}

/** The hook measures inside requestAnimationFrame, so wait a frame after scrolling. */
async function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useActiveSection', () => {
  it('highlights nothing while the hero still fills the viewport', () => {
    // Every section sits below the reference line at 35% of the viewport.
    mountSections({ about: 900, skills: 1500, projects: 2100 });
    const { result } = renderHook(() => useActiveSection(IDS));

    expect(result.current).toBe('');
  });

  it('selects the section spanning the reference line', () => {
    // Viewport is 768 tall in jsdom, so the line sits at ~269px.
    mountSections({ about: 100, skills: 800, projects: 1400 });
    const { result } = renderHook(() => useActiveSection(IDS));

    expect(result.current).toBe('about');
  });

  it('advances as later sections cross the line', () => {
    mountSections({ about: -700, skills: 100, projects: 900 });
    const { result } = renderHook(() => useActiveSection(IDS));

    expect(result.current).toBe('skills');
  });

  it('ignores ids with no matching element in the document', () => {
    mountSections({ about: 100 });
    const { result } = renderHook(() =>
      useActiveSection(['about', 'does-not-exist', 'also-missing'])
    );

    expect(result.current).toBe('about');
  });

  it('recomputes on scroll', async () => {
    mountSections({ about: 100, skills: 900, projects: 1600 });
    const { result } = renderHook(() => useActiveSection(IDS));
    expect(result.current).toBe('about');

    // Move the sections up as though the page had scrolled down.
    const skills = document.getElementById('skills');
    const about = document.getElementById('about');
    about!.getBoundingClientRect = () => ({ top: -700, bottom: -100 }) as DOMRect;
    skills!.getBoundingClientRect = () => ({ top: 100, bottom: 700 }) as DOMRect;

    await scrollTo(800);
    expect(result.current).toBe('skills');
  });

  it('stops listening once unmounted', async () => {
    mountSections({ about: 100 });
    const { unmount } = renderHook(() => useActiveSection(IDS));

    unmount();
    await expect(scrollTo(400)).resolves.not.toThrow();
  });
});
