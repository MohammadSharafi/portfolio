import { useEffect, useMemo } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import { useStore } from '@react-three/fiber';
import type { MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { Mesh, SRGBColorSpace, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { type ObjectId } from '../data/objects';
import { roomAudio } from '../engine/audio';
import { toObjectId } from './objectId';
import { applyAging, prepareAgingTexture } from './aging';

/**
 * A 1x1 transparent PNG.
 *
 * `useTexture` suspends, so it cannot be called conditionally without breaking
 * hook order. An unbaked room loads this and never uses it.
 */
const EMPTY_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Turns real refraction into ordinary transparency.
 *
 * Three materials in the room were exported with `transmission: 1` — the
 * window pane, a tumbler, and the water in it. That is the physically correct
 * way to describe glass, and it was quietly the most expensive decision in the
 * whole scene: three.js implements transmission by rendering *the entire opaque
 * scene a second time* into a separate target, every frame, so that the
 * transmissive surfaces have something to refract. It then builds a mipmap
 * chain of that target.
 *
 * The room submits around 360 draw calls. Measured, it was issuing about 790 —
 * and the second batch existed so that a drinking glass on a coffee table could
 * bend the image behind it. That is the entire scene's CPU cost, doubled, spent
 * on three objects, two of which are the size of a fist.
 *
 * Dropping to `transparent` keeps almost all of it. What transmission buys over
 * blending is refractive distortion and thickness-tinted absorption — effects
 * you read at a hand's distance through a curved surface, and this room is
 * viewed from across itself. What actually sells glass at this range is
 * specular response and a reflection of the room, and both survive: these stay
 * `MeshPhysicalMaterial`, they keep their IOR, roughness and environment map,
 * and only the refraction pass goes.
 *
 * Done on every tier, not just the weak ones. A cost this size for a difference
 * this small is not a trade that becomes correct on faster hardware — it just
 * becomes affordable, which is not the same thing.
 */
function demoteTransmission(material: MeshStandardMaterial) {
  const physical = material as MeshPhysicalMaterial;
  if (!(physical.transmission > 0)) return;

  // glTF only writes `opacity` through when the material is alpha-blended, so
  // the pane — which was opaque with transmission doing the work — arrives at
  // 1 and has to be given a value. Low, because a window is mostly not there;
  // the tumbler and the water carry the alpha they were authored with.
  physical.opacity = physical.opacity < 1 ? physical.opacity : 0.16;
  physical.transparent = true;
  physical.transmission = 0;

  // Without this the pane writes depth and hides the skyline behind it, which
  // is the one thing the window exists to show.
  physical.depthWrite = false;
  physical.needsUpdate = true;
}

export function RoomModel({
  url,
  lightmap,
  aging,
  intensity,
  onReady,
}: {
  url: string;
  lightmap: string | null;
  /** Dust, wear and occlusion baked from the room's own geometry. */
  aging: string | null;
  /** What the bake says `lightMapIntensity` must be. See `useRoomAsset`. */
  intensity: number;
  onReady?: (root: Object3D) => void;
}) {
  const { scene } = useGLTF(url);
  // drei's `useTexture` suspends, and a null path would break the hook order,
  // so an unbaked room loads a 1x1 transparent pixel it then ignores.
  const baked = lightmap !== null;
  const lit = useTexture(lightmap ?? EMPTY_PIXEL) as Texture;
  // Three settings, and all three are silent when wrong.
  //
  // `flipY = false` because glTF stores V the other way up from a plain image
  // load, so a lightmap left flipped lands upside down on every surface.
  // `channel = 1` because the bake UVs are TEXCOORD_1 — the model's texture UVs
  // are on 0, and sampling the lightmap through those tiles it every half
  // metre. And sRGB because `tonemap.encode_srgb` wrote it that way.
  lit.flipY = false;
  lit.channel = 1;
  lit.colorSpace = SRGBColorSpace;
  lit.needsUpdate = true;

  const aged = aging !== null;
  const wear = prepareAgingTexture(useTexture(aging ?? EMPTY_PIXEL) as Texture);
  const hover = useEngine((state) => state.hover);
  const focus = useEngine((state) => state.focus);
  const toggleLamp = useEngine((state) => state.toggleLamp);
  const discover = useEngine((state) => state.discover);

  const prepared = useMemo(() => {
    const root = scene.clone(true);

    // `Object3D.clone` shares materials rather than copying them, and the room
    // has around 250 meshes over 190 materials — so walking meshes means
    // meeting most materials several times. Every visit was reassigning the
    // same maps and setting `needsUpdate`, which asks three.js to throw away
    // the compiled program and build it again. Doing the work once per
    // material turns a few hundred redundant shader compiles into none.
    const dressed = new Set<string>();

    root.traverse((node: Object3D) => {
      if (!(node instanceof Mesh)) return;

      node.castShadow = !baked;
      node.receiveShadow = !baked;

      const material = node.material as MeshStandardMaterial;
      const first = !dressed.has(material.uuid);
      dressed.add(material.uuid);

      // A surface that emits does not take a lightmap.
      //
      // The lamp shade is one layer of paper with the bulb *inside* it, so the
      // faces seen from the room are the same faces the bulb shines on from
      // behind — and Cycles lights a diffuse surface from both sides. The bake
      // therefore recorded the bulb's direct irradiance, at point-blank range,
      // on the outside of the shade: it clipped to flat white and lost the cone
      // entirely, and where the UV island split, one half took that value and
      // the other took the dim outer one, which is the seam that ran down the
      // middle of it.
      //
      // Giving the shade thickness would fix the bake. Not baking it at all is
      // better, because for anything that emits, the emission *is* the
      // appearance — the same reason a monitor is not lit by the room it lights.
      const emits =
        material.emissiveIntensity > 0 &&
        (material.emissive.r > 0.02 || material.emissive.g > 0.02 || material.emissive.b > 0.02);

      if (baked && first && !emits) {
        // The lighting goes *onto* the material rather than replacing it.
        //
        // This used to swap every material for an unlit `MeshBasicMaterial`
        // carrying a combined bake — light and albedo fused into one image.
        // That is cheap and it is why nothing in the room looked like its
        // material: an unlit shader has no roughness response, no specular and
        // no fresnel, so glass, plastic, wood and cotton were all the same flat
        // painted colour.
        //
        // The bake is now pure irradiance, so the model keeps its own base
        // colour, roughness, metalness and normal maps and three.js multiplies
        // the light in through the `lightMap` slot. Same resolved-once lighting,
        // same runtime cost to speak of, but a glossy surface can be glossy.
        material.lightMap = lit;
        // Not 1.0, and not a number anyone should tune by eye. The bake divided
        // irradiance down to fit a JPEG and three.js applies a 1/π the bake has
        // already applied, so the exact factor that restores the rendered
        // lighting is arithmetic — `bake_room.py` computes it and writes it into
        // the stamp beside the image.
        material.lightMapIntensity = intensity;
      }

      if (first) demoteTransmission(material);

      if (aged && first) {
        // Occlusion at zero when the room is baked: the lightmap is path-traced
        // irradiance and has that occlusion in it already, so applying the mask
        // as well would darken every corner in the room twice.
        applyAging(material, wear, { occlusion: baked ? 0 : 1 });
      }

      const id = toObjectId(node.name);
      if (id) node.userData.objectId = id;
    });

    // The room does not move, so stop asking it every frame whether it has.
    //
    // three.js recomposes an object's local matrix from its position, rotation
    // and scale on every render unless told not to. For a room of ~190 static
    // meshes that is 190 matrix compositions and 190 world-matrix
    // multiplications per frame, sixty times a second, to arrive at exactly
    // the numbers it arrived at last time. Turning it off makes the transform
    // a one-time cost.
    //
    // The exceptions are the things that genuinely move, and they are listed
    // rather than detected because getting this wrong has a nasty failure
    // mode: the object simply stops animating, silently, with no error and no
    // visual clue beyond "the lid used to shut". `Animations` drives the
    // laptop lid and the steam; the props are re-parented into Rapier bodies
    // by `Props` before this runs but are matched anyway, in case that order
    // ever changes; and the wind is a vertex shader, which moves geometry
    // without touching a transform at all.
    const ANIMATED = /^(ix_laptop_lid|ix_laptop_display|steam_|ix_mug|ix_pencil|ix_mouse)/;
    root.traverse((node: Object3D) => {
      if (node === root || ANIMATED.test(node.name)) return;
      // A parent that still updates will recompute its children's world
      // matrices regardless, so a static node under an animated one is left
      // alone rather than half-frozen.
      if (node.parent && node.parent !== root && ANIMATED.test(node.parent.name)) return;
      node.updateMatrix();
      node.matrixAutoUpdate = false;
    });

    return root;
  }, [scene, baked, lit, intensity, aged, wear]);

  useEffect(() => {
    onReady?.(prepared);
    // Intentionally not depending on `onReady`: it is a setState from the
    // scene, and re-running this on every parent render would thrash it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  // `useStore`, not `useThree`. The latter subscribes to every field in the
  // r3f store, so this component would re-render on any state change at all.
  const store = useStore();

  // A handle on the room, in dev only.
  //
  // Every lighting question this pipeline raises — is the lightmap actually
  // bound, is its intensity what the stamp said, is this surface dark because
  // of the bake or because of its own albedo — is a question about live
  // material state, and the alternative to reading it is guessing at a scalar
  // and re-baking to check. Stripped from production builds by `import.meta.env`.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // The camera, renderer and scene come along with the room. r3f keeps all
    // three in its own store rather than in the scene graph, so from a console
    // there is no way to reach them — which leaves questions like "what does
    // this shelf look like from 30 cm" and "what is the exposure actually set
    // to" answerable only by editing the source and waiting for a reload.
    Object.assign(window as unknown as Record<string, unknown>, {
      room: prepared,
      three: store.getState(),
    });
  }, [prepared, store]);

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
