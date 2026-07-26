import { awards, education } from '@/data/credentials';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';

export function Recognition() {
  return (
    <Section
      id="recognition"
      eyebrow="Recognition"
      title="Awards & education"
      description="Everything listed here is attributable to a named issuer and year."
    >
      <ul className="grid gap-5 md:grid-cols-3">
        {awards.map((award, index) => (
          <Reveal key={award.title} as="li" delay={index * 0.07}>
            <article className="glass-strong flex h-full flex-col rounded-2xl p-6 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/12">
                  <award.icon className="size-5 text-primary" aria-hidden="true" />
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {award.year}
                </span>
              </div>

              <h3 className="mt-4 font-display text-base font-semibold">{award.title}</h3>
              <p className="mt-1 text-sm text-primary">{award.issuer}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {award.description}
              </p>

              {award.scope === 'team' ? (
                <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
                  Team / company award
                </p>
              ) : null}
            </article>
          </Reveal>
        ))}
      </ul>

      <div className="mt-6 grid gap-5">
        {education.map((entry, index) => (
          <Reveal key={entry.degree} delay={index * 0.07}>
            <article className="glass-strong rounded-2xl p-6 shadow-soft">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/12">
                  <entry.icon className="size-5 text-accent" aria-hidden="true" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-display text-base font-semibold">{entry.degree}</h3>
                    <p className="text-sm text-muted-foreground">{entry.period}</p>
                  </div>
                  <p className="mt-1 text-sm text-primary">{entry.institution}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{entry.detail}</p>

                  <ul className="mt-3 space-y-2">
                    {entry.highlights.map((highlight) => (
                      <li key={highlight} className="flex gap-3 text-sm text-muted-foreground">
                        <span
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                          aria-hidden="true"
                        />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
