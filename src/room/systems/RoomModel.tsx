import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type { MeshStandardMaterial } from 'three';
import { Color, MeshBasicMaterial, Mesh, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { type ObjectId } from '../data/objects';
import { roomAudio } from '../engine/audio';
import { toObjectId } from './objectId';

/**
 * Lightmapped materials that are light sources rather than lit surfaces — the
 * LED strips, the lamp bulb, the monitor power LEDs.
 *
 * The lightmap is display-referred: it was tone-mapped down into 0..1 so it
 * could be a PNG, so each of these arrives at approximately white,
 * indistinguishable from a sheet of paper. That is correct for the *wash* they
 * throw, which is baked into the surfaces around them, but it leaves the
 * sources themselves flat.
 *
 * Bloom needs something above white to work from, so these get their radiance
 * put back on the way in. Everything else stays at 1.0 and the bake speaks for
 * itself.
 *
 * `beacon` and `sky_lit` are the skyline's, and reach the second branch of
 * `bakedColor` instead — they are excluded from the atlas, so they arrive
 * carrying real emission and need no help. They are matched here so that
 * putting the skyline back into the bake would not silently un-glow it.
 */
const GLOWING = /^(bulb|beacon|led_|monitor_led|sky_lit)/;

/**
 * How far above white a source is drawn.
 *
 * Paired with the bloom threshold in `RoomExperience`: that sits just above 1.0
 * so nothing in the tone-mapped bake can reach it, which makes this the only
 * thing in the room that blooms. Raising one without the other either drowns
 * the room in haze or turns the bloom off entirely.
 */
const GLOW_GAIN = 2.6;

/**
 * The colour a baked mesh is drawn with.
 *
 * Three cases, in order of how much the bake knows about the surface:
 *
 * 1. It carries the atlas, so the atlas *is* the answer and the tint only has
 *    to decide whether this is a light source or a lit surface.
 * 2. It has no atlas but does emit — the skyline outside the window, which is
 *    excluded from the lightmap because there is no incident light on it to
 *    resolve. Its emission is the whole of its appearance, and dropping it (as
 *    reading `color` alone would) turns Toronto at night into a flat navy
 *    rectangle with the lit windows painted out.
 * 3. Neither: flat albedo, which is all there is to go on.
 */
function bakedColor(source: MeshStandardMaterial): Color {
  if (source.map) {
    const glow = GLOWING.test(source.name) ? GLOW_GAIN : 1;
    return new Color(glow, glow, glow);
  }

  const emissive = source.emissive;
  if (emissive && (emissive.r > 0 || emissive.g > 0 || emissive.b > 0)) {
    // `emissiveIntensity` carries KHR_materials_emissive_strength, which is how
    // an emission above 1.0 survives glTF at all — the base factor alone is
    // clamped to unity, and reading it without the strength is what made every
    // bright source in the room ship as the same washed-out pastel.
    return emissive.clone().multiplyScalar(Math.max(1, source.emissiveIntensity));
  }

  return source.color.clone();
}

export function RoomModel({
  url,
  baked,
  onReady,
}: {
  url: string;
  baked: boolean;
  onReady?: (root: Object3D) => void;
}) {
  const { scene } = useGLTF(url);
  const hover = useEngine((state) => state.hover);
  const focus = useEngine((state) => state.focus);
  const toggleLamp = useEngine((state) => state.toggleLamp);
  const discover = useEngine((state) => state.discover);

  const prepared = useMemo(() => {
    const root = scene.clone(true);

    root.traverse((node: Object3D) => {
      if (!(node instanceof Mesh)) return;

      node.castShadow = !baked;
      node.receiveShadow = !baked;

      if (baked) {
        // The lighting is already in the texture. Drawing it through a lit
        // material would apply a second lighting pass on top of one that is
        // finished, which is both wrong and far more expensive.
        const source = node.material as MeshStandardMaterial;
        node.material = new MeshBasicMaterial({
          map: source.map,
          color: bakedColor(source),
          toneMapped: false,
        });
        source.dispose();
      }

      const id = toObjectId(node.name);
      if (id) node.userData.objectId = id;
    });

    return root;
  }, [scene, baked]);

  useEffect(() => {
    onReady?.(prepared);
    // Intentionally not depending on `onReady`: it is a setState from the
    // scene, and re-running this on every parent render would thrash it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  useEffect(() => {
    return () => {
      prepared.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        node.geometry.dispose();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      });
    };
  }, [prepared]);

  return (
    <primitive
      object={prepared}
      onPointerOver={(event: { stopPropagation(): void; object: Object3D }) => {
        const id = event.object.userData.objectId as ObjectId | undefined;
        if (!id) return;
        event.stopPropagation();
        hover(id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        hover(null);
        document.body.style.cursor = '';
      }}
      onClick={(event: { stopPropagation(): void; object: Object3D }) => {
        const id = event.object.userData.objectId as ObjectId | undefined;
        if (!id) return;
        event.stopPropagation();
        // The lamp is a switch, not a subject. Pushing the camera in on it to
        // explain that it can be switched, instead of just switching it, would
        // be the least satisfying possible response to clicking a light.
        if (id === 'lamp') {
          roomAudio.play('switch');
          toggleLamp();
          discover(id);
          return;
        }
        roomAudio.play(id === 'laptop' ? 'lid' : 'open');
        focus(id);
      }}
    />
  );
}

// Deliberately no `useGLTF.preload` here.
//
// Preloading the lit room unconditionally fetched 3.4 MB that a baked build
// never uses — the asset manager resolves to `room-baked.glb` instead, and both
// models ended up on the wire. What the preload bought was a head start of one
// HEAD request and a small JSON, which is not worth a second copy of the room.
