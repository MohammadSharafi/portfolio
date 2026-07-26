import { useCallback, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react';
import { testimonials } from '@/data/testimonials';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';

export function Testimonials() {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const prefersReducedMotion = useReducedMotion();

  const goTo = useCallback((next: number, from: number) => {
    const total = testimonials.length;
    setDirection(next > from ? 1 : -1);
    setIndex(((next % total) + total) % total);
  }, []);

  // Arrow keys are bound to the controls themselves rather than a focusable
  // wrapper, so the shortcut lives on elements that are genuinely interactive.
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(index + 1, index);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(index - 1, index);
    }
  };

  const current = testimonials[index];
  if (!current) return null;

  const slideOffset = prefersReducedMotion ? 0 : 40 * direction;

  return (
    <Section
      id="testimonials"
      eyebrow="References"
      title="What colleagues say"
      description="Recommendations written by people I have shipped with, quoted from LinkedIn."
      width="narrow"
    >
      <Reveal>
        <div
          role="group"
          aria-roledescription="carousel"
          aria-label="Colleague recommendations"
          className="glass-strong relative rounded-2xl p-6 shadow-soft sm:p-10"
        >
          <Quote className="absolute right-6 top-6 size-10 text-primary/15" aria-hidden="true" />

          <div className="min-h-[16rem] sm:min-h-[13rem]">
            <AnimatePresence mode="wait" initial={false}>
              <m.figure
                key={current.name}
                initial={{ opacity: 0, x: slideOffset }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -slideOffset }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <blockquote className="text-base leading-relaxed sm:text-lg">
                  “{current.quote}”
                </blockquote>

                <figcaption className="mt-6 flex items-center gap-4">
                  <img
                    src={current.avatar}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="size-12 rounded-full object-cover ring-2 ring-primary/20"
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{current.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {current.role}
                      {current.company ? ` · ${current.company}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{current.source}</p>
                  </div>
                </figcaption>
              </m.figure>
            </AnimatePresence>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => goTo(index - 1, index)}
              onKeyDown={onKeyDown}
              className="glass flex size-10 items-center justify-center rounded-full transition-colors hover:bg-primary hover:text-primary-foreground"
              aria-label="Previous recommendation"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>

            <ol className="flex items-center gap-2">
              {testimonials.map((testimonial, dotIndex) => (
                <li key={testimonial.name}>
                  <button
                    type="button"
                    onClick={() => goTo(dotIndex, index)}
                    onKeyDown={onKeyDown}
                    aria-label={`Show recommendation from ${testimonial.name}`}
                    aria-current={dotIndex === index ? 'true' : undefined}
                    className={cn(
                      'block h-2 rounded-full transition-all',
                      dotIndex === index ? 'w-6 bg-primary' : 'w-2 bg-border hover:bg-primary/50'
                    )}
                  />
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => goTo(index + 1, index)}
              onKeyDown={onKeyDown}
              className="glass flex size-10 items-center justify-center rounded-full transition-colors hover:bg-primary hover:text-primary-foreground"
              aria-label="Next recommendation"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>

          <p className="sr-only" aria-live="polite">
            Recommendation {index + 1} of {testimonials.length}, from {current.name}.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
