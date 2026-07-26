import { m } from 'motion/react';
import { journey } from '@/data/journey';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

/**
 * The narrative that runs alongside the 3D journey.
 *
 * Both layouts render the same list from the same data. `overlay` stacks the
 * chapters and cross-fades to the one the camera is currently at; `static` is
 * the plain vertical timeline shown when there is no WebGL to travel through.
 * Neither hides content from assistive technology: the overlay keeps every
 * chapter in the accessibility tree and in the document, so a screen reader
 * gets the whole story in order rather than whichever paragraph happens to be
 * visible at the scroll position it started from.
 */
export function Journey({
  activeIndex,
  variant,
}: {
  activeIndex: number;
  variant: 'overlay' | 'static';
}) {
  const prefersReducedMotion = useReducedMotion();

  if (variant === 'static') {
    return (
      <ol className="mt-12 space-y-8 border-l border-border pl-6">
        {journey.map((chapter) => (
          <li key={chapter.id} className="relative">
            <span
              className="absolute -left-[1.655rem] top-2 size-3 rounded-full border-2 border-background bg-primary"
              aria-hidden="true"
            />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary-strong">
              {chapter.index} · {chapter.period}
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold">{chapter.title}</h3>
            <p className="text-sm text-muted-foreground">{chapter.place}</p>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {chapter.body}
            </p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0">
      {/* The chapter rail: where you are in the story, and how much is left. */}
      <ol
        className="absolute right-4 top-1/2 hidden -translate-y-1/2 gap-3 md:grid lg:right-8"
        aria-hidden="true"
      >
        {journey.map((chapter, index) => (
          <li key={chapter.id} className="flex items-center justify-end gap-3">
            <span
              className={cn(
                'font-mono text-[10px] tabular-nums transition-colors duration-500',
                index === activeIndex ? 'text-foreground' : 'text-muted-foreground/50'
              )}
            >
              {chapter.index}
            </span>
            <span
              className={cn(
                'block h-px transition-all duration-500',
                index === activeIndex ? 'w-10 bg-foreground' : 'w-4 bg-muted-foreground/40'
              )}
            />
          </li>
        ))}
      </ol>

      {/* The captions. Stacked, so the box never resizes as chapters change. */}
      <ol className="absolute inset-x-4 bottom-16 mx-auto max-w-6xl sm:bottom-20 lg:inset-x-8">
        {journey.map((chapter, index) => {
          const active = index === activeIndex;
          return (
            <m.li
              key={chapter.id}
              className={cn(
                'max-w-lg',
                // Only the first chapter takes part in layout; the rest stack
                // on top of it so nothing reflows mid-scroll.
                index === 0 ? 'relative' : 'absolute inset-x-0 bottom-0'
              )}
              initial={false}
              animate={{
                opacity: active ? 1 : 0,
                y: prefersReducedMotion ? 0 : active ? 0 : 14,
              }}
              transition={{
                duration: prefersReducedMotion ? 0.15 : 0.55,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary-strong">
                {chapter.index} — {chapter.place}
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold leading-tight sm:text-3xl">
                {chapter.title}
              </h2>
              <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {chapter.period}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {chapter.body}
              </p>
            </m.li>
          );
        })}
      </ol>
    </div>
  );
}
