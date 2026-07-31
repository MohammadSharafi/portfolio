import { objectBounds, type ObjectBounds } from './objectBounds';

/**
 * Where the camera has to stand to actually frame a thing.
 *
 * The room's camera stops were fifteen hand-authored pairs of vectors, and
 * hand-authored numbers rot silently. An object shifts two centimetres in
 * `build_room.py`, nobody re-aims the stop, and what the visitor gets is a shot
 * that looks like it was always composed a little carelessly. Measuring found
 * worse than drift: the notebook's target sat 70 cm to its left, the laptop's
 * 23 cm past its edge, the sticky notes' 28 cm below theirs. Those were not
 * near misses. The camera was looking at the desk beside the subject.
 *
 * So a stop is no longer a position. It is a *direction to look from* and a
 * margin, and the distance is solved from the object's real size and the
 * camera's real field of view. Move the object and the shot follows it; change
 * the lens and every shot re-solves.
 *
 * The solve is done per aspect ratio, which is the other half of the problem.
 * A stop composed on a desktop monitor and shipped to a phone is not the same
 * shot: the vertical field of view is fixed and the horizontal one collapses
 * with the viewport, so a wide subject like the whiteboard runs off both sides
 * of a portrait screen. Fitting horizontally *and* vertically, and taking
 * whichever needs more room, is what makes one set of stops correct on both.
 */

export type Vec3 = readonly [number, number, number];

export interface Framing {
  /** Which way the camera sits from the subject. Normalised on use, so these
   *  can be written as readable whole numbers. */
  from: Vec3;
  /** Multiplies the solved distance. 1 fits the subject edge to edge; above
   *  that leaves air around it. Below 1 crops in deliberately. */
  margin?: number;
  /** Nudges the look point off the box's centre, in metres. For objects whose
   *  interesting part is not their middle — a monitor's screen sits above the
   *  centre of a box that includes its stand. */
  offset?: Vec3;
  /** Overrides the measured box. Only for objects whose mesh is not the thing
   *  being looked at; see `window` in `objects.ts`. */
  bounds?: ObjectBounds;
  /** Never come closer than this, whatever the solve says. Stops a tiny
   *  subject from putting the near plane inside the desk. */
  minDistance?: number;
}

export interface ResolvedStop {
  position: Vec3;
  target: Vec3;
}

/** The canvas's vertical field of view, in degrees — must match the Canvas. */
export const FOV = 34;

const RAD = Math.PI / 180;

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The subject's half-extent along an axis.
 *
 * A box projected onto an arbitrary direction is the sum of its half-sizes
 * times the absolute components of that direction — the support function of a
 * box. Using the size along world axes instead would under-measure every
 * subject seen from an angle, which is most of them.
 */
function halfExtent(size: Vec3, axis: Vec3): number {
  return (
    (size[0] * Math.abs(axis[0]) + size[1] * Math.abs(axis[1]) + size[2] * Math.abs(axis[2])) / 2
  );
}

/**
 * Solves a stop for one subject at one aspect ratio.
 *
 * `aspect` is width / height. Guarded because a zero-height canvas during
 * layout would otherwise divide the distance to infinity and throw the camera
 * out of the building.
 */
