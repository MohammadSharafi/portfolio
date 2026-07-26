import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Reveal } from './Reveal';

interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Constrains the content column; sections with dense text read better narrow. */
  width?: 'default' | 'narrow';
}

export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  width = 'default',
}: SectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn('scroll-mt-24 px-4 py-24 sm:py-28', className)}
    >
      <div className={cn('mx-auto', width === 'narrow' ? 'max-w-4xl' : 'max-w-6xl')}>
        <Reveal className="mb-14 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
          <h2 id={headingId} className="mt-3 text-3xl font-bold sm:text-4xl md:text-5xl">
            {title}
          </h2>
          {description ? (
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </Reveal>

        {children}
      </div>
    </section>
  );
}
