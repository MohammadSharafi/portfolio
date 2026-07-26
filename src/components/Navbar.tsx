import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Menu, X } from 'lucide-react';
import { navItems } from '@/data/navigation';
import { profile } from '@/data/profile';
import { useActiveSection } from '@/hooks/useActiveSection';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './ThemeToggle';

const sectionIds = navItems.map((item) => item.id);

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const activeSection = useActiveSection(sectionIds);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Escape closes the mobile menu and returns focus to the trigger.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  return (
    <header className="no-print fixed inset-x-0 top-0 z-50 px-3 pt-3">
      <nav
        aria-label="Main"
        className={cn(
          'mx-auto max-w-6xl rounded-2xl transition-all duration-300',
          isScrolled ? 'glass-strong shadow-soft' : 'glass'
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <a
            href="#top"
            className="rounded-lg font-display text-lg font-bold text-gradient"
            aria-label={`${profile.name} — back to top`}
          >
            {profile.initials}
          </a>

          <ul className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'relative rounded-full px-3 py-2 text-sm transition-colors',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {isActive ? (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-full bg-primary/12"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    ) : null}
                    <span className="relative">{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-2">
            <a
              href={profile.cvPath}
              download={profile.cvFileName}
              className="hidden items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] sm:inline-flex"
            >
              <Download className="size-4" aria-hidden="true" />
              Résumé
            </a>

            <ThemeToggle />

            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setIsOpen((open) => !open)}
              className="glass flex size-9 items-center justify-center rounded-full lg:hidden"
              aria-expanded={isOpen}
              aria-controls="mobile-menu"
              aria-label={isOpen ? 'Close menu' : 'Open menu'}
            >
              {isOpen ? (
                <X className="size-4" aria-hidden="true" />
              ) : (
                <Menu className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isOpen ? (
            <motion.div
              id="mobile-menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              // Carries its own opaque surface rather than relying on the bar's
              // backdrop-filter: where compositing is unavailable the blur is
              // dropped and the page behind would show straight through.
              className="overflow-hidden rounded-b-2xl bg-surface lg:hidden"
            >
              <ul className="space-y-1 border-t border-border px-4 py-3">
                {navItems.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        'block rounded-lg px-3 py-2 text-sm transition-colors',
                        activeSection === item.id
                          ? 'bg-primary/12 text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href={profile.cvPath}
                    download={profile.cvFileName}
                    onClick={() => setIsOpen(false)}
                    className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground sm:hidden"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download résumé
                  </a>
                </li>
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </nav>
    </header>
  );
}
