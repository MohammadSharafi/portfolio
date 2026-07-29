import { NoColorSpace, type MeshStandardMaterial, type Texture } from 'three';

/**
 * Dust and wear, applied to a standard material through its own shader.
 *
 * The masks come from `scripts/blender/aging.py`, baked from geometry into the
 * same UV1 atlas the lightmap uses: red is ambient occlusion, green is dust,
 * blue is wear. Applying them needs three things three.js has no slot for —
 * tinting base colour toward dust, driving roughness up where dust sits and
 * down where a surface has been rubbed, and hiding metal under both — so the
 * shader is patched rather than configured.
 *
 * `onBeforeCompile` rather than a custom material on purpose. `MeshStandard`
 * already carries every other property the room needs (the lightmap, the PBR
 * maps, tone mapping, fog, shadows); replacing it to add two lines of maths
 * would mean reimplementing all of that and keeping it in step with three.js.
 * Patching costs one texture fetch and about a dozen instructions per fragment.
 */

/**
 * Settled household dust: pale, slightly warm, and never white. Dust that
 * reads as white is the usual mistake — it turns every surface chalky, which
 * looks like a neglected film set rather than a room someone works in.
 */
const DUST_COLOUR = 'vec3( 0.60, 0.575, 0.535 )';

/**
 * How much of each effect at full mask.
 *
 * The masks say *where*, and these say *how much*. Both are set against what
 * the atlas actually contains rather than by taste, because the two are very
 * differently distributed and a single "subtle" number suits neither:
 *
 *   dust  reaches 255 and covers 12.8% of lit texels
 *   wear  reaches 228 and covers 2.6%, with a mean of 2.1
 *
 * Wear is nearly all zero because nearly all of a room is not an edge. Judging
 * it by its mean and setting a cautious 0.45 put the sharpest edge in the room
 * at 0.40 of an effect that is itself subtle — below anything a screen can
 * show, which is why the first pass was invisible in the browser and the
 * effect looked like it had not shipped. What matters is the value at the
 * peak, since the peak is the only place there is an edge to wear.
 *
 * These were then raised again, because "subtle" was being judged from 30 cm
 * away with a debug camera. The room is seen from three metres, where a desk
 * edge is a few pixels wide and dust on a shelf is a soft gradient a dozen
 * pixels across — and at that size an effect tuned to be barely perceptible
 * up close is not subtle, it is absent. Tuned at the distance the room is
 * actually viewed from.
 */
export const DUST_AMOUNT = 0.72;
export const WEAR_AMOUNT = 1.0;

