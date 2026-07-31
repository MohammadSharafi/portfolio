import { useEffect, useRef } from 'react';
import { characterState } from '../engine/characterState';
import { useEngine } from '../engine/store';

/**
 * The room from above, and how to drive it.
 *
 * A plan drawn from the same coordinates the collision system uses, so it
 * cannot disagree with the room it describes — every rectangle here is a
 * footprint the robot will actually be stopped by. It exists because the
 * follow camera is a good storyteller and a poor navigator: from 12 cm off the
 * boards, behind a machine the height of a coffee cup, a visitor has no idea
 * the guitar is behind them and the shelves are a room away.
 *
 * Three things changed in the redesign. Labels used to be text pinned above
 * every mark, which collided into an unreadable pile in the top-left corner
 * where the door and the whiteboard are 40 cm apart; they are now dots, and
 * the name of whatever the robot is nearest is written once, underneath, where
 * there is room for it. Height is drawn rather than implied — furniture the
 * robot can land on is filled brighter than furniture it cannot reach, because
 * the map's real job in a room with flight is answering "can I get up there".
 * And the marker carries a view cone rather than just a heading arrow, so
 * "what am I looking at" is answered without reading the 3D view.
 *
 * The marker is written straight into the DOM on an animation frame rather
 * than through React state. A position that changes sixty times a second has
 * no business re-rendering a component tree, and everything else in the panel
 * is static.
 */

/** The floor, in world metres — the same bounds the character clamps to. */
const ROOM = { minX: -3.12, maxX: 3.0, minZ: -2.3, maxZ: 2.48 };

/** Drawing box, in SVG units. */
const W = 168;
const H = 142;
const PAD = 9;

const spanX = ROOM.maxX - ROOM.minX;
const spanZ = ROOM.maxZ - ROOM.minZ;

/** World x to plan x. */
const px = (x: number) => PAD + ((x - ROOM.minX) / spanX) * (W - PAD * 2);
/** World z to plan y — flipped, so the desk wall sits at the top of the map
 *  the way it sits at the back of the room. */
const py = (z: number) => PAD + ((ROOM.maxZ - z) / spanZ) * (H - PAD * 2);
/** A world distance to plan units, for radii. */
const pr = (r: number) => (r / spanX) * (W - PAD * 2);

interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Metres. Drives how solid the shape reads: a surface the robot can stand
   *  on is drawn brighter than one it can only walk around. */
  top: number;
}

/** Straight from the character's collision boxes. */
const FURNITURE: readonly Footprint[] = [
  { x0: -1.1, z0: 1.78, x1: 1.1, z1: 2.48, top: 0.79 }, // desk
  { x0: -0.88, z0: -2.1, x1: 1.28, z1: -1.3, top: 0.48 }, // sofa
  { x0: -0.32, z0: -0.78, x1: 0.82, z1: -0.22, top: 0.36 }, // coffee table
  { x0: -2.7, z0: 1.5, x1: -2.16, z1: 2.44, top: 1.02 }, // dresser
  { x0: -3.12, z0: -0.1, x1: -2.86, z1: 1.9, top: 2.18 }, // bookshelf
  { x0: 2.62, z0: 1.82, x1: 3.0, z1: 2.44, top: 0.98 }, // server rack
];

/** Round things: pedestals, pots, the chair's star base. */
const POSTS: readonly { x: number; z: number; r: number }[] = [
  { x: -1.22, z: -1.85, r: 0.17 },
  { x: 1.62, z: -0.55, r: 0.2 },
  { x: 2.78, z: -0.35, r: 0.2 },
  { x: 1.34, z: 1.92, r: 0.16 },
  { x: 0.45, z: 0.81, r: 0.28 },
];

/** Places worth walking to. No text — the legend below names the nearest one,
 *  which is the only one the visitor needs named. */
const MARKS: readonly { x: number; z: number; label: string; accent?: boolean }[] = [
  { x: -2.86, z: -2.3, label: 'Guitar', accent: true },
  { x: 0, z: 2.3, label: 'The desk' },
  { x: -3.0, z: 0.9, label: 'Bookshelf' },
  { x: -3.05, z: 1.35, label: 'Whiteboard' },
  { x: 2.05, z: 2.44, label: 'Window' },
  { x: -2.6, z: 2.44, label: 'Door' },
  { x: 0.2, z: -1.7, label: 'The sofa' },
];

