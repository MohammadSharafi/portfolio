import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Mesh, Raycaster, Vector3, type BufferGeometry, type Object3D } from 'three';
import { useEngine } from './store';
import {
  HOME_DURATION,
  HOME_STOP,
  resolveHome,
  resolveStops,
  roomObjectById,
} from '../data/objects';
import { characterState } from './characterState';
import { look, updateLook } from './lookControl';

/**
 * Camera manager.
 *
 * There is exactly one rule: the camera never teleports. Every change of
 * subject is a dolly from wherever it currently is to wherever it is going, so
 * the visitor keeps their bearings in a room they are only ever shown a piece
 * of at a time.
 *
 * The easing is exponential smoothing with the frame time folded in, not a
 * fixed per-frame fraction. A fixed fraction converges twice as fast on a 120Hz
 * display as on a 60Hz one, which makes the same move feel like two different
 * moves depending on the machine.
 *
 * Three modes share that one rule: the authored stops, the free-look orbit
 * while driving the robot, and the transitions between them. The orbit is a
 * true spherical rig about a pivot at the robot's head — not a lean, not a
 * head-follow — which is what lets the view crane up past the monitors to the
 * shelves and the whiteboard from 12 cm off the floor.
 */

/** How far behind the head the camera sits, and how that grows with altitude
 * so a flight reads as gaining height over a room. */
const BASE_DISTANCE = 0.42;
const ALTITUDE_PULL = 0.3;
/** The pivot: the robot's head, not its feet. Orbiting the feet swings the
 * whole body through frame every time the view pitches. */
const PIVOT_HEIGHT = 0.1;
/** How far past the pivot the look point is thrown. */
const LOOK_AHEAD = 0.55;
/** Kept clear of whatever the collision ray hits, so the near plane never
 * grazes the surface it stopped against. */
const COLLISION_PAD = 0.035;