/** The GLSL spliced in after the material has resolved its own maps. */
const AGING_FRAGMENT = /* glsl */ `
  vec3 agingMask = texture2D( agingMap, vAoMapUv ).rgb;
  float dust = agingMask.g * dustAmount;
  float wear = agingMask.b * wearAmount;

  // Break the wear up along the edge it runs down.
  //
  // The mask is geometric — bevel angle times exposure times reach — so it is
  // perfectly even for the whole length of any given edge, and an even band of
  // lightening down every edge in the room reads as an outline drawn around
  // the furniture rather than as wear. Real wear is patchy: a sleeve rests in
  // one place more than another, a corner catches and a span beside it does
  // not.
  //
  // One octave of value noise, sampled on the atlas UV. That coordinate is
  // unique per point on the room, so the patchiness sits still in world space
  // rather than swimming as the camera moves — which a screen-space or
  // view-dependent hash would do, and which reads instantly as a shader rather
  // than as dirt. Kept above zero at its lowest so heavily worn spots stay
  // continuous instead of dissolving into speckle.
  vec2 wearCell = vAoMapUv * 220.0;
  vec2 wearId = floor( wearCell );
  vec2 wearFrac = smoothstep( 0.0, 1.0, fract( wearCell ) );
  vec4 wearCorners = fract(
    sin( vec4(
      dot( wearId + vec2( 0.0, 0.0 ), vec2( 127.1, 311.7 ) ),
      dot( wearId + vec2( 1.0, 0.0 ), vec2( 127.1, 311.7 ) ),
      dot( wearId + vec2( 0.0, 1.0 ), vec2( 127.1, 311.7 ) ),
      dot( wearId + vec2( 1.0, 1.0 ), vec2( 127.1, 311.7 ) )
    ) ) * 43758.5453
  );
  float wearPatch = mix(
    mix( wearCorners.x, wearCorners.y, wearFrac.x ),
    mix( wearCorners.z, wearCorners.w, wearFrac.x ),
    wearFrac.y
  );
  wear *= 0.45 + 0.55 * wearPatch;

  // Wear first: it describes the surface under the dust, and dust settles on
  // whatever the wear left behind.
  //
  // Contact polishes. A desk edge, a drawer pull and a chair arm all end up
  // smoother than the finish they started with, because the finish is what
  // wore away — so roughness falls where the mask is strong. On anything
  // painted or coated, the thinning coat also lets a little more light back
  // out, which is why worn edges catch the eye before you know why.
  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.42, wear );
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    diffuseColor.rgb * 1.18 + 0.015,
    wear * ( 1.0 - metalnessFactor )
  );

  // Dust is a thin dielectric layer sitting on top of whatever is underneath.
  // It scatters, so it lifts and desaturates the colour and drives roughness
  // hard up; and because it is a layer, it hides the metal below it — dusty
  // chrome stops being chrome, which is most of why a dusty surface reads as
  // dusty rather than as a lighter shade of the same thing.
  diffuseColor.rgb = mix( diffuseColor.rgb, ${DUST_COLOUR}, dust );
  roughnessFactor = mix( roughnessFactor, 0.93, dust );
  metalnessFactor = mix( metalnessFactor, 0.0, dust );
`;

/**
 * Patch one material to read the aging atlas.
 *
 * The texture is assigned to `aoMap` as well as to the patch's own uniform,
 * and that is not redundant. It is the supported way to make three.js declare
 * and interpolate `vAoMapUv` for UV1 — the alternative is injecting a custom
 * attribute and varying, which collides with whatever three.js decides to
 * declare in the next release. The occlusion in the red channel is genuinely
 * what `aoMap` wants, so the slot is honest; `aoMapIntensity` decides whether
 * it is also *used*, and a baked room sets it to zero because the lightmap
 * already resolved that occlusion by path tracing it.
 */
export function applyAging(
  material: MeshStandardMaterial,
  aging: Texture,
  { occlusion }: { occlusion: number }
) {
  material.aoMap = aging;
  material.aoMapIntensity = occlusion;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.agingMap = { value: aging };
    shader.uniforms.dustAmount = { value: DUST_AMOUNT };
    shader.uniforms.wearAmount = { value: WEAR_AMOUNT };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D agingMap;
         uniform float dustAmount;
         uniform float wearAmount;`
      )
      // After the metalness chunk, which is the first point at which all three
      // of `diffuseColor`, `roughnessFactor` and `metalnessFactor` exist and
      // none of them has been consumed yet.
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\n${AGING_FRAGMENT}`
      );
  };

  // Two materials whose shaders differ only in a patched string still hash to
  // the same program without this, so the first one compiled wins and the rest
  // silently render with its uniforms.
  material.customProgramCacheKey = () => 'aging';
  material.needsUpdate = true;
}

/** Prepares the atlas for sampling. Data, not colour — see `aging.py`. */
export function prepareAgingTexture(aging: Texture) {
  // Same three settings as the lightmap, for the same reasons: glTF stores V
  // the other way up, the atlas is on TEXCOORD_1, and sampling it through the
  // model's tiling UV0 would repeat it every half metre.
  aging.flipY = false;
  aging.channel = 1;
  // No transfer function. These are masks — an occlusion factor, a dust
  // coverage, a wear amount — and running them through the sRGB decode would
  // bend all three into a curve meant for light the eye is looking at.
  aging.colorSpace = NoColorSpace;
  aging.needsUpdate = true;
  return aging;
}
