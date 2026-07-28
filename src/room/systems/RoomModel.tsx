import { useEffect, useMemo } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import type { MeshStandardMaterial, Texture } from 'three';
import { Mesh, SRGBColorSpace, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { type ObjectId } from '../data/objects';
import { roomAudio } from '../engine/audio';
import { toObjectId } from './objectId';

/**
 * A 1x1 transparent PNG.
 *
 * `useTexture` suspends, so it cannot be called conditionally without breaking
 * hook order. An unbaked room loads this and never uses it.
 */
const EMPTY_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function RoomModel({
  url,
  lightmap,
  intensity,
  onReady,
}: {
  url: string;
  lightmap: string | null;
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
        const material = node.material as MeshStandardMaterial;
        material.lightMap = lit;
        // Not 1.0, and not a number anyone should tune by eye. The bake divided
        // irradiance down to fit a JPEG and three.js applies a 1/π the bake has
        // already applied, so the exact factor that restores the rendered
        // lighting is arithmetic — `bake_room.py` computes it and writes it into
        // the stamp beside the image.
        material.lightMapIntensity = intensity;
      }

      const id = toObjectId(node.name);
      if (id) node.userData.objectId = id;
    });

    return root;
  }, [scene, baked, lit, intensity]);

  useEffect(() => {
    onReady?.(prepared);
    // Intentionally not depending on `onReady`: it is a setState from the
    // scene, and re-running this on every parent render would thrash it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  // A handle on the room, in dev only.
  //
  // Every lighting question this pipeline raises — is the lightmap actually
  // bound, is its intensity what the stamp said, is this surface dark because
  // of the bake or because of its own albedo — is a question about live
  // material state, and the alternative to reading it is guessing at a scalar
  // and re-baking to check. Stripped from production builds by `import.meta.env`.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { room?: Object3D }).room = prepared;
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
