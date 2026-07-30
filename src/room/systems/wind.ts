import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

/**
 * The room's one wind field.
 *
 * A single slowly-varying vector every animated system reads, so the dust,
 * the foliage and anything added later all answer to the same breeze instead
 * of each carrying a private sine wave — synchronised motion is robotic, but
 * *uncorrelated* motion is worse: three systems ignoring the same gust is how
 * an effect reads as three effects.
 *
 * Layered Perlin, never periodic: a slow wander sets the base strength, a
 * much slower band brings occasional gusts, and the direction itself drifts a
 * few degrees around the line from the window into the room. Sampled once per
 * frame by whoever calls `updateWind`; everyone else just reads `wind`.
 */
const noise = new ImprovedNoise();

export const wind = {
  // Unit direction in the ground plane (three.js x/z), from the window.
  x: -0.94,
  z: -0.34,
  // 0..~1. Calm most of the time, above 0.6 only in gusts.
  strength: 0.3,
  // Integrated travel, for systems that advect (the dust rides this).
  travelX: 0,
  travelZ: 0,
};

let last = 0;

export function updateWind(time: number): void {
  const dt = Math.min(0.05, time - last);
  last = time;

  // Perlin sampled along one axis with distinct y-offsets is three
  // independent non-repeating signals from one noise instance.
  const base = 0.3 + noise.noise(time * 0.05, 0.0, 0.0) * 0.15;
  const gustBand = noise.noise(time * 0.008, 7.3, 0.0);
  // Gusts only when the slow band crests, so they arrive in bouts with calm
  // between them rather than as a steady chop.
  const gust = Math.max(0, gustBand) * 0.55;
  wind.strength = Math.max(0.05, base + gust);

  const angle = Math.atan2(-0.34, -0.94) + noise.noise(time * 0.02, 13.1, 0.0) * 0.45;
  wind.x = Math.cos(angle);
  wind.z = Math.sin(angle);

  wind.travelX += wind.x * wind.strength * dt * 0.05;
  wind.travelZ += wind.z * wind.strength * dt * 0.05;
}
