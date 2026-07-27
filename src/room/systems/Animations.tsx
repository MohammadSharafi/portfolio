import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { useEngine } from '../engine/store';

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

  const parts = useMemo(() => {
    let lid: Object3D | null = null;
    const bulbs: MeshStandardMaterial[] = [];

    root.traverse((node) => {
      if (node.name.startsWith('ix_laptop_lid') && !lid) lid = node;
      if (node.name.startsWith('ix_lamp') && node instanceof Mesh) {
        const material = node.material;
        if (!Array.isArray(material) && material instanceof MeshStandardMaterial) {
          bulbs.push(material);
        }
      }
    });

    return { lid: lid as Object3D | null, bulbs, base: (lid as Object3D | null)?.rotation.x ?? 0 };
  }, [root]);

  const lidProgress = useRef(1);
  const glow = useRef(1);

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
    if (parts.lid) parts.lid.rotation.x = parts.base + lidProgress.current * LID_CLOSED;

    const lampTarget = lampOn ? 1 : 0;
    glow.current += (lampTarget - glow.current) * (1 - Math.exp(-6 * dt));
    for (const material of parts.bulbs) {
      material.emissiveIntensity = 0.05 + glow.current * 5.95;
    }
  });

  return null;
}
