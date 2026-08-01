import { projects } from '@/data/projects';
import { skillGroups } from '@/data/skills';
import { stats } from '@/data/stats';
import { awards, education, learning } from '@/data/credentials';
import { experience } from '@/data/experience';
import { profile } from '@/data/profile';
import { boundsFor, resolveFraming, type Framing, type ResolvedStop, type Vec3 } from './framing';

export type { Vec3 } from './framing';

/**
 * All coordinates here are glTF space, not Blender space.
 *
 * Blender is Z-up and the exporter converts to Y-up, so a point authored in
 * `build_room.py` at `(x, y, z)` arrives in the browser at `(x, z, -y)`.
 *
 * Nothing here is a hand-authored camera position any more. Each object
 * declares which side it should be seen from and how much air to leave; the
 * distance is solved from its measured bounding box and the live aspect ratio.
 * See `framing.ts` for why — the short version is that three of the fifteen
 * hand-authored stops were pointing at empty desk.
 */

export const objectIds = [
  'monitor-health',
  'monitor-code',
  'cv',
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

/** How the index groups the room. Order matters — it is the reading order. */
export const objectGroups = ['Work', 'Craft', 'Story', 'The room'] as const;
export type ObjectGroup = (typeof objectGroups)[number];

/** Things a panel can do beyond showing text. */
export type PanelAction = 'lamp' | 'message' | 'cv';

export interface RoomObject {
  id: ObjectId;
  label: string;
  group: ObjectGroup;
  /** One line, shown on the hover chip. */
  hint: string;
  /** What the visitor should do with it — the guide's copy, and the world
   *  marker's tooltip. Imperative, and specific to this object. */
  guide: string;
  framing: Framing;
  /**
   * Whether this object gets a floating label in the 3D view, and how far
   * above itself it floats.
   *
   * Not everything does, and that is the whole design. Pinning all fifteen put
   * seven labels on one desk where the CV, the keyboard, the mug and two
   * monitors are within 30 cm of each other, and they overlapped into an
   * unreadable stack that hid the desk they were describing. Markers advertise
   * that the room is clickable; six spread around it make that point, and the
   * remaining nine are found by hovering — which is how anyone behaves once
   * they know the first six responded.
   *
   * `lift` staggers the survivors so the two monitors do not collide either.
   */
  marker?: { lift: number };
  /** Seconds. Slower for a big move across the room, quicker for a lean-in. */
  duration: number;
  panel: {
    kicker: string;
    title: string;
    body: string;
    items: readonly string[];
    action?: PanelAction;
    /** `download` names the saved file and turns the link into a download. */
    link?: { href: string; label: string; download?: string };
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
 * Every interactive object is one entry: how it is framed, its hover copy, what
 * the visitor is invited to do, and the panel it opens. The panels pull from
 * the same `src/data` the CV is built from, so the room cannot drift out of
 * sync with the document.
 */
export const roomObjects: readonly RoomObject[] = [
  {
    id: 'monitor-health',
    label: 'Clinical monitor',
    group: 'Work',
    hint: 'The healthcare work',
    guide: 'The clinical system I lead — start here.',
    // Slightly left of square-on and a little above: a screen photographed
    // dead-centre reads as a UI screenshot rather than as a monitor on a desk.
    marker: { lift: 0.3 },
    framing: { from: [-0.14, 0.16, -1], margin: 1.3, offset: [0, 0.02, 0] },
    duration: 1.4,
    panel: {
      kicker: 'Healthcare technology',
      title: 'The EHR AI Clinical Assistant',
      body: 'HIPAA-compliant clinical AI, integrated with Cerner/Oracle Health and the Mayo Clinic Platform over SMART on FHIR. 123+ endpoints, an OAuth2 token vault, rate limiting and automatic pagination — running in production against real clinical records.',
      items: (experience[0]?.highlights ?? []).slice(0, 4),
    },
  },
  {
    id: 'monitor-code',
    label: 'Dev monitor',
    group: 'Craft',
    hint: 'Selected work',
    guide: 'The projects I keep coming back to.',
    marker: { lift: 0.12 },
    framing: { from: [0.14, 0.16, -1], margin: 1.3, offset: [0, 0.02, 0] },
    duration: 1.4,
    panel: {
      kicker: 'Projects',
      title: 'Selected work',
      body: 'The side of the work that is public. Distributed systems, local AI and the mobile clients on top of them — most of it built to answer a question I could not answer by reading about it.',
      items: featured.map((project) => `${project.title} — ${project.angle}`),
    },
  },
  {
    id: 'cv',
    label: 'CV',
    group: 'Work',
    hint: 'Read it, or take a copy',
    guide: 'The whole history — and the PDF to forward.',
    // A4 is 21 cm wide and the page leans 20° back, so this is the tightest
    // stop in the room. Composed from slightly above so the lean does not
    // foreshorten the text away up the sheet.
    marker: { lift: 0.2 },
    framing: { from: [0.06, 0.3, -1], margin: 1.18 },
    duration: 1.2,
    panel: {
      kicker: 'Curriculum vitae',
      title: 'The whole thing, on one page',
      body: 'The document itself, standing on the desk and printed from the same data as everything else in this room. Every role, in order, is below; the PDF is the version to forward.',
      // Every role, not the four the printed page has space for. The sheet is
      // a physical object with an edge; this is not.
      items: experience.map(
        (role) => `${role.role} — ${role.company} · ${role.period} · ${role.location}`
      ),
      action: 'cv',
      link: {
        href: profile.cvPath,
        label: 'Download the PDF',
        download: profile.cvFileName,
      },
    },
  },
  {
    id: 'laptop',
    label: 'Laptop',
    group: 'Work',
    hint: 'Open it',
    guide: 'Every headline number, with its source.',
    framing: { from: [-0.18, 0.34, -1], margin: 1.3 },
    duration: 1.1,
    panel: {
      kicker: 'Terminal',
      title: 'Numbers that hold up',
      body: 'Every figure on this site traces back to a specific piece of work — no rounded-up totals, no borrowed team metrics presented as mine. Where a number belonged to a team, it says so.',
      items: stats.map(
        (stat) => `${stat.prefix ?? ''}${stat.value}${stat.suffix} ${stat.label} — ${stat.detail}`
      ),
    },
  },
  {
    id: 'notebook',
    label: 'Notebook',
    group: 'Story',
    hint: 'Leave me a note',
    guide: 'Write me a message — it opens your mail, already filled in.',
    // Lies flat on the desk, so it is looked down at rather than across. A
    // stop composed level with the desk would show its edge and nothing else.
    framing: { from: [0.08, 0.92, -1], margin: 1.35, minDistance: 0.34 },
    duration: 1.0,
    panel: {
      kicker: 'Say hello',
      title: 'Leave a note',
      body: 'The open page on the desk. Write a line here and it opens your own mail client with the message ready to send — nothing is posted anywhere, and there is no form on my side collecting it.',
      items: [],
      action: 'message',
    },
  },
  {
    id: 'bookshelf',
    label: 'Bookshelf',
    group: 'Story',
    hint: 'Still reading',
    guide: 'Where I studied, and what I am reading now.',
    marker: { lift: 0.05 },
    framing: { from: [1, 0.14, 0.06], margin: 1.15 },
    duration: 1.6,
    panel: {
      kicker: 'Education',
      title: education[0]?.institution ?? 'Isfahan University of Technology',
      body: `${education[0]?.degree ?? 'B.Eng. Computer Software Engineering'}, ${education[0]?.period ?? '2018 — 2022'}. The shelf has not stopped filling since — most of what I use daily was learned after the degree, which is the honest version of every engineer's CV.`,
      items: learning,
    },
  },
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    group: 'Craft',
    hint: 'How the systems fit together',
    guide: 'The architecture I keep coming back to.',
    marker: { lift: 0.06 },
    framing: { from: [1, 0.04, 0], margin: 1.12 },
    duration: 1.6,
    panel: {
      kicker: 'Systems',
      title: 'What is actually drawn on it',
      body: 'The shape most of my work converges on: a Flutter client, a FastAPI gateway, Spring Boot services behind it, and an inference path that stays inside the trust boundary.',
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
    group: 'Story',
    hint: 'Off the record',
    guide: 'The parts a bullet list flattens.',
    framing: { from: [1, 0.12, 0.18], margin: 1.28 },
    duration: 1.2,
    panel: {
      kicker: 'Off the record',
      title: 'Things that did not fit on the CV',
      body: 'The parts of the story a bullet list flattens.',
      items: [
        'Started in a village with no fibre and no bootcamp',
        'One national exam decided which university would have me',
        'Moved country mid-contract and did not miss a sprint',
        'Still keep the first app I shipped on an old phone',
        'Built this room — the model, the bake and the engine — to learn the graphics side properly',
        `Currently ${profile.availability.toLowerCase()}`,
      ],
    },
  },
  {
    id: 'server-rack',
    label: 'Server rack',
    group: 'Craft',
    hint: 'Local-first',
    guide: 'Why so much of my work runs on the machine.',
    marker: { lift: 0.1 },
    framing: { from: [-0.6, 0.4, -1], margin: 1.25 },
    duration: 1.5,
    panel: {
      kicker: 'Infrastructure',
      title: 'Local-first, by preference',
      body: 'Several of my side projects run inference on the machine rather than shipping data somewhere else. In health software that is not a purity test — it is often the difference between a feature you can ship and one you cannot. The stack I reach for daily is on the rack below.',
      // The tools used in production every day, drawn from the same skills
      // data the CV is built from rather than typed out again here.
      items: [
        'Local LLMs and on-device inference',
        'Docker and reproducible environments',
        'gRPC and event-driven orchestration',
        'CI/CD on GitHub Actions and Codemagic',
        `Daily drivers — ${core.join(', ')}`,
      ],
    },
  },
  {
    id: 'certificates',
    label: 'Certificates',
    group: 'Work',
    hint: 'Recognition',
    guide: 'Awards, each with an issuer and a year.',
    framing: { from: [0.08, 0.06, -1], margin: 1.22 },
    duration: 1.5,
    panel: {
      kicker: 'Recognition',
      title: 'Attributable, with an issuer',
      body: 'Each one has a name and a year on it, and the ones that went to the team rather than to me are marked as such.',
      items: awards.map(
        (award) =>
          `${award.title} — ${award.issuer}, ${award.year}${award.scope === 'team' ? ' (team)' : ''}`
      ),
    },
  },
  {
    id: 'lamp',
    label: 'Desk lamp',
    group: 'The room',
    hint: 'Click to switch',
    guide: 'It really switches — watch what the room does.',
    framing: { from: [0.55, 0.28, -1], margin: 1.3 },
    duration: 0.9,
    panel: {
      kicker: 'Lighting',
      title: 'The lamp works',
      body: 'It is a real light, not a decal — switching it changes what the room is lit by and how the screens read against it. The same idea as the one lit window I grew up with.',
      items: [],
      action: 'lamp',
    },
  },
  {
    id: 'window',
    label: 'Window',
    group: 'The room',
    hint: 'The view out',
    guide: 'A city at night, modelled rather than painted.',
    // The measured box is useless here: `ix_window` is the *skyline* — 110 m
    // of city standing outside the glass — so its bounding box is the size of
    // a district. The subject is the opening in the wall, which is what this
    // is: the frame's own dimensions from `build_window`, converted to glTF.
    framing: {
      from: [-0.18, 0.03, -1],
      margin: 1.18,
      bounds: {
        min: [1.3, 1.04, 2.44],
        max: [2.8, 2.36, 2.56],
        center: [2.05, 1.7, 2.5],
        size: [1.5, 1.32, 0.12],
      },
    },
    duration: 1.6,
    panel: {
      kicker: 'Outside',
      title: 'A city at night',
      body: 'Real geometry rather than a photograph on a card: a few dozen towers with lit windows, a lake behind them and a sky that grades from the glow above the rooftops to deep blue overhead. It parallaxes against the frame as the camera moves, which a backdrop image cannot do.',
      items: [
        `The desk itself is in ${profile.location} · ${profile.timezone}`,
        'Remote throughout, with U.S. overlap most days',
        'The glass is transmissive, so the room reflects in it at grazing angles',
      ],
    },
  },
  {
    id: 'mug',
    label: 'Coffee mug',
    group: 'The room',
    hint: 'Push it',
    guide: 'Push it. It is a rigid body, not an animation.',
    framing: { from: [0.25, 0.6, -1], margin: 1.7, minDistance: 0.32 },
    duration: 0.9,
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
    group: 'The room',
    hint: 'Sound on',
    guide: 'Every sound here is synthesised, not downloaded.',
    framing: { from: [0.3, 0.55, -1], margin: 1.6, minDistance: 0.3 },
    duration: 0.9,
    panel: {
      kicker: 'Audio',
      title: 'Room tone',
      body: 'Keys, fans, the mug on the desk — all synthesised in the Web Audio graph rather than downloaded, so the room stays under its budget and nothing is fetched before you ask for it. The guitar is the exception: that plays real tracks.',
      items: [],
    },
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    group: 'Story',
    hint: 'Get in touch',
    guide: 'The fastest way to reach me.',
    framing: { from: [0.04, 0.78, -1], margin: 1.4, minDistance: 0.32 },
    duration: 0.9,
    panel: {
      kicker: 'Contact',
      title: 'Get in touch',
      body: `${profile.availability}. Email is the fastest way to reach me, and it reaches me directly.`,
      items: [],
      action: 'message',
      link: { href: `mailto:${profile.email}`, label: profile.email },
    },
  },
];

export const roomObjectById = new Map(roomObjects.map((object) => [object.id, object]));

/**
 * Solves every stop for one aspect ratio.
 *
 * Called by the rig whenever the viewport changes shape, and memoised there —
 * a phone held in portrait needs the camera further back than a desktop
 * monitor for the same subject, and composing for one and shipping to the
 * other is what makes half these shots wrong on mobile.
 */
export function resolveStops(aspect: number): Map<ObjectId, ResolvedStop> {
  return new Map(
    roomObjects.map((object) => [
      object.id,
      resolveFraming(object.framing, boundsFor(object.id, object.framing), aspect),
    ])
  );
}

/**
 * The establishing shot.
 *
 * It used to be a hand-composed pair of vectors, on the reasoning that it
 * frames the whole room rather than one object and so has no box to solve
 * against. That was wrong twice. There *is* a box — the room is a thing with
 * extents like anything else — and a fixed position frames it correctly at
 * exactly one aspect ratio. Composed on a wide monitor and opened on a phone
 * held upright, where the horizontal field of view collapses to a quarter of
 * its desktop width, the shot cropped the shelf and the window straight off
 * the sides: the visitor's first sight of the room was a slice of it.
 *
 * So it is solved like every other stop, from the same direction the hand-
 * composed version looked along, and it now pulls back on a narrow screen by
 * exactly as much as the narrower frame requires.
 */
const ROOM_BOX = {
  min: [-3.3, 0, -2.6],
  max: [3.2, 2.55, 2.6],
  center: [-0.05, 1.28, 0],
  size: [6.5, 2.55, 5.2],
} as const;

/** The angle the room is seen from — the direction of the original shot,
 *  kept exactly, so only the distance changes with the viewport. */
const HOME_FROM: Vec3 = [6.57, 3.65, -7.4];
const HOME_OFFSET: Vec3 = [-0.17, -0.23, 0.85];

export const HOME_DURATION = 1.8;

/**
 * The establishing shot, solved for one viewport shape.
 *
 * The margin is the interesting part, and it is where a principle gives out.
 * Every other stop can simply back off until its subject fits, because every
 * other subject is smaller than the room. The room is 6.5 m wide and 2.5 m
 * tall, and a phone held upright is the opposite shape — fitting that width
 * honestly puts the camera 25 m away and renders a doll's house floating in a
 * tall empty frame. Fitting the height instead crops both ends off.
 *
 * There is no distance that satisfies both, so this picks: crop, and crop
 * towards the middle, where the desk and the lounge are. A phone sees about
 * three-quarters of the room's width and the ends slide past as the visitor
 * looks around, which is how a room is seen from a doorway anyway. The margin
 * is under 1 on every screen for the same reason — a shot that fits the whole
 * diagonal reads as a model of a room rather than a room.
 */
export function resolveHome(aspect: number): ResolvedStop {
  return resolveFraming(
    {
      from: HOME_FROM,
      margin: aspect < 1 ? 1.0 : 0.82,
      offset: HOME_OFFSET,
      bounds: ROOM_BOX,
      // Nothing opens over the establishing shot, so nothing should be made
      // room for. See `Framing.biased`.
      biased: false,
    },
    ROOM_BOX,
    aspect
  );
}

/** The wide-screen answer, for the initial camera and anything that needs a
 *  stop before a viewport is known. */
export const HOME_STOP: { position: Vec3; target: Vec3; duration: number } = {
  ...resolveHome(1.78),
  duration: HOME_DURATION,
};
