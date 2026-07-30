import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { useEngine } from '../engine/store';
import { wind } from './wind';

// Shared by every wind-patched foliage material; written once per frame.
const WIND_TIME = { value: 0 };
const WIND_VEC = { value: new Vector3(-0.94, -0.34, 0.05) };

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
/** The emitting surfaces of the desk lamp, which the switch drives together.
 * No `lamp_beam` any more — the translucent cone was removed from the model
 * after its surface kept drawing bright arcs where it crossed the props. */
const GLOWING = new Set(['bulb', 'lamp_mouth']);

const LID_CLOSED = 1.42;

export function Animations({ root }: { root: Object3D }) {
  const focused = useEngine((state) => state.focused);
  const lampOn = useEngine((state) => state.lampOn);

  const parts = useMemo(() => {
    // Each part keeps its own resting rotation: the lid body sits at the hinge
    // tilt, the screen at that tilt plus the rotation that stands it upright.
    const lid: Array<{ node: Object3D; base: number }> = [];
    const bulbs: Array<{ material: MeshStandardMaterial; base: number }> = [];
    // The steam wisps, each with the pose it was modelled in, so the drift is
    // applied *around* that rather than replacing it.
    const steam: Array<{ node: Object3D; y: number; scale: number; phase: number }> = [];
    // The foliage materials, patched so the wind bends every stem and leaf
    // in the vertex shader. Rotating the foliage object was the first
    // version, and it moved the plant the way a toy moves: one rigid piece.
    // The deformation below scales with each vertex's height above the soil
    // crown (the foliage objects' origin), so motion propagates from stem to
    // tip and the tall leaves ride further than the low ones.
    const windMaterials: MeshStandardMaterial[] = [];

    root.traverse((node) => {
      // The lid only. The display is parented to it in the model now, so it
      // inherits the swing — turning it here as well would rotate it twice
      // and tear the screen off the panel it is fixed to.
      if (node.name.startsWith('ix_laptop_lid')) {
        lid.push({ node, base: node.rotation.x });
      }
      // The curtains: same wind, opposite anchoring. Foliage is pinned at
      // the soil and bends upward; a curtain is pinned at its rail and the
      // free hem below rides the draught, with a small fast flutter living
      // only near the bottom edge.
      if (node instanceof Mesh && /^curtain_[lr]/.test(node.name)) {
        const material = node.material;
        if (
          !Array.isArray(material) &&
          material instanceof MeshStandardMaterial &&
          !material.userData.windPatched
        ) {
          material.userData.windPatched = true;
          material.onBeforeCompile = (shader) => {
            shader.uniforms.uWindTime = WIND_TIME;
            shader.uniforms.uWindVec = WIND_VEC;
            shader.vertexShader = shader.vertexShader
              .replace(
                '#include <common>',
                '#include <common>\nuniform float uWindTime;\nuniform vec3 uWindVec;'
              )
              .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                {
                  float drop = pow(max(-transformed.y, 0.0), 1.3);
                  vec4 worldSeed = modelMatrix * vec4(transformed, 1.0);
                  float phase = worldSeed.x * 6.1;
                  float bend = drop * uWindVec.z * 1.9;
                  transformed.x += uWindVec.x * bend * (0.5 + 0.5 * sin(uWindTime * 0.6 + phase));
                  transformed.z += uWindVec.y * bend * (0.5 + 0.5 * sin(uWindTime * 0.52 + phase + 0.8))
                                 + sin(uWindTime * 2.3 + phase * 2.7) * drop * uWindVec.z * 0.22;
                }`
              );
          };
          material.customProgramCacheKey = () => 'wind-curtain';
          material.needsUpdate = true;
          windMaterials.push(material);
        }
      }
      if (node instanceof Mesh && /^plant_\d+_leaves/.test(node.name)) {
        const material = node.material;
        if (
          !Array.isArray(material) &&
          material instanceof MeshStandardMaterial &&
          !material.userData.windPatched
        ) {
          material.userData.windPatched = true;
          material.onBeforeCompile = (shader) => {
            shader.uniforms.uWindTime = WIND_TIME;
            shader.uniforms.uWindVec = WIND_VEC;
            shader.vertexShader = shader.vertexShader
              .replace(
                '#include <common>',
                '#include <common>\nuniform float uWindTime;\nuniform vec3 uWindVec;'
              )
              .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                {
                  float lift = pow(max(transformed.y, 0.0), 1.4);
                  vec4 worldSeed = modelMatrix * vec4(transformed, 1.0);
                  float phase = worldSeed.x * 2.7 + worldSeed.z * 3.3;
                  float bend = lift * uWindVec.z;
                  transformed.x += uWindVec.x * bend * (0.55 + 0.45 * sin(uWindTime * 1.25 + phase))
                                 + sin(uWindTime * 0.83 + phase * 1.9) * bend * 0.3;
                  transformed.z += uWindVec.y * bend * (0.55 + 0.45 * sin(uWindTime * 1.05 + phase + 1.3))
                                 + cos(uWindTime * 0.67 + phase) * bend * 0.3;
                }`
              );
          };
          material.customProgramCacheKey = () => 'wind-foliage';
          material.needsUpdate = true;
          windMaterials.push(material);
        }
      }
      if (node.name.startsWith('steam_')) {
        // The phase is derived from the wisp's index rather than random, so the
        // three never rise in step and the room rebuilds identically every time.
        const index = Number(node.name.split('_')[1] ?? 0);
        steam.push({ node, y: node.position.y, scale: node.scale.y, phase: index * 2.1 });
      }
      // Found by material, not by object name.
      //
      // This used to match `ix_lamp`, which was the bulb — until `ix_lamp`
      // became the whole fixture so that the lamp could be clicked in the room
      // rather than only in the overlay. Matching the name would now dim the
      // lamp's arm and shade along with its bulb.
      //
      // The material is the better key anyway: what should respond to the
      // switch is every surface that emits, and this room has three of them
      // per lamp — the bulb, the lit disc across the shade's mouth, and the
      // cone of air below it.
      if (node instanceof Mesh) {
        const material = node.material;
        // The floor lamp's shade glows *through* its fabric, so the glow has
        // to carry the weave: with a flat emissive the threads only showed
        // where outside light grazed the cloth, which is one side — a smooth
        // even glow everywhere else and a hot textured patch near the fill
        // light. Backlit cloth is darkest exactly on its threads, and
        // reusing the weave map as the emissive map is that fact.
        if (
          !Array.isArray(material) &&
          material instanceof MeshStandardMaterial &&
          material.name === 'lamp_shade' &&
          material.map &&
          !material.emissiveMap
        ) {
          material.emissiveMap = material.map;
          material.needsUpdate = true;
        }
        if (
          !Array.isArray(material) &&
          material instanceof MeshStandardMaterial &&
          GLOWING.has(material.name)
        ) {
          // Remember what the model authored, because the switch should scale
          // that rather than replace it.
          //
          // All three used to be driven to the same 6.0. They are not the same
          // thing: the bulb is a filament, the mouth is a lit disc across the
          // shade's opening, and the beam is a nearly transparent cone standing
          // in for dust in the air. Forcing one number onto all three turned
          // the beam into a hard white wedge painted on the desk — which is
          // exactly what it looked like.
          bulbs.push({ material, base: material.emissiveIntensity || 1 });
        }
      }
    });

    return { lid, bulbs, steam, windMaterials };
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
      // A small turn about the column's own base, now that the base is where
      // the origin is. This used to be 0.22 rad applied about an origin several
      // centimetres to one side of the mug, which is not a sway — it is an
      // orbit, and it looked like one. Smaller too: the modelled curve already
      // carries most of the wander, and the animation only has to keep it from
      // being the same curve every frame.
      wisp.node.rotation.y = Math.sin(clock.current * 0.6 + wisp.phase) * 0.09;
    }

    // Feed the shared wind field into the foliage shaders. The uniforms are
    // module-level objects every patched material points at, so this is two
    // writes per frame however many plants the room grows.
    WIND_TIME.value = clock.current;
    WIND_VEC.value.set(wind.x, wind.z, 0.03 + wind.strength * 0.075);

    const lampTarget = lampOn ? 1 : 0;
    glow.current += (lampTarget - glow.current) * (1 - Math.exp(-6 * dt));
    for (const bulb of parts.bulbs) {
      // A multiplier on what the model authored, so each surface keeps its own
      // relative brightness and the switch only decides how much of it there is.
      bulb.material.emissiveIntensity = bulb.base * (0.02 + glow.current * 0.98);
    }
  });

  return null;
}
