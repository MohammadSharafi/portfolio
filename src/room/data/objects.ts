import { projects } from '@/data/projects';
import { skillGroups } from '@/data/skills';
import { stats } from '@/data/stats';
import { awards, education, learning } from '@/data/credentials';
import { experience } from '@/data/experience';
import { profile } from '@/data/profile';

export type Vec3 = [number, number, number];

export const objectIds = [
  'monitor-health',
  'monitor-code',
  'laptop',
  'notebook',
  'bookshelf',
  'whiteboard',
  'sticky-notes',
  'server-rack',
  'certificates',
  'lamp',
  'window',
  'mug',
  'headphones',
  'keyboard',
] as const;

export type ObjectId = (typeof objectIds)[number];

export interface CameraStop {
  /** Where the camera dollies to. */
  position: Vec3;
  /** What it looks at while it is there. */
  target: Vec3;
  /** Seconds. Slower for a big move across the room, quicker for a lean-in. */
  duration?: number;
}

export interface RoomObject {
  id: ObjectId;
  label: string;
  /** One line, shown on the hover chip. */
  hint: string;
  stop: CameraStop;
  panel: {
    kicker: string;
    title: string;
    body: string;
    items: readonly string[];
    link?: { href: string; label: string };
  };
}

const featured = projects.filter((project) => project.featured);
const core = skillGroups
  .flatMap((group) => group.skills)
  .filter((skill) => skill.level === 'core')
  .map((skill) => skill.name);

/**
 * The room's contents, as data.
 *
 * Every interactive object is one entry: its camera stop, its hover copy and
 * the panel it opens. Object components read their stop from here and never
 * hard-code a camera position, so re-blocking a shot is a data edit rather than
 * a hunt through the scene graph. The panels pull from the same `src/data`
 * the written site uses, so the room cannot drift out of sync with the CV.
 */
