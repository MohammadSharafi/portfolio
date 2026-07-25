import { useEffect, useState } from 'react';

/**
 * Scroll-spy for the navbar.
 *
 * Reads section positions on each scroll rather than subscribing with an
 * IntersectionObserver at mount: the sections are lazy-loaded, so at mount time
 * none of them are in the DOM yet and an observer would attach to nothing.
 * Looking them up per frame keeps late-mounting sections working for free.
 */
export function useActiveSection(sectionIds: readonly string[]): string {
  // Starts empty so nothing is highlighted while the hero — which is not a
  // navigable section — fills the viewport.
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;

      // The section whose top has most recently passed the reference line wins.
      const line = window.innerHeight * 0.35;
      let current = '';

      for (const id of sectionIds) {
        const element = document.getElementById(id);
        if (!element) continue;

        const { top, bottom } = element.getBoundingClientRect();
        if (top <= line && bottom > line) {
          current = id;
          break;
        }
        if (top <= line) current = id;
      }

      // Near the very bottom the last section may never cross the line, so pin
      // it explicitly rather than leaving the previous one highlighted.
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (atBottom) {
        const last = sectionIds[sectionIds.length - 1];
        if (last && document.getElementById(last)) current = last;
      }

      setActiveId(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [sectionIds]);

  return activeId;
}
