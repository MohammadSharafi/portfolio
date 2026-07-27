import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type { MeshStandardMaterial } from 'three';
import { MeshBasicMaterial, Mesh, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { objectIds, type ObjectId } from '../data/objects';

/** Blender tags interactive objects with this prefix; the ids follow it. */
const PREFIX = 'ix_';

/**
 * Maps a mesh name from the GLB back to a registry id.
 *
 * glTF splits a multi-material mesh into one node per material and suffixes the
 * names (`ix_keyboard_1`, `ix_keyboard_2`), so the match is by prefix rather
 * than equality — otherwise every object built from more than one material
 * would silently stop being interactive.
 */
function toObjectId(name: string): ObjectId | null {
  if (!name.startsWith(PREFIX)) return null;
  const stem = name.slice(PREFIX.length).replace(/_\d+$/, '').replace(/_/g, '-');
  return (objectIds as readonly string[]).includes(stem) ? (stem as ObjectId) : null;
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
          color: source.map ? 0xffffff : source.color,
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
          toggleLamp();
          discover(id);
          return;
        }
        focus(id);
      }}
    />
  );
}

useGLTF.preload('/models/room.glb');
