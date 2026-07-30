import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, type Texture } from 'three';
import {
  bookSpineTexture,
  certificateTexture,
  clinicalScreen,
  codeScreen,
  cvTexture,
  keycapTexture,
  stickyTexture,
  terminalScreen,
  whiteboardTexture,
} from './screenContent';
import { LIVE_REGIONS, type LiveRegion } from './liveScreens';
import { useReducedMotion } from '@/hooks/useReducedMotion';

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
  ix_cv_face: cvTexture,
  ix_keycap_legends: keycapTexture,
};

/**
 * Painted, but not *replaced* — these keep the material the room gave them and
 * only gain a map.
 *
 * Everything else here becomes `MeshBasicMaterial`, which is unlit by design: a
 * monitor showing a document is emitting, and shading it would darken it where
 * it is brightest. A keycap legend is the opposite. It is ink on plastic, three
 * millimetres across, sitting on a cap that is being shaded — so making it
 * unlit lights it fully in a room where nothing else is, and every key grows a
 * pale rectangle that reads as a sticker rather than as printing.
 *
 * Mutating the existing material also keeps the lightmap, the aging masks and
 * the roughness the build gave it, none of which a fresh material would carry.
 */
const LIT = new Set(['ix_keycap_legends']);

/** Screens read as light sources; paper does not. */
const EMISSIVE = new Set([
  'ix_monitor_health_display',
  'ix_monitor_code_display',
  'ix_laptop_display',
]);

function baseName(name: string) {
  // Book spines are numbered per project, so their index is meaningful and
  // must survive; everything else only picks up a suffix from glTF splitting a
  // multi-material mesh.
  if (/^ix_book_spine_\d+$/.test(name)) return name;
  if (/^ix_certificates_\d+$/.test(name)) return name;
  return name.replace(/_\d+$/, '');
}

const SPINE = /^ix_book_spine_(\d+)$/;
/**
 * The three framed awards, each printed with its own.
 *
 * Indexed like the spines and for the same reason: `baseName` strips a `_N`
 * suffix because glTF adds one when it splits a multi-material mesh, and here
 * the number is meaning rather than noise. Stripping it would print the same
 * award on all three frames.
 */
const CERTIFICATE = /^ix_certificates_(\d+)$/;

/**
 * Repaints one screen's live regions.
 *
 * Each region is cleared to the flat colour it sits on and then redrawn, so a
 * caret costs one small `fillRect` rather than a whole canvas. Returns whether
 * anything was drawn, so the caller only re-uploads textures that changed.
 */
function repaint(texture: Texture, regions: LiveRegion[], t: number) {
  const canvas = texture.image as HTMLCanvasElement | undefined;
  const ctx = canvas?.getContext('2d');
  if (!ctx) return false;

  for (const region of regions) {
    ctx.fillStyle = region.background;
    ctx.fillRect(region.x, region.y, region.w, region.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.w, region.h);
    ctx.clip();
    region.draw(ctx, t);
    ctx.restore();
  }
  return true;
}

/**
 * Screens redraw at a fixed 12 Hz, not every frame.
 *
 * A canvas texture upload is a full re-send of the image to the GPU, and there
 * are three of them; doing that at display rate costs far more than the motion
 * is worth. A blinking caret and a counter read as alive at 12 Hz, and the cost
 * stops scaling with refresh rate.
 */
const TICK = 1 / 12;

export function Screens({ root }: { root: Object3D }) {
  const reducedMotion = useReducedMotion();
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

  const certificateTextures = useMemo(() => {
    const made = new Map<number, Texture>();
    for (let index = 0; index < 3; index += 1) {
      try {
        made.set(index, certificateTexture(index));
      } catch {
        // A frame that fails to print should cost one blank certificate, not
        // the wall it hangs on.
      }
    }
    return made;
  }, []);

  const spineTextures = useMemo(() => {
    const made = new Map<number, Texture>();
    for (let index = 0; index < 6; index += 1) {
      try {
        made.set(index, bookSpineTexture(index));
      } catch {
        // One unreadable spine should not cost the shelf.
      }
    }
    return made;
  }, []);

  useEffect(() => {
    const replaced: Mesh[] = [];

    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const key = baseName(node.name);
      const spine = SPINE.exec(key);
      const certificate = CERTIFICATE.exec(key);
      const texture = spine
        ? spineTextures.get(Number(spine[1]))
        : certificate
          ? certificateTextures.get(Number(certificate[1]))
          : textures.get(key);
      if (!texture) return;

      if (LIT.has(key)) {
        const material = node.material;
        if (!Array.isArray(material) && 'map' in material) {
          const standard = material as MeshStandardMaterial;
          standard.map = texture;
          // White, because `map` multiplies `color` rather than replacing it.
          // Left at the cap colour the two would compound and the marks would
          // render at the square of a dark blue, which is black.
          standard.color.setRGB(1, 1, 1);
          standard.transparent = true;
          // The atlas is mostly empty and the quad sits a twentieth of a
          // millimetre off the cap, so writing depth for fully transparent
          // texels would z-fight with the key underneath along every edge.
          standard.depthWrite = false;
          material.needsUpdate = true;
        }
        return;
      }

      const previous = node.material;
      // Screens emit; paper does not. A monitor is right to be unlit — it is
      // its own light source — but the whiteboard, the CV, the notes and the
      // book spines were unlit too, so they rendered at full canvas
      // brightness in a dark room: a glowing whiteboard, plastic-shiny
      // spines. Painted matter now takes a standard material and lives in
      // the room's light like everything else around it.
      node.material = EMISSIVE.has(key)
        ? new MeshBasicMaterial({ map: texture, toneMapped: false, transparent: false })
        : new MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 });
      if (!Array.isArray(previous)) previous.dispose();
      replaced.push(node);
    });

    return () => {
      for (const mesh of replaced) {
        const material = mesh.material;
        if (!Array.isArray(material)) material.dispose();
      }
      for (const texture of textures.values()) texture.dispose();
      for (const texture of spineTextures.values()) texture.dispose();
    };
  }, [root, textures, spineTextures, certificateTextures]);

  const live = useMemo(
    () =>
      Object.entries(LIVE_REGIONS).flatMap(([name, build]) => {
        const texture = textures.get(name);
        if (!texture) return [];
        const regions = build(texture);
        return regions.length > 0 ? [{ texture, regions }] : [];
      }),
    [textures]
  );

  const elapsed = useRef(0);
  const since = useRef(Infinity);

  // Under reduced motion the screens still get one pass, so they settle on a
  // drawn caret and a filled counter rather than on the bare background the
  // regions were cut out of.
  useEffect(() => {
    if (!reducedMotion) return;
    for (const { texture, regions } of live) {
      if (repaint(texture, regions, 0)) texture.needsUpdate = true;
    }
  }, [live, reducedMotion]);

  useFrame((_, delta) => {
    if (reducedMotion || live.length === 0) return;

    elapsed.current += Math.min(0.05, delta);
    since.current += delta;
    if (since.current < TICK) return;
    since.current = 0;

    for (const { texture, regions } of live) {
      if (repaint(texture, regions, elapsed.current)) texture.needsUpdate = true;
    }
  });

  return null;
}
