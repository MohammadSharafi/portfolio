import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Raycaster, Vector3 } from 'three';
import { useEngine } from './store';
import { HOME_STOP, roomObjectById, type CameraStop } from '../data/objects';
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
  const focused = useEngine((state) => state.focused);
  const controlled = useEngine((state) => state.controlled);

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

  useEffect(() => {
    if (controlled && !focused) return;
    const stop: CameraStop = focused ? (roomObjectById.get(focused)?.stop ?? HOME_STOP) : HOME_STOP;
    goalPosition.current.set(...stop.position);
    goalTarget.current.set(...stop.target);
    // `duration` is authored per object as "how long this move should feel".
    // Converting it to a rate keeps the smoothing frame-rate independent while
    // still letting a lean-in be quicker than a trip across the room.
    rate.current = 3.2 / (stop.duration ?? 1.4);
  }, [focused, controlled]);

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
      const distance = BASE_DISTANCE + altitude * ALTITUDE_PULL;
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
      caster.current.set(pivot.current, toCamera.current);
      caster.current.far = distance;
      const hits = caster.current.intersectObjects(scene.children, true);
      if (hits.length > 0 && hits[0]!.distance < reach) {
        reach = Math.max(0.12, hits[0]!.distance - COLLISION_PAD);
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
