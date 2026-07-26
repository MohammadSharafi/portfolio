import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setIsVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <AnimatePresence>
      {isVisible ? (
        <m.button
          type="button"
          onClick={scrollToTop}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          className="no-print glass-strong fixed bottom-6 right-6 z-40 flex size-12 items-center justify-center rounded-full shadow-soft transition-colors hover:bg-primary hover:text-primary-foreground"
          aria-label="Back to top"
        >
          <ArrowUp className="size-5" aria-hidden="true" />
        </m.button>
      ) : null}
    </AnimatePresence>
  );
}
