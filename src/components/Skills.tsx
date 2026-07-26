import {
  alsoFamiliarWith,
  proficiencyDescription,
  proficiencyLabel,
  skillGroups,
  type Proficiency,
} from '@/data/skills';
import { cn } from '@/lib/utils';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';

const levelStyles: Record<Proficiency, string> = {
  core: 'bg-primary/15 text-primary-strong border-primary/25',
  working: 'bg-accent/12 text-accent-strong border-accent/25',
  exploring: 'bg-muted text-muted-foreground border-border',
};

const legendOrder: readonly Proficiency[] = ['core', 'working', 'exploring'];

export function Skills() {
  return (
    <Section
      id="skills"
      eyebrow="Skills"
      title="What I work with"
      description="Grouped by how deeply I use each one, rather than by a self-assigned percentage."
    >
      <Reveal className="mb-10 flex flex-wrap justify-center gap-3">
        {legendOrder.map((level) => (
          <span
            key={level}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium',
              levelStyles[level]
            )}
          >
            {proficiencyLabel[level]} — {proficiencyDescription[level]}
          </span>
        ))}
      </Reveal>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {skillGroups.map((group, index) => (
          <Reveal key={group.title} delay={index * 0.06}>
            <article className="glass-strong h-full rounded-2xl p-6 shadow-soft transition-shadow hover:shadow-lift">
              <h3 className="font-display text-lg font-semibold">{group.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>

              <ul className="mt-5 flex flex-wrap gap-2">
                {group.skills.map((skill) => (
                  <li key={skill.name}>
                    <span
                      className={cn(
                        'inline-block rounded-full border px-3 py-1.5 text-sm',
                        levelStyles[skill.level]
                      )}
                      title={proficiencyDescription[skill.level]}
                    >
                      {skill.name}
                      <span className="sr-only"> — {proficiencyLabel[skill.level]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1} className="mt-12">
        <h3 className="text-center font-display text-lg font-semibold">Also familiar with</h3>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {alsoFamiliarWith.map((item) => (
            <li key={item} className="glass rounded-full px-4 py-2 text-sm text-muted-foreground">
              {item}
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
