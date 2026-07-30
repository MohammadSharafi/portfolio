import { useEffect, useRef } from 'react';
import { characterState } from '../engine/characterState';

/**
 * The room from above, and how to drive it.
 *
 * A plan drawn from the same coordinates the collision system uses, so it
 * cannot disagree with the room it describes — every rectangle here is a
 * footprint the robot will actually be stopped by. It exists because the
 * follow camera is a good storyteller and a poor navigator: from 12 cm off
 * the boards, behind a machine the height of a coffee cup, a visitor has no
 * idea the guitar is behind them and the shelves are a room away.
 *
 * The marker is written straight into the DOM on an animation frame rather
 * than through React state. A position that changes sixty times a second has
 * no business re-rendering a component tree, and the whole panel is static
 * apart from two attributes.
 */

/** The floor, in world metres — the same bounds the character clamps to. */
const ROOM = { minX: -3.12, maxX: 3.0, minZ: -2.3, maxZ: 2.48 };

/** Drawing box, in SVG units. */
const W = 148;
const H = 128;
const PAD = 7;

const spanX = ROOM.maxX - ROOM.minX;
const spanZ = ROOM.maxZ - ROOM.minZ;

/** World x to plan x. */
const px = (x: number) => PAD + ((x - ROOM.minX) / spanX) * (W - PAD * 2);
/** World z to plan y — flipped, so the desk wall sits at the top of the map
 * the way it sits at the back of the room. */
const py = (z: number) => PAD + ((ROOM.maxZ - z) / spanZ) * (H - PAD * 2);

/** Footprints, straight from the character's collision boxes. */
const FURNITURE: Array<{ x0: number; z0: number; x1: number; z1: number; label?: string }> = [
  { x0: -1.1, z0: 1.78, x1: 1.1, z1: 2.48, label: 'desk' },
  { x0: -0.88, z0: -2.1, x1: 1.28, z1: -1.3, label: 'sofa' },
  { x0: -0.32, z0: -0.78, x1: 0.82, z1: -0.22 },
  { x0: -2.7, z0: 1.5, x1: -2.16, z1: 2.44 },
  { x0: -3.12, z0: -0.1, x1: -2.86, z1: 1.9, label: 'shelf' },
];

/** Round things: pedestals, pots, the chair's star base. */
const POSTS: Array<{ x: number; z: number; r: number }> = [
  { x: -1.22, z: -1.85, r: 0.17 },
  { x: 1.62, z: -0.55, r: 0.2 },
  { x: 2.78, z: -0.35, r: 0.2 },
  { x: 1.34, z: 1.92, r: 0.16 },
  { x: 0.45, z: 0.81, r: 0.28 },
];

/** Places worth walking to, and the one that plays music. */
const MARKS: Array<{ x: number; z: number; label: string; accent?: boolean }> = [
  { x: 2.95, z: -0.6, label: 'guitar', accent: true },
  { x: 2.05, z: 2.44, label: 'window' },
  { x: -3.1, z: 1.35, label: 'board' },
  { x: -2.6, z: 2.5, label: 'door' },
];

export function Minimap() {
  const marker = useRef<SVGGElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const node = marker.current;
      if (node) {
        // The robot faces (sin h, cos h) in world x/z. The plan flips z, so
        // that direction lands on screen as (sin h, −cos h) — which is an
        // up-pointing arrow rotated clockwise by exactly h.
        node.setAttribute(
          'transform',
          `translate(${px(characterState.position.x).toFixed(2)} ${py(
            characterState.position.z
          ).toFixed(2)}) rotate(${((characterState.heading * 180) / Math.PI).toFixed(1)})`
        );
        // Airborne reads as a wider halo: the one piece of state the plan
        // cannot show by position alone.
        node.setAttribute('data-air', characterState.airborne ? '1' : '0');
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="pointer-events-none absolute right-4 top-16 w-[172px] rounded-2xl border border-white/10 bg-black/60 p-3 backdrop-blur-md">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Plan of the room">
        {/* The floor, and the two walls the room is built against. */}
        <rect
          x={PAD}
          y={PAD}
          width={W - PAD * 2}
          height={H - PAD * 2}
          rx="3"
          className="fill-white/[0.03]"
        />
        <path
          d={`M ${PAD} ${PAD} H ${W - PAD} M ${PAD} ${PAD} V ${H - PAD}`}
          className="stroke-white/25"
          strokeWidth="1.5"
          fill="none"
        />

        {FURNITURE.map((box, i) => (
          <rect
            key={i}
            x={px(box.x0)}
            y={py(box.z1)}
            width={px(box.x1) - px(box.x0)}
            height={py(box.z0) - py(box.z1)}
            rx="1.5"
            className="fill-white/[0.07] stroke-white/20"
            strokeWidth="0.6"
          />
        ))}

        {POSTS.map((post, i) => (
          <circle
            key={i}
            cx={px(post.x)}
            cy={py(post.z)}
            r={Math.max(1.6, (post.r / spanX) * (W - PAD * 2))}
            className="fill-white/10 stroke-white/20"
            strokeWidth="0.5"
          />
        ))}

        {MARKS.map((mark) => (
          <g key={mark.label}>
            <circle
              cx={px(mark.x)}
              cy={py(mark.z)}
              r="2.2"
              className={mark.accent ? 'fill-emerald-300' : 'fill-white/45'}
            />
            <text
              x={px(mark.x)}
              y={py(mark.z) - 4.5}
              textAnchor="middle"
              className={mark.accent ? 'fill-emerald-200/90' : 'fill-white/40'}
              style={{ fontSize: '6px', letterSpacing: '0.04em' }}
            >
              {mark.label}
            </text>
          </g>
        ))}

        {/* The robot: a wedge that points where it faces. */}
        <g ref={marker}>
          <circle r="6" className="fill-emerald-300/15" />
          <path d="M 0 -5 L 3.4 3.6 L 0 1.9 L -3.4 3.6 Z" className="fill-emerald-300" />
        </g>
      </svg>

      <dl className="mt-2.5 space-y-1 text-[0.6rem] leading-tight text-white/45">
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