export function Minimap() {
  const marker = useRef<SVGGElement>(null);
  const nearest = useRef<HTMLSpanElement>(null);
  const altitude = useRef<SVGRectElement>(null);
  const musicOpen = useEngine((state) => state.musicOpen);

  useEffect(() => {
    let frame = 0;
    let lastLabel = '';

    const tick = () => {
      const node = marker.current;
      if (node) {
        const { x, z } = characterState.position;
        // The robot faces (sin h, cos h) in world x/z. The plan flips z, so
        // that direction lands on screen as (sin h, −cos h) — which is an
        // up-pointing arrow rotated clockwise by exactly h.
        node.setAttribute(
          'transform',
          `translate(${px(x).toFixed(2)} ${py(z).toFixed(2)}) rotate(${(
            (characterState.heading * 180) /
            Math.PI
          ).toFixed(1)})`
        );
        node.setAttribute('data-air', characterState.airborne ? '1' : '0');

        // Whatever is closest, named once. Cheap: seven distances, no sqrt.
        let best = Infinity;
        let label = '';
        for (const mark of MARKS) {
          const dx = mark.x - x;
          const dz = mark.z - z;
          const distance = dx * dx + dz * dz;
          if (distance < best) {
            best = distance;
            label = mark.label;
          }
        }
        if (label !== lastLabel && nearest.current) {
          nearest.current.textContent = label;
          lastLabel = label;
        }
      }

      // Height, as a bar. The room is played in three dimensions the moment
      // the thrusters light, and a plan view is blind to the one that matters.
      if (altitude.current) {
        const height = Math.max(0, Math.min(1, (characterState.position.y - 0.02) / 2.32));
        altitude.current.setAttribute('height', (height * (H - PAD * 2)).toFixed(2));
        altitude.current.setAttribute('y', (PAD + (1 - height) * (H - PAD * 2)).toFixed(2));
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="pointer-events-none absolute right-4 top-16 w-[200px] overflow-hidden rounded-2xl border border-white/10 bg-black/65 backdrop-blur-md">
      <div className="px-3 pb-1 pt-2.5">
        <p className="font-mono text-[0.55rem] uppercase tracking-[0.24em] text-white/30">
          The room
        </p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full px-1"
        role="img"
        aria-label="Plan of the room showing where you are"
      >
        <defs>
          {/* The view cone, fading out with distance — a torch beam rather
            than a wedge with an edge, which would read as a solid object. */}
          <linearGradient id="mm-cone" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgb(45 245 200)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="rgb(45 245 200)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="mm-floor" cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor="rgb(255 255 255)" stopOpacity="0.07" />
            <stop offset="100%" stopColor="rgb(255 255 255)" stopOpacity="0.02" />
          </radialGradient>
        </defs>

        <rect
          x={PAD}
          y={PAD}
          width={W - PAD * 2}
          height={H - PAD * 2}
          rx="4"
          fill="url(#mm-floor)"
        />

        {/* The two walls the room is built against, drawn heavier than the
          open sides so the plan has an orientation at a glance. */}
        <path
          d={`M ${PAD} ${PAD} H ${W - PAD} M ${PAD} ${PAD} V ${H - PAD}`}
          className="stroke-white/30"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />

        {FURNITURE.map((box, i) => (
          <rect
            key={i}
            x={px(box.x0)}
            y={py(box.z1)}
            width={px(box.x1) - px(box.x0)}
            height={py(box.z0) - py(box.z1)}
            rx="2"
            // Taller furniture reads more solid: it is both more of an
            // obstacle and more of a destination once the robot can fly.
            fill={`rgba(255,255,255,${(0.05 + Math.min(0.1, box.top * 0.05)).toFixed(3)})`}
            className="stroke-white/20"
            strokeWidth="0.6"
          />
        ))}

        {POSTS.map((post, i) => (
          <circle
            key={i}
            cx={px(post.x)}
            cy={py(post.z)}
            r={Math.max(1.7, pr(post.r))}
            className="fill-white/[0.09] stroke-white/20"
            strokeWidth="0.5"
          />
        ))}

        {MARKS.map((mark) => (
          <circle
            key={mark.label}
            cx={px(mark.x)}
            cy={py(mark.z)}
            r={mark.accent ? 2.4 : 1.7}
            className={mark.accent ? 'fill-emerald-300' : 'fill-white/35'}
          >
            {mark.accent && musicOpen ? (
              <animate attributeName="r" values="2.4;3.6;2.4" dur="1.8s" repeatCount="indefinite" />
            ) : null}
          </circle>
        ))}

        {/* The robot: a view cone and a wedge that point where it faces. */}
        <g ref={marker} data-air="0" className="[&[data-air='1']_.halo]:opacity-100">
          <path d="M 0 0 L -13 -21 A 25 25 0 0 1 13 -21 Z" fill="url(#mm-cone)" />
          <circle r="6.5" className="halo fill-emerald-300/20 opacity-0 transition-opacity" />
          <path d="M 0 -5 L 3.4 3.6 L 0 1.9 L -3.4 3.6 Z" className="fill-emerald-300" />
        </g>

        {/* Altitude, up the right edge. Only meaningful in flight, and silent
          on the ground where it sits at zero. */}
        <rect
          x={W - PAD + 2.5}
          y={PAD}
          width="2"
          height={H - PAD * 2}
          rx="1"
          className="fill-white/[0.07]"
        />
        <rect
          ref={altitude}
          x={W - PAD + 2.5}
          y={H - PAD}
          width="2"
          height="0"
          rx="1"
          className="fill-emerald-300/70"
        />
      </svg>

      <div className="px-3 pb-2 pt-1">
        <p className="truncate text-[0.68rem] text-white/55">
          Nearest: <span ref={nearest} className="text-white/80" />
        </p>
      </div>

      <dl className="space-y-1 border-t border-white/10 px-3 py-2.5 text-[0.6rem] leading-tight text-white/45">
        <Row keys="W / S" what="move · Shift to hurry" />
        <Row keys="A / D" what="turn" />
        <Row keys="Space" what="hold to fly" />
        <Row keys="Mouse" what="look around" />
        <Row keys="E" what="inspect · play guitar" />
      </dl>
    </div>
  );
}

function Row({ keys, what }: { keys: string; what: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="w-[3.1rem] shrink-0 font-medium text-white/70">{keys}</dt>
      <dd className="truncate">{what}</dd>
    </div>
  );
}
