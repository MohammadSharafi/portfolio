import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useEngine } from './store';
import { HOME_STOP, roomObjectById, type CameraStop } from '../data/objects';
import { characterState } from './characterState';

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
 */
export function CameraRig({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera);
  const focused = useEngine((state) => state.focused);
  const controlled = useEngine((state) => state.controlled);

  const position = useRef(new Vector3(...HOME_STOP.position));
  const target = useRef(new Vector3(...HOME_STOP.target));
  const goalPosition = useRef(new Vector3(...HOME_STOP.position));
  const goalTarget = useRef(new Vector3(...HOME_STOP.target));
  const rate = useRef(2.2);
  const pointer = useRef({ x: 0, y: 0 });
  const drift = useRef({ x: 0, y: 0 });

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

    // Driving the robot retargets the rig rather than replacing it: the goal
    // becomes a shoulder position behind the machine, and the same easing
    // that flies the camera between stops carries it there and keeps it
    // glued. Focusing an object mid-walk hands the goal back to that
    // object's authored stop — one camera, never a cut in either direction.
    if (controlled && !focused) {
      const back = 0.42;
      const up = 0.24;
      goalPosition.current.set(
        characterState.position.x - Math.sin(characterState.heading) * back,
        characterState.position.y + up,
        characterState.position.z - Math.cos(characterState.heading) * back
      );
      goalTarget.current.set(
        characterState.position.x + Math.sin(characterState.heading) * 0.2,
        characterState.position.y + 0.09,
        characterState.position.z + Math.cos(characterState.heading) * 0.2
      );
      rate.current = 4.2;
    }

    const k = 1 - Math.exp(-rate.current * dt);

    position.current.lerp(goalPosition.current, k);
    target.current.lerp(goalTarget.current, k);

    if (!reducedMotion) {
      const driftK = 1 - Math.exp(-2 * dt);
      drift.current.x += (pointer.current.x - drift.current.x) * driftK;
      drift.current.y += (pointer.current.y - drift.current.y) * driftK;
    }

    // Parallax is scaled down while focused: at arm's length from a monitor the
    // same angular sway that reads as life across the room reads as a wobble.
    const sway = focused ? 0.05 : 0.28;
    camera.position.set(
      position.current.x + drift.current.x * sway,
      position.current.y - drift.current.y * sway * 0.6,
      position.current.z
    );
    camera.lookAt(target.current);
  });

  return null;
}
