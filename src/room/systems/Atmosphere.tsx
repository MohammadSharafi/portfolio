import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';
import { useEngine } from '../engine/store';
import { quality } from '../engine/quality';
import { updateWind, wind } from './wind';

/**
 * Household dust, adrift in the room's air.
 *
 * One `Points` draw call, everything on the GPU: each particle's motion is a
 * function of time and its own seed evaluated in the vertex shader, so the
 * CPU's whole contribution per frame is a handful of uniforms. Positions wrap
 * inside the room's bounds, lifetimes are staggered by seed, and the drift is
 * the shared wind field plus per-particle Brownian wobble — no two ride the
 * breeze at the same rate, which is what keeps the cloud from reading as a
 * rigid constellation sliding sideways.
 *
 * The part that makes it dust rather than snow: particles carry almost no
 * intrinsic brightness. Each one computes its distance to the room's warm
 * sources — the desk lamp's cone, the floor lamp's shade, the window's cold
 * spill — and fades toward invisibility away from them. You see motes where a
 * shaft of lamplight catches them and nowhere else, which is exactly where a
 * real room shows them. Camera parallax comes free: they are true 3D points.
 */
/**
 * How many motes, by what the machine can afford.
 *
 * The vertex work is trivial — the expense is fill: every particle is a
 * transparent sprite composited over the whole frame, and on an integrated GPU
 * 1,800 of them is a measurable share of the budget for an effect that is, by
 * design, almost invisible. Cutting the count does not change the look nearly
 * as much as it changes the cost, because what sells dust is that motes are
 * scattered and lit only near a source, not that there are thousands of them.
 */
const COUNT = quality().dust;

// Room bounds the cloud wraps within (three.js space).
const BOUNDS = { x: 6.2, y: 2.45, z: 4.9 };

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec2 uTravel;
  uniform float uLampOn;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vGlow;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec3 p = position;

    // Advection: every particle rides the same integrated wind, each at its
    // own susceptibility, plus its own slow Brownian wobble.
    float ride = 0.5 + hash(aSeed * 7.31) * 0.9;
    p.x += uTravel.x * ride;
    p.z += uTravel.y * ride;
    p.x += sin(uTime * (0.10 + hash(aSeed * 3.7) * 0.12) + aSeed * 61.0) * 0.10;
    p.y += sin(uTime * (0.055 + hash(aSeed * 5.1) * 0.075) + aSeed * 47.0) * 0.07
         - uTime * (0.004 + hash(aSeed * 9.3) * 0.006);
    p.z += cos(uTime * (0.085 + hash(aSeed * 2.3) * 0.10) + aSeed * 83.0) * 0.10;

    // Wrap into the room, offset per seed so respawns never line up.
    p.x = mod(p.x + ${(BOUNDS.x / 2).toFixed(2)}, ${BOUNDS.x.toFixed(2)}) - ${(BOUNDS.x / 2).toFixed(2)};
    p.y = mod(p.y + hash(aSeed * 11.7) * ${BOUNDS.y.toFixed(2)}, ${BOUNDS.y.toFixed(2)});
    p.z = mod(p.z + ${(BOUNDS.z / 2).toFixed(2)}, ${BOUNDS.z.toFixed(2)}) - ${(BOUNDS.z / 2).toFixed(2)};

    // Lit only where the room's light is. Warm sources dominate; the window
    // contributes a cold breath so the sill is not dead air.
    float glow = 0.0;

    // Floor lamp: radial glow around the shade.
    vec3 toFloorLamp = p - vec3(-1.22, 1.42, -1.85);
    glow += 0.85 / (1.0 + 9.0 * dot(toFloorLamp, toFloorLamp));

    // Desk lamp: a cone below the shade mouth, gated by the switch.
    vec3 toDesk = p - vec3(0.785, 1.06, 2.2);
    vec3 axis = vec3(-0.267, -0.889, -0.373);
    float along = dot(toDesk, axis);
    if (along > 0.0 && along < 1.3) {
      vec3 radialVec = toDesk - axis * along;
      glow += uLampOn * 0.9 * exp(-along * 1.6) / (1.0 + 55.0 * dot(radialVec, radialVec));
    }

    // Window spill, cool and faint.
    vec3 toWindow = p - vec3(2.05, 1.6, 2.3);
    glow += 0.18 / (1.0 + 5.0 * dot(toWindow, toWindow));

    // Lifetime flicker: each mote drifts in and out of existence on its own
    // clock, so the cloud continuously recycles instead of being a fixed set.
    float life = 0.5 + 0.5 * sin(uTime * (0.16 + hash(aSeed * 13.3) * 0.22) + aSeed * 29.0);
    vGlow = min(glow, 1.1) * life;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPixelRatio * (0.45 + hash(aSeed * 17.9) * 1.05) * (30.0 / max(1.0, -mv.z));
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vGlow;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.1, 0.5, d)) * vGlow * 0.17;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export function Atmosphere() {
  const lampOn = useEngine((state) => state.lampOn);

  const points = useMemo(() => {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * BOUNDS.x;
      positions[i * 3 + 1] = Math.random() * BOUNDS.y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * BOUNDS.z;
      seeds[i] = Math.random() * 100;
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));

    const material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTravel: { value: [0, 0] },
        uLampOn: { value: 1 },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        uColor: { value: new Color('#ffe0b8') },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Normal blending at very low alpha, not additive: additive dust over
      // a lamp is glitter, and the spec for dust is that it barely exists.
      blending: NormalBlending,
      toneMapped: false,
    });

    const cloud = new Points(geometry, material);
    // The cloud spans the room and wraps; culling it by its birth bounds
    // would pop the whole effect at the edges of the frame.
    cloud.frustumCulled = false;
    // Motes are set dressing, never a click target.
    cloud.raycast = () => {};
    return cloud;
  }, []);

  useFrame(({ clock }) => {
    // The single per-frame wind sample every animated system shares.
    updateWind(clock.elapsedTime);
    const material = points.material as ShaderMaterial;
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uTravel!.value = [wind.travelX, wind.travelZ];
    const target = lampOn ? 1 : 0;
    const current = material.uniforms.uLampOn!.value as number;
    material.uniforms.uLampOn!.value = current + (target - current) * 0.08;
  });

  return <primitive object={points} />;
}
