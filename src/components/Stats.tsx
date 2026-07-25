import { useEffect, useRef, useState } from 'react';
import { animate, useInView } from 'motion/react';
import { stats } from '@/data/stats';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Reveal } from './ui/Reveal';

function Counter({ value, inView }: { value: number; inView: boolean }) {
  const prefersReducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(prefersReducedMotion ? value : 0);

  useEffect(() => {
    if (!inView || prefersReducedMotion) {
      setDisplay(value);
      return;
    }

    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });

    return () => controls.stop();
  }, [inView, prefersReducedMotion, value]);

  return <>{display}</>;
}

export function Stats() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <section aria-label="Career highlights" className="px-4 py-10">
      <div ref={ref} className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 0.06}>
            <div className="glass-strong h-full rounded-2xl p-6 shadow-soft">
              <stat.icon className="size-6 text-primary" aria-hidden="true" />
              <p className="mt-4 font-display text-3xl font-bold sm:text-4xl">
                {stat.prefix}
                <Counter value={stat.value} inView={inView} />
                {stat.suffix}
              </p>
              <p className="mt-1 font-medium">{stat.label}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{stat.detail}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
