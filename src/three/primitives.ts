import type { Color } from 'three';
import { BoxGeometry, Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type Vec3 = [number, number, number];

export interface StandardOptions {
  roughness?: number;
  metalness?: number;
  emissive?: Color;
  emissiveIntensity?: number;
}

export const standard = (color: Color, options: StandardOptions = {}) =>
  new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0.05,
    ...(options.emissive ? { emissive: options.emissive } : {}),
    ...(options.emissiveIntensity ? { emissiveIntensity: options.emissiveIntensity } : {}),
  });

/**
 * A material that reads as a light source. Nothing in the journey uses a real
 * light for the small warm glows — a window, a bulb, a lit office floor. The
 * bloom pass turns these into believable sources for a fraction of the cost of
 * an actual PointLight, and the light budget stays inside what a phone can run.
 */
export const glow = (color: Color, intensity = 2.4, { fogged = true } = {}) =>
  new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0,
    // Scene fog is applied after emission, so a distant light source gets
    // washed toward the sky colour like any other surface. Correct for a lit
    // window two streets away, wrong for the moon.
    fog: fogged,
  });

/**
 * Every solid in the scene is a rounded box rather than a hard-edged one.
 * A real object has a small chamfer that catches a specular highlight along
 * each edge; without it a procedural scene reads instantly as raw primitives.
 * The radius is clamped so thin panels do not collapse into pills.
 */
export function box(
  size: Vec3,
  position: Vec3,
  material: MeshStandardMaterial,
  rotationY = 0
): Mesh {
  const smallest = Math.min(...size);
  const radius = Math.min(0.012, smallest * 0.35);
  const geometry =
    smallest > 0.006
      ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius)
      : new BoxGeometry(...size);

  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Landscape-scale boxes. The chamfer that sells a keycap is invisible on a
 * tower block and multiplies the vertex count of a whole city, so buildings,
 * walls and terrain use plain geometry.
 */
export function slab(
  size: Vec3,
  position: Vec3,
  material: MeshStandardMaterial,
  rotationY = 0
): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  return mesh;
}

/** Shares one geometry and material across repeated dressing. */
export function copy(
  geometry: BufferGeometry,
  material: Material,
  position: Vec3,
  rotationY = 0
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  return mesh;
}

/**
 * Deterministic pseudo-random. A city laid out with Math.random would look
 * different on every reload and could not be art-directed; this seeds once and
 * gives the same skyline every time.
 */
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
