import { projects } from './projects';
import { skillGroups } from './skills';
import { stats } from './stats';
import { awards, education, learning } from './credentials';
import { experience } from './experience';
import type { HotspotId } from '@/three/hotspots';

/**
 * What each object in the world says when you open it.
 *
 * The room's entries are assembled from the same data the rest of the page
 * renders, so a hotspot cannot drift out of sync with the section it points at
 * — change a project or a figure once and both the panel and the page follow.
 * The journey's entries are written: they are the parts of the story that do
 * not belong on a CV.
 */
export interface HotspotContent {
  id: HotspotId;
  /** The marker's accessible name, and its label on hover. */
  label: string;
  title: string;
  body: string;
  items: readonly string[];
  /** Section the panel's closing link jumps to. */
  section?: string;
  sectionLabel?: string;
}

const featured = projects.filter((project) => project.featured);

const coreSkills = skillGroups
  .flatMap((group) => group.skills)
  .filter((skill) => skill.level === 'core')
  .map((skill) => skill.name);

export const hotspots: readonly HotspotContent[] = [
  {
    id: 'village-window',
    label: 'The lit window',
    title: 'The house I started from',
    body: 'One window with a light on, in a village where the nearest thing to a software career was several hours away. Nobody there was going to hand me the next step, which turned out to be the most useful thing about it.',
    items: [
      'No fibre, no bootcamp, no network to inherit',
      'A public library and a very slow connection',
      'The habit of finishing things without being asked',
    ],
  },
  {
    id: 'exam-books',
    label: 'The stack of books',
    title: 'One exam, one ranking',
    body: "Iran's national university entrance exam is taken once and produces a single number. That number decides which universities will have you. There is no essay, no interview and no second attempt that year — so the preparation is measured in years, not months.",
    items: [
      'A place earned at a selective state school',
      'Years of preparation for a single sitting',
      'A ranking good enough for a top engineering faculty',
    ],
  },
  {
    id: 'university-arcade',
    label: 'The arcade',
    title: 'Isfahan University of Technology',
    body: `${education[0]?.degree ?? 'B.Eng. Computer Software Engineering'} — one of the strongest engineering faculties in the country. Algorithms, optimisation and distributed systems on paper; mobile architecture in practice, and the first code I wrote that other people depended on.`,
    items: education[0]?.highlights ?? [],
    section: 'recognition',
    sectionLabel: 'Education',
  },
  {
    id: 'city-spire',
    label: 'The skyline',
    title: 'The years of actually shipping',
    body: 'Android work at Byte Group, then Robintel. This is where the abstractions stopped being coursework: apps in stores, money moving through them, and a phone in someone’s hand at seven in the morning.',
    items: [
      '10+ mobile apps across education and banking',
      '50,000+ downloads at a 4.5-star average',
      '$2M+ processed through banking apps',
      '99.9% uptime maintained across releases',
    ],
    section: 'experience',
    sectionLabel: 'Experience',
  },
  {
    id: 'crossing-bridge',
    label: 'The bridge',
    title: 'Leaving, on purpose',
    body: 'Moving country is a full-time job stacked on top of a full-time job. New language, new paperwork, new everything — and none of it pauses the sprint you are already committed to. I kept leading an eight-engineer team at Capgroup across the U.S. market while doing it.',
    items: [
      'Led 8 engineers across mobile and web delivery',
      '98% sprint delivery success rate through the move',
      'Clean architecture: +35% maintainability',
      'A second start, in a language I did not yet have',
    ],
    section: 'experience',
    sectionLabel: 'Experience',
  },

  // The room — the present day.
  {
    id: 'monitor-projects',
    label: 'Main monitor',
    title: 'Selected work',
    body: 'The projects I keep coming back to — distributed systems, local AI, and the mobile clients on top of them.',
    items: featured.map((project) => `${project.title} — ${project.angle}`),
    section: 'projects',
    sectionLabel: 'All projects',
  },
  {
    id: 'monitor-code',
    label: 'Code screen',
    title: 'How I build',
    body: 'Flutter and Dart on the front, Python and Java services behind, with the architecture chosen for the constraint rather than the fashion.',
    items: coreSkills,
    section: 'skills',
    sectionLabel: 'Full stack',
  },
  {
    id: 'monitor-terminal',
    label: 'Terminal',
    title: 'Numbers that hold up',
    body: 'Every figure on this site traces back to a specific piece of work.',
    items: stats.map(
      (stat) => `${stat.prefix ?? ''}${stat.value}${stat.suffix} ${stat.label} — ${stat.detail}`
    ),
  },
  {
    id: 'tower',
    label: 'Tower',
    title: 'Local-first, by preference',
    body: 'Several of my side projects run inference on the machine rather than shipping data somewhere else. In health software that is not a purity test — it is often the difference between a feature you can ship and one you cannot.',
    items: [
      'Local LLMs and on-device inference',
      'Docker and reproducible environments',
      'gRPC and event-driven orchestration',
      'CI/CD on GitHub Actions and Codemagic',
    ],
    section: 'skills',
    sectionLabel: 'Full stack',
  },
  {
    id: 'shelf',
    label: 'Bookshelf',
    title: 'Still reading',
    body: 'The shelf has not stopped filling since the degree. What is on it now:',
    items: learning,
    section: 'recognition',
    sectionLabel: 'Education',
  },
  {
    id: 'award',
    label: 'Award',
    title: 'Recognition',
    body: 'Attributable, with an issuer and a year attached to each — and marked where the recognition went to the team rather than to me.',
    items: awards.map(
      (award) =>
        `${award.title} — ${award.issuer}, ${award.year}${award.scope === 'team' ? ' (team)' : ''}`
    ),
    section: 'recognition',
    sectionLabel: 'Awards',
  },
  {
    id: 'phone',
    label: 'Phone',
    title: 'Wired into U.S. healthcare',
    body: `${experience[0]?.role ?? 'Full Stack Engineer'} at ${experience[0]?.company ?? 'March Health'} — the EHR AI Clinical Assistant, integrated with Cerner/Oracle Health and the Mayo Clinic Platform over SMART on FHIR, built from a desk in Türkiye.`,
    items: (experience[0]?.highlights ?? []).slice(0, 4),
    section: 'experience',
    sectionLabel: 'Experience',
  },
];

export const hotspotById = new Map(hotspots.map((hotspot) => [hotspot.id, hotspot]));
