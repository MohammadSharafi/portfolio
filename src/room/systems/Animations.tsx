import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * The room's moving parts.
 *
 * Everything here eases with the frame time folded in rather than a fixed
 * per-frame fraction, for the same reason the camera does: a fixed fraction
 * makes the lid shut twice as fast on a 120Hz display as on a 60Hz one, and the
 * two feel like different mechanisms.
 */

/**
 * How far the lid swings from its modelled position to shut.
 *
 * The model is authored open — that is the pose the room is usually seen in —
 * with the lid's origin moved onto the hinge line so it rotates about the hinge
 * rather than about its own centre, which would swing it through the desk.
 */
const LID_CLOSED = 1.42;

export function Animations({ root }: { root: Object3D }) {
  const focused = useEngine((state) => state.focused);
  const lampOn = useEngine((state) => state.lampOn);
  const reducedMotion = useReducedMotion();

  const parts = useMemo(() => {
    // Each part keeps its own resting rotation: the lid body sits at the hinge
    // tilt, the screen at that tilt plus the rotation that stands it upright.
    const lid: Array<{ node: Object3D; base: number }> = [];
    const bulbs: MeshStandardMaterial[] = [];
    let chair: { node: Object3D; base: number } | null = null;

    root.traverse((node) => {
      // First match only. The chair carries five materials, so glTF splits it
      // into a group of five primitives named `ix_chair`, `ix_chair_1`… and
      // traverse reaches the group first. Taking the last match would turn one
      // fifth of a chair and leave the rest behind.
      if (!chair && node.name.startsWith('ix_chair')) {
        chair = { node, base: node.rotation.y };
      }
      // The lid body and its screen are separate objects sharing the hinge as
      // their origin, so both turn.
      if (node.name.startsWith('ix_laptop_lid') || node.name.startsWith('ix_laptop_display')) {
        lid.push({ node, base: node.rotation.x });
      }
      if (node.name.startsWith('ix_lamp') && node instanceof Mesh) {
        const material = node.material;
        if (!Array.isArray(material) && material instanceof MeshStandardMaterial) {
          bulbs.push(material);
        }
      }
    });

    return { lid, bulbs, chair: chair as { node: Object3D; base: number } | null };
  }, [root]);

  const lidProgress = useRef(1);
  const glow = useRef(1);
  const elapsed = useRef(0);

  // The bulb should be lit on arrival if the lamp is on, not fade up from dark.
  useEffect(() => {
    glow.current = lampOn ? 1 : 0;
  }, [parts, lampOn]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);

    // Open only while the laptop is the subject. Leaving it open afterwards
    // would mean the room slowly accumulates the state of everywhere the
    // visitor has been, which reads as clutter rather than as memory.
    const target = focused === 'laptop' ? 0 : 1;
    lidProgress.current += (target - lidProgress.current) * (1 - Math.exp(-4.5 * dt));
    for (const part of parts.lid) {
      part.node.rotation.x = part.base + lidProgress.current * LID_CLOSED;
    }

    const lampTarget = lampOn ? 1 : 0;
    glow.current += (lampTarget - glow.current) * (1 - Math.exp(-6 * dt));
    for (const material of parts.bulbs) {
      material.emissiveIntensity = 0.05 + glow.current * 5.95;
    }

    // The chair drifts. Two sine waves whose periods do not divide into each
    // other, so it never visibly repeats — a single sine reads as a mechanism
    // swinging on a timer, which is worse than not moving at all. The amplitude
    // is about seven degrees: enough that the room is never quite still, small
    // enough that nobody catches it happening.
    //
    // Held still under reduced motion. The lid and the lamp above are responses
    // to something the visitor did; this is the room moving on its own, which is
    // the kind the preference is actually about.
    if (parts.chair && !reducedMotion) {
      elapsed.current += dt;
      const t = elapsed.current;
      const sway = Math.sin(t * 0.31) * 0.085 + Math.sin(t * 0.73 + 1.4) * 0.038;
      parts.chair.node.rotation.y = parts.chair.base + sway;
    }
  });

  return null;
}
