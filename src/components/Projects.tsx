import { useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowUpRight, Github, Star } from 'lucide-react';
import {
  githubProfileUrl,
  projectCategories,
  projects,
  type ProjectCategory,
} from '@/data/projects';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Section } from './ui/Section';
import { Reveal } from './ui/Reveal';
import { ProjectArtwork } from './ui/ProjectArtwork';

type Filter = 'All' | ProjectCategory;

// Only offer categories that actually match a project — the previous filter bar
// advertised categories that returned nothing.
const availableCategories: readonly Filter[] = [
  'All',
  ...projectCategories.filter((category) =>
    projects.some((project) => project.category === category)
  ),
];

export function Projects() {
  const [filter, setFilter] = useState<Filter>('All');
  const prefersReducedMotion = useReducedMotion();

  const visibleProjects = useMemo(
    () => (filter === 'All' ? projects : projects.filter((p) => p.category === filter)),
    [filter]
  );

  return (
    <Section
      id="projects"
      eyebrow="Projects"
      title="Things I have built"
      description="Mostly systems work: distributed orchestration, local AI, and the mobile clients that sit on top of them."
    >
      <Reveal className="mb-10">
        <div
          role="group"
          aria-label="Filter projects by category"
          className="flex flex-wrap justify-center gap-2"
        >
          {availableCategories.map((category) => {
            const isActive = filter === category;
            const count =
              category === 'All'
                ? projects.length
                : projects.filter((p) => p.category === category).length;

            return (
              <button
                key={category}
                type="button"
                onClick={() => setFilter(category)}
                aria-pressed={isActive}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'glass text-muted-foreground hover:text-foreground'
                )}
              >
                {category}
                <span className="ml-2 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </Reveal>

      <m.ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {visibleProjects.map((project) => (
            <m.li
              key={project.slug}
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="group"
            >
              <article className="glass-strong relative flex h-full flex-col overflow-hidden rounded-2xl shadow-soft transition-shadow hover:shadow-lift">
                <div className="relative h-40 overflow-hidden">
                  <ProjectArtwork
                    pattern={project.pattern}
                    hue={project.hue}
                    seed={project.slug}
                    className="size-full transition-transform duration-500 group-hover:scale-105"
                  />
                  {project.featured ? (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                      <Star className="size-3 fill-current" aria-hidden="true" />
                      Featured
                    </span>
                  ) : null}
                  <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                    {project.category}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-6">
                  <div>
                    <h3 className="font-display text-lg font-semibold">
                      {/* Only a link when there is somewhere honest to send
                        people. A closed-source project keeps its title as
                        plain text and says who owns the code instead. */}
                      {project.repo ? (
                        <a
                          href={project.repo}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="after:absolute after:inset-0 after:content-['']"
                        >
                          {project.title}
                        </a>
                      ) : (
                        project.title
                      )}
                    </h3>
                    {project.closed ? (
                      <p className="mt-1 text-xs text-muted-foreground/70">{project.closed}</p>
                    ) : null}
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {project.summary}
                    </p>
                  </div>

                  <p className="border-l-2 border-primary/40 pl-3 text-sm italic leading-relaxed text-muted-foreground">
                    {project.angle}
                  </p>

                  <ul className="mt-auto flex flex-wrap gap-1.5">
                    {project.tags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-xs text-primary"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>

                  <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                    <Github className="size-4" aria-hidden="true" />
                    View source
                    <ArrowUpRight
                      className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </article>
            </m.li>
          ))}
        </AnimatePresence>
      </m.ul>

      <Reveal delay={0.1} className="mt-12 text-center">
        <a
          href={githubProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="glass inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Github className="size-4" aria-hidden="true" />
          Browse everything on GitHub
        </a>
      </Reveal>
    </Section>
  );
}
