import { Building2, Calendar, MapPin } from 'lucide-react';
import { experience } from '@/data/experience';
import { yearsOfExperience } from '@/data/profile';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';

export function Experience() {
  return (
    <Section
      id="experience"
      eyebrow="Experience"
      title="Where I have worked"
      description={`${yearsOfExperience()} years across digital health, fintech and education — mobile first, increasingly full-stack.`}
      width="narrow"
      className="bg-muted/40"
    >
      <ol className="relative space-y-6 border-l border-border pl-6 sm:pl-8">
        {experience.map((role, index) => (
          <Reveal key={`${role.company}-${role.period}`} as="li" delay={index * 0.06}>
            {/* Timeline marker sits on the rail drawn by the list's left border. */}
            <span
              className="absolute -left-[7px] mt-6 flex size-3.5 items-center justify-center"
              aria-hidden="true"
            >
              {role.current ? (
                <span className="animate-pulse-ring absolute size-3.5 rounded-full bg-primary" />
              ) : null}
              <span className="relative size-3.5 rounded-full border-2 border-background bg-primary" />
            </span>

            <article className="glass-strong rounded-2xl p-6 shadow-soft">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-semibold">{role.role}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="size-3.5" aria-hidden="true" />
                      {role.company}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-3.5" aria-hidden="true" />
                      {role.location}
                    </span>
                  </p>
                </div>

                <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/12 px-3 py-1 text-xs font-medium text-primary">
                  <Calendar className="size-3.5" aria-hidden="true" />
                  {role.period}
                </p>
              </header>

              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {role.description}
              </p>

              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-primary">
                Key achievements
              </h4>
              <ul className="mt-2 space-y-2">
                {role.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-3 text-sm text-muted-foreground">
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    {highlight}
                  </li>
                ))}
              </ul>

              <ul className="mt-5 flex flex-wrap gap-1.5">
                {role.tech.map((tech) => (
                  <li
                    key={tech}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {tech}
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
