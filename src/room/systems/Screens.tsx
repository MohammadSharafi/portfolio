import { useEffect, useMemo } from 'react';
import { Mesh, MeshBasicMaterial, type Object3D, type Texture } from 'three';
import {
  clinicalScreen,
  codeScreen,
  stickyTexture,
  terminalScreen,
  whiteboardTexture,
} from './screens';

/**
 * Paints the room's readable surfaces.
 *
 * The Blender model ships every screen, the whiteboard and the notes as flat
 * coloured plates — placeholders that were never meant to be the finished
 * thing. This walks the loaded scene once and swaps each of them for a canvas
 * texture carrying real content.
 *
 * `MeshBasicMaterial` throughout: these are emitting surfaces, and lighting a
 * monitor would darken it in exactly the places a monitor is brightest. It also
 * keeps them legible whether the room is baked or lit in real time.
 */
const TARGETS: Record<string, () => Texture> = {
  ix_monitor_health_display: clinicalScreen,
  ix_monitor_code_display: codeScreen,
  ix_laptop_display: terminalScreen,
  ix_whiteboard_face: whiteboardTexture,
  ix_sticky_notes: stickyTexture,
};

/** Screens read as light sources; paper does not. */
const EMISSIVE = new Set([
  'ix_monitor_health_display',
  'ix_monitor_code_display',
  'ix_laptop_display',
]);

function baseName(name: string) {
  return name.replace(/_\d+$/, '');
}

export function Screens({ root }: { root: Object3D }) {
  const textures = useMemo(() => {
    const made = new Map<string, Texture>();
    for (const [name, make] of Object.entries(TARGETS)) {
      try {
        made.set(name, make());
      } catch {
        // A canvas that fails to draw should cost one blank surface, not the
        // whole room.
      }
    }
    return made;
  }, []);

  useEffect(() => {
    const replaced: Mesh[] = [];

    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const key = baseName(node.name);
      const texture = textures.get(key);
      if (!texture) return;

      const previous = node.material;
      node.material = new MeshBasicMaterial({
        map: texture,
        toneMapped: !EMISSIVE.has(key),
        transparent: false,
      });
      if (!Array.isArray(previous)) previous.dispose();
      replaced.push(node);
    });

    return () => {
      for (const mesh of replaced) {
        const material = mesh.material;
        if (!Array.isArray(material)) material.dispose();
      }
      for (const texture of textures.values()) texture.dispose();
    };
  }, [root, textures]);

  return null;
}