export function resolveFraming(
  framing: Framing,
  bounds: ObjectBounds,
  aspect: number
): ResolvedStop {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1.6;
  const dir = normalise(framing.from);
  const size = bounds.size as Vec3;

  // A view basis about the look direction. `up` is world up unless we are
  // looking very nearly straight down it, in which case any perpendicular will
  // do — without this the cross product collapses and the basis is garbage.
  const worldUp: Vec3 = Math.abs(dir[1]) > 0.985 ? [0, 0, 1] : [0, 1, 0];
  const right = normalise(cross(dir, worldUp));
  const up = normalise(cross(right, dir));

  const halfV = Math.tan((FOV * RAD) / 2);
  const halfH = halfV * safeAspect;

  // The panel that opens over the subject takes a real bite out of the frame:
  // roughly the right third on a wide viewport, the bottom third on a narrow
  // one. Centring the subject anyway is what put the notebook and the mug
  // *behind* their own description. So the shot is composed off-centre by the
  // width of the panel, and the subject has to fit in what is left — which is
  // why the fit is divided by the remaining fraction rather than merely
  // shifted afterwards. Shifting alone would have pushed big subjects like the
  // whiteboard half out of frame.
  const wide = safeAspect >= 1;
  const bias = wide ? PANEL_BIAS.wide : PANEL_BIAS.narrow;
  const usable = 1 - bias;

  // How far back the subject has to sit to fit each way, plus its own depth so
  // the *near* face is framed rather than its centre — for a deep subject like
  // the server rack those differ by a third of a metre.
  const fitV = halfExtent(size, up) / halfV / (wide ? 1 : usable);
  const fitH = halfExtent(size, right) / halfH / (wide ? usable : 1);
  const depth = halfExtent(size, dir);

  const distance = Math.max(
    (Math.max(fitV, fitH) + depth * 0.35) * (framing.margin ?? 1),
    framing.minDistance ?? 0.18
  );

  const offset = framing.offset ?? ([0, 0, 0] as Vec3);
  const centre: Vec3 = [
    bounds.center[0] + offset[0],
    bounds.center[1] + offset[1],
    bounds.center[2] + offset[2],
  ];

  // Slide the whole shot — camera and look point together — so the subject
  // lands clear of the panel. Moving only the look point would swing the
  // camera and re-centre the subject, which is the trap here: `lookAt` aims at
  // whatever it is given, so an off-centre subject has to come from an
  // off-centre *frame*, not an off-centre target.
  const shift = wide ? distance * halfH * bias : -distance * halfV * bias;
  const along = wide ? right : up;

  const target: Vec3 = [
    centre[0] + along[0] * shift,
    centre[1] + along[1] * shift,
    centre[2] + along[2] * shift,
  ];

  return {
    target,
    position: [
      target[0] + dir[0] * distance,
      target[1] + dir[1] * distance,
      target[2] + dir[2] * distance,
    ],
  };
}

/**
 * How much of the frame the open panel occupies, as a fraction of half-extent.
 *
 * Two numbers, because the panel is two different shapes. On a wide viewport it
 * is `max-w-md` (28rem) pinned 2rem from the right and vertically centred —
 * about a third of the width, so roughly a quarter of half-width once the gap
 * is allowed for. On a narrow one it switches to `inset-x-4 bottom-6` and grows
 * to fit its content, and a panel with five bullet points in it covers *over
 * half* the height of a 375×812 phone.
 *
 * Using the wide number on a phone was measurably wrong rather than merely
 * imprecise: the subject was composed 26% up the frame and the panel covered
 * the bottom 53%, so the thing being described sat behind its own description.
 * These are read off the rendered layout, not estimated.
 */
const PANEL_BIAS = { wide: 0.26, narrow: 0.48 };

/**
 * Whether a subject is wholly inside the frame from a solved stop.
 *
 * The point of the exercise, stated as something checkable: every corner of
 * the subject's box, projected into the camera's view, has to land inside the
 * frustum. "The target is near the object" was the old standard and it is too
 * weak — a camera can be aimed straight at a whiteboard and still cut a third
 * of it off the side.
 */
export function framesSubject(framing: Framing, bounds: ObjectBounds, aspect: number): boolean {
  const { position, target } = resolveFraming(framing, bounds, aspect);
  const forward = normalise([
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ]);
  const worldUp: Vec3 = Math.abs(forward[1]) > 0.985 ? [0, 0, 1] : [0, 1, 0];
  const right = normalise(cross(forward, worldUp));
  const up = normalise(cross(right, forward));

  const halfV = Math.tan((FOV * RAD) / 2);
  const halfH = halfV * aspect;

  for (const cx of [bounds.min[0], bounds.max[0]]) {
    for (const cy of [bounds.min[1], bounds.max[1]]) {
      for (const cz of [bounds.min[2], bounds.max[2]]) {
        const dx = cx - position[0];
        const dy = cy - position[1];
        const dz = cz - position[2];
        const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
        // Behind the camera, or inside the near plane.
        if (depth <= 0.05) return false;
        const h = dx * right[0] + dy * right[1] + dz * right[2];
        const v = dx * up[0] + dy * up[1] + dz * up[2];
        if (Math.abs(h) > halfH * depth || Math.abs(v) > halfV * depth) return false;
      }
    }
  }
  return true;
}

/** The measured box for an id, or the framing's override where the mesh is not
 *  the subject. */
export function boundsFor(id: string, framing: Framing): ObjectBounds {
  if (framing.bounds) return framing.bounds;
  const measured = (objectBounds as Record<string, ObjectBounds | undefined>)[id];
  if (measured) return measured;
  // Not in the GLB. Better to frame the middle of the room than to throw and
  // take the whole canvas down with it.
  return { min: [-0.2, 0.8, -0.2], max: [0.2, 1.2, 0.2], center: [0, 1, 0], size: [0.4, 0.4, 0.4] };
}