export const roomObjects: readonly RoomObject[] = [
  {
    id: 'monitor-health',
    label: 'Clinical monitor',
    hint: 'The healthcare work',
    stop: { position: [-0.55, 1.35, 0.35], target: [-0.62, 1.2, -0.95], duration: 1.4 },
    panel: {
      kicker: 'Healthcare technology',
      title: 'The EHR AI Clinical Assistant',
      body: 'HIPAA-compliant clinical AI, integrated with Cerner/Oracle Health and the Mayo Clinic Platform over SMART on FHIR. 123+ endpoints, an OAuth2 token vault, rate limiting and automatic pagination.',
      items: (experience[0]?.highlights ?? []).slice(0, 4),
      link: { href: '#experience', label: 'Full experience' },
    },
  },
  {
    id: 'monitor-code',
    label: 'Dev monitor',
    hint: 'How I build',
    stop: { position: [0.75, 1.35, 0.35], target: [0.66, 1.2, -0.95], duration: 1.4 },
    panel: {
      kicker: 'Engineering',
      title: 'Architecture chosen for the constraint',
      body: 'Flutter and Dart on the front, Python FastAPI and Java Spring Boot behind, on GCP Cloud Run. The stack follows the problem rather than the fashion.',
      items: core,
      link: { href: '#skills', label: 'Full stack' },
    },
  },
  {
    id: 'laptop',
    label: 'Laptop',
    hint: 'Open it',
    stop: { position: [0.06, 1.14, -0.05], target: [0.06, 0.86, -0.62], duration: 1.2 },
    panel: {
      kicker: 'Terminal',
      title: 'Numbers that hold up',
      body: 'Every figure on this site traces back to a specific piece of work — no rounded-up totals, no borrowed team metrics presented as mine.',
      items: stats.map(
        (stat) => `${stat.prefix ?? ''}${stat.value}${stat.suffix} ${stat.label} — ${stat.detail}`
      ),
    },
  },
  {
    id: 'notebook',
    label: 'Notebook',
    hint: 'Selected work',
    stop: { position: [-1.05, 1.12, -0.18], target: [-1.05, 0.82, -0.68], duration: 1.1 },
    panel: {
      kicker: 'Projects',
      title: 'Selected work',
      body: 'The projects I keep coming back to — distributed systems, local AI, and the mobile clients on top of them.',
      items: featured.map((project) => `${project.title} — ${project.angle}`),
      link: { href: '#projects', label: 'All projects' },
    },
  },
  {
    id: 'bookshelf',
    label: 'Bookshelf',
    hint: 'Still reading',
    stop: { position: [-1.2, 1.55, 0.75], target: [-2.1, 1.5, -0.6], duration: 1.6 },
    panel: {
      kicker: 'Education',
      title: education[0]?.institution ?? 'Isfahan University of Technology',
      body: `${education[0]?.degree ?? 'B.Eng. Computer Software Engineering'}, ${education[0]?.period ?? '2018 — 2022'}. The shelf has not stopped filling since.`,
      items: learning,
      link: { href: '#recognition', label: 'Education' },
    },
  },
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    hint: 'How the systems fit together',
    stop: { position: [1.15, 1.62, 0.5], target: [2.05, 1.6, -0.7], duration: 1.6 },
    panel: {
      kicker: 'Systems',
      title: 'What is actually drawn on it',
      body: 'The architecture I keep coming back to: a Flutter client, a FastAPI gateway, Spring Boot services behind it, and an inference path that stays inside the trust boundary.',
      items: [
        'Client → gateway → service mesh, one hop each',
        'SMART on FHIR for anything touching a record',
        'Token vault at the edge, never in the client',
        'Inference local where the data cannot leave',
        'Every boundary has a rate limit and a retry budget',
      ],
    },
  },
  {
    id: 'sticky-notes',
    label: 'Sticky notes',
    hint: 'Off the record',
    stop: { position: [1.5, 1.45, 0.25], target: [2.05, 1.32, -0.35], duration: 1.2 },
    panel: {
      kicker: 'Off the record',
      title: 'Things that did not fit on the CV',
      body: 'The parts of the story a bullet list flattens.',
      items: [
        'Started in a village with no fibre and no bootcamp',
        'One national exam decided which university would have me',
        'Moved country mid-contract and did not miss a sprint',
        'Still keep the first app I shipped on an old phone',
        `Currently ${profile.availability.toLowerCase()}`,
      ],
    },
  },
  {
    id: 'server-rack',
    label: 'Server rack',
    hint: 'Local-first',
    stop: { position: [1.35, 1.05, 0.95], target: [2.1, 0.65, 0.55], duration: 1.5 },
    panel: {
      kicker: 'Infrastructure',
      title: 'Local-first, by preference',
      body: 'Several of my side projects run inference on the machine rather than shipping data somewhere else. In health software that is not a purity test — it is often the difference between a feature you can ship and one you cannot.',
      items: [
        'Local LLMs and on-device inference',
        'Docker and reproducible environments',
        'gRPC and event-driven orchestration',
        'CI/CD on GitHub Actions and Codemagic',
      ],
    },
  },
  {
    id: 'certificates',
    label: 'Certificates',
    hint: 'Recognition',
    stop: { position: [-1.35, 1.85, 0.35], target: [-2.1, 1.95, -0.5], duration: 1.5 },
    panel: {
      kicker: 'Recognition',
      title: 'Attributable, with an issuer',
      body: 'Each one has a name and a year on it, and the ones that went to the team rather than to me are marked as such.',
      items: awards.map(
        (award) =>
          `${award.title} — ${award.issuer}, ${award.year}${award.scope === 'team' ? ' (team)' : ''}`
      ),
      link: { href: '#recognition', label: 'Awards' },
    },
  },
  {
    id: 'lamp',
    label: 'Desk lamp',
    hint: 'Click to switch',
    stop: { position: [-0.9, 1.25, 0.1], target: [-1.28, 1.05, -0.6], duration: 0.9 },
    panel: {
      kicker: 'Lighting',
      title: 'The lamp works',
      body: 'It is a real light, not a decal — switching it changes what the room is lit by and how the screens read against it. The same idea as the one lit window I grew up with.',
      items: [],
    },
  },
  {
    id: 'window',
    label: 'Window',
    hint: 'Change the hour',
    stop: { position: [0.9, 1.75, 0.9], target: [2.1, 1.75, 0.2], duration: 1.6 },
    panel: {
      kicker: 'Outside',
      title: 'Toronto — next',
      // Deliberately forward-looking rather than a claim about the present.
      // The desk is in Türkiye today; the skyline is where the next move goes.
      // A room that quietly implied otherwise would be the one dishonest thing
      // in a portfolio whose whole argument is that every figure is checkable.
      body: `The view is the next move, not the current one. The desk is still in ${profile.location} — but this journey has never stayed put, and Toronto is where it goes next.`,
      items: [
        `Today: ${profile.location} · ${profile.timezone}`,
        'Next: Toronto, Canada',
        'Remote throughout, with U.S. overlap most days',
      ],
    },
  },
  {
    id: 'mug',
    label: 'Coffee mug',
    hint: 'Push it',
    stop: { position: [0.5, 1.05, -0.1], target: [0.42, 0.84, -0.5], duration: 0.9 },
    panel: {
      kicker: 'Physics',
      title: 'Yes, it falls',
      body: 'The mug, the pencil and the mouse are rigid bodies, not animations. Push one and it behaves — because a room where nothing moves is a diorama, not a workspace.',
      items: [],
    },
  },
  {
    id: 'headphones',
    label: 'Headphones',
    hint: 'Sound on',
    stop: { position: [-0.75, 1.08, -0.1], target: [-0.82, 0.86, -0.5], duration: 0.9 },
    panel: {
      kicker: 'Audio',
      title: 'Room tone',
      body: 'Keys, fans, the mug on the desk — all synthesised in the Web Audio graph rather than downloaded, so the room stays under its budget and nothing is fetched before you ask for it.',
      items: [],
    },
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    hint: 'Type on it',
    stop: { position: [0.02, 1.05, -0.15], target: [0.02, 0.8, -0.45], duration: 0.9 },
    panel: {
      kicker: 'Contact',
      title: 'Get in touch',
      body: `${profile.availability}. The fastest way to reach me is email.`,
      items: [],
      link: { href: '#contact', label: 'Contact details' },
    },
  },
];

export const roomObjectById = new Map(roomObjects.map((object) => [object.id, object]));

/** Where the camera rests when nothing is focused. */
export const HOME_STOP: CameraStop = {
  position: [3.4, 2.6, 3.6],
  target: [0, 1.1, -0.6],
  duration: 1.8,
};
