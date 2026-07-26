import { AnimatePresence, m } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="glass relative flex size-9 items-center justify-center overflow-hidden rounded-full transition-colors hover:border-primary/40"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <m.span
          key={isDark ? 'moon' : 'sun'}
          initial={prefersReducedMotion ? false : { y: -14, opacity: 0, rotate: -60 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { y: 14, opacity: 0, rotate: 60 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-center"
        >
          {isDark ? (
            <Moon className="size-4 text-primary" aria-hidden="true" />
          ) : (
            <Sun className="size-4 text-primary" aria-hidden="true" />
          )}
        </m.span>
      </AnimatePresence>
    </button>
  );
}