export function CameraRig({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const focused = useEngine((state) => state.focused);
  const controlled = useEngine((state) => state.controlled);

  // Stops are solved from each object's measured box against the *live* aspect
  // ratio, so the same registry frames correctly on a desktop monitor and on a
  // phone held upright. Rounded before it becomes a dependency: a resize drags
  // through hundreds of intermediate widths, and re-solving fifteen boxes on
  // every one of them would be work nobody sees.
  const aspect = Math.round((size.width / Math.max(1, size.height)) * 20) / 20;
  const stops = useMemo(() => resolveStops(aspect), [aspect]);
  const home = useMemo(() => resolveHome(aspect), [aspect]);

  /**
   * How much further back the follow camera sits on a narrow screen.
   *
   * The orbit distance was chosen against a wide viewport, and the vertical
   * field of view is fixed — so the horizontal one collapses with the aspect
   * ratio, and on a phone held upright the same 42 cm behind the robot shows a
   * quarter of the width it shows on a monitor. The chair fills the frame and
   * the room disappears behind it.
   *
   * Widening the lens instead would be the wrong fix: the field of view is
   * shared with every authored stop in the room, and opening it up would
   * distort all of them to solve a problem that belongs to one. Backing off
   * costs nothing but a little distance.
   */
  const reachScale = Math.min(1.85, Math.max(1, 1.55 / Math.max(0.4, aspect)));

  const position = useRef(new Vector3(...HOME_STOP.position));
  const target = useRef(new Vector3(...HOME_STOP.target));
  const goalPosition = useRef(new Vector3(...HOME_STOP.position));
  const goalTarget = useRef(new Vector3(...HOME_STOP.target));
  const rate = useRef(2.2);
  const pointer = useRef({ x: 0, y: 0 });
  const drift = useRef({ x: 0, y: 0 });

  const pivot = useRef(new Vector3());
  const lookDir = useRef(new Vector3());
  const toCamera = useRef(new Vector3());
  const caster = useRef(new Raycaster());
  const blockerCache = useRef<Object3D[]>([]);

  /**
   * What the camera can actually be stopped by.
   *
   * Rebuilt when the visitor takes control rather than every frame, and
   * filtered by size: a ray looking for something to duck behind does not need
   * to consider the pencil, the keycaps, or the forty-odd book spines on the
   * shelf. Anything under 12 cm on its longest side is skipped, which removes
   * most of the room's mesh count and none of its walls.
   *
   * Objects that opt out of raycasting keep their exemption — the robot's own
   * body sets `raycast` to a no-op so the camera cannot jam against the thing
   * it is following.
   */
  useEffect(() => {
    if (!controlled) {
      blockerCache.current = [];
      return;
    }
    const found: Object3D[] = [];
    const size = new Vector3();
    scene.traverse((node) => {
      const mesh = node as Object3D & { isMesh?: boolean; geometry?: BufferGeometry };
      if (!mesh.isMesh || !mesh.geometry) return;
      // Anything that has replaced the default raycast has opted out of being
      // hit — the robot's own meshes do exactly this so the camera cannot jam
      // against the thing it is following. Comparing against the prototype is
      // how that opt-out is detected without the two files sharing a sentinel.
      if (node.raycast !== Mesh.prototype.raycast) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox?.getSize(size);
      // World scale is 1 throughout this model, so local extents are metres.
      if (Math.max(size.x, size.y, size.z) < 0.12) return;
      found.push(node);
    });
    blockerCache.current = found;
  }, [controlled, scene]);

  useEffect(() => {
    if (controlled && !focused) return;
    const object = focused ? roomObjectById.get(focused) : undefined;
    const stop = (focused && stops.get(focused)) || home;
    goalPosition.current.set(...stop.position);
    goalTarget.current.set(...stop.target);
    // `duration` is authored per object as "how long this move should feel".
    // Converting it to a rate keeps the smoothing frame-rate independent while
    // still letting a lean-in be quicker than a trip across the room.
    rate.current = 3.2 / (object?.duration ?? HOME_DURATION);
  }, [focused, controlled, stops, home]);

  useEffect(() => {
    if (reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reducedMotion]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);

    // The view angles advance once per frame, here, before anything reads
    // them — so the camera and the robot's neck are always working from the
    // same numbers on the same frame.
    updateLook(dt);

    if (controlled && !focused) {
      // --- the free-look orbit ---------------------------------------------
      // Spherical about the head. Yaw is relative to the body, so turning
      // with A and D carries the view round with it; pitch belongs entirely
      // to the player, which is the point — the camera is not limited to
      // what a neck can do.
      const altitude = MathUtils.clamp((characterState.position.y - 0.02) / 1.6, 0, 1);
      const distance = (BASE_DISTANCE + altitude * ALTITUDE_PULL) * reachScale;
      const azimuth = characterState.heading + look.yaw;

      pivot.current.set(
        characterState.position.x,
        characterState.position.y + PIVOT_HEIGHT,
        characterState.position.z
      );
      // The unit vector the player is looking along, built from angles
      // rather than from an accumulated quaternion: there is no orientation
      // state to drift, and no axis to align and lock.
      lookDir.current.set(
        Math.sin(azimuth) * Math.cos(look.pitch),
        Math.sin(look.pitch),
        Math.cos(azimuth) * Math.cos(look.pitch)
      );

      // The camera sits back along that same line, so looking up swings it
      // down and behind — you see over the monitor rather than into it.
      toCamera.current.copy(lookDir.current).multiplyScalar(-1);
      let reach = distance;

      // --- collision --------------------------------------------------------
      // One ray from the head out to where the camera wants to be. Anything
      // in the way pulls it in rather than letting it pass through — the
      // desk, a monitor's back, a wall, the shelf it just flew into. The
      // robot is excluded because its own meshes have raycasting disabled.
      //
      // Cast against a pre-flattened list rather than `scene.children, true`.
      // The recursive form re-walks the entire graph every frame — 250-odd
      // nodes, sixty times a second, allocating as it goes — to test a ray
      // that can only ever be stopped by something big. `blockers` is that
      // list, gathered once and filtered to objects with real bulk, which is
      // the difference between a frame budget spent on the room and one spent
      // on rediscovering where the room is.
      const blockers = blockerCache.current;
      if (blockers.length > 0) {
        caster.current.set(pivot.current, toCamera.current);
        caster.current.far = distance;
        const hits = caster.current.intersectObjects(blockers, false);
        if (hits.length > 0 && hits[0]!.distance < reach) {
          reach = Math.max(0.12, hits[0]!.distance - COLLISION_PAD);
        }
      }

      goalPosition.current.copy(pivot.current).addScaledVector(toCamera.current, reach);
      // Never through the boards, whatever the pitch asks for.
      goalPosition.current.y = Math.max(0.035, goalPosition.current.y);
      goalTarget.current.copy(pivot.current).addScaledVector(lookDir.current, LOOK_AHEAD);
      // Fast enough to feel wired to the mouse, slow enough that the
      // collision pull-in reads as the camera ducking rather than snapping.
      rate.current = 9;
    }

    const k = 1 - Math.exp(-rate.current * dt);
    position.current.lerp(goalPosition.current, k);
    target.current.lerp(goalTarget.current, k);

    if (!reducedMotion) {
      const driftK = 1 - Math.exp(-2 * dt);
      drift.current.x += (pointer.current.x - drift.current.x) * driftK;
      drift.current.y += (pointer.current.y - drift.current.y) * driftK;
    }

    // Parallax belongs to the authored stops only. Under free look the
    // pointer already steers the whole rig, and sway on top of it would
    // fight the player's own hand.
    // Parallax is scaled down while focused: at arm's length from a monitor the
    // same angular sway that reads as life across the room reads as a wobble.
    const sway = controlled && !focused ? 0 : focused ? 0.05 : 0.28;
    camera.position.set(
      position.current.x + drift.current.x * sway,
      position.current.y - drift.current.y * sway * 0.6,
      position.current.z
    );
    camera.lookAt(target.current);
  });

  return null;
}
