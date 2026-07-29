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
 *
 * The chair is deliberately not here. It used to drift and could be shoved into
 * a spin; both are on hold until the room's design is settled, and until then a
 * chair that is simply well placed and well made is worth more than one that
 * moves.
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
    // Each part keeps its own resting rotation: the lid body sits at the hinge
    // tilt, the screen at that tilt plus the rotation that stands it upright.
    const lid: Array<{ node: Object3D; base: number }> = [];
    const bulbs: MeshStandardMaterial[] = [];
    // The steam wisps, each with the pose it was modelled in, so the drift is
    // applied *around* that rather than replacing it.
    const steam: Array<{ node: Object3D; y: number; scale: number; phase: number }> = [];

    root.traverse((node) => {
      // The lid body and its screen are separate objects sharing the hinge as
      // their origin, so both turn.
      if (node.name.startsWith('ix_laptop_lid') || node.name.startsWith('ix_laptop_display')) {
        lid.push({ node, base: node.rotation.x });
      }
      if (node.name.startsWith('steam_')) {
        // The phase is derived from the wisp's index rather than random, so the
        // three never rise in step and the room rebuilds identically every time.
        const index = Number(node.name.split('_')[1] ?? 0);
        steam.push({ node, y: node.position.y, scale: node.scale.y, phase: index * 2.1 });
      }
      if (node.name.startsWith('ix_lamp') && node instanceof Mesh) {
        const material = node.material;
        if (!Array.isArray(material) && material instanceof MeshStandardMaterial) {
          bulbs.push(material);
        }
      }
    });

    return { lid, bulbs, steam };
  }, [root]);

  // The lid rests open, which is how the model is authored.
  //
  // It used to rest shut and open only while the laptop was the subject. That
  // read well in close-up and badly everywhere else: from across the room a
  // closed laptop is a dark slab lying between two lit monitors, and it looked
  // less like a laptop than like something broken. A desk someone works at has
  // its laptop open.
  const lidProgress = useRef(0);
  const glow = useRef(1);
  const clock = useRef(0);

  // The bulb should be lit on arrival if the lamp is on, not fade up from dark.
  useEffect(() => {
    glow.current = lampOn ? 1 : 0;
  }, [parts, lampOn]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);

    // The lid only shuts while the visitor is looking at something across the
    // room, and even then only part way — enough that the room has a moving
    // part, not so much that the screen ever reads as dead.
    const target = focused === null || focused === 'laptop' ? 0 : 0.22;
    lidProgress.current += (target - lidProgress.current) * (1 - Math.exp(-4.5 * dt));
    for (const part of parts.lid) {
      part.node.rotation.x = part.base + lidProgress.current * LID_CLOSED;
    }

    // Steam, which has to move or it is a sculpture of steam.
    //
    // Three things at once, because any one of them alone reads as a trick: it
    // rises and fades as it goes, it sways, and each wisp is on its own clock.
    // The rise is a sawtooth — a wisp climbs, thins out and is replaced from
    // the cup — which is the cycle real steam has and the reason a smooth loop
    // never convinces.
    clock.current += dt;
    for (const wisp of parts.steam) {
      const t = (clock.current * 0.34 + wisp.phase) % 1;
      wisp.node.position.y = wisp.y + t * 0.055;
      // Thin as it climbs, and gone before it restarts, so the loop point is
      // never a moment where a shape blinks out.
      wisp.node.scale.setScalar(1);
      wisp.node.scale.y = wisp.scale * (0.55 + t * 0.9);
      const fade = Math.sin(Math.PI * Math.min(1, t * 1.05));
      wisp.node.scale.x = wisp.node.scale.z = 0.4 + fade * 0.85;
      wisp.node.rotation.y = Math.sin(clock.current * 0.6 + wisp.phase) * 0.22;
    }

    const lampTarget = lampOn ? 1 : 0;
    glow.current += (lampTarget - glow.current) * (1 - Math.exp(-6 * dt));
    for (const material of parts.bulbs) {
      material.emissiveIntensity = 0.05 + glow.current * 5.95;
    }
  });

  return null;
}
