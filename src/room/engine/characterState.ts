import { Vector3 } from 'three';

/**
 * Where the robot is and which way it faces, published mutably for the
 * camera. Its own module rather than an export of `Character.tsx` so the
 * component file exports only the component — which is what lets Vite's
 * fast refresh swap the character without remounting the whole scene.
 */
export const characterState = {
  position: new Vector3(0.05, 0.006, 1.3),
  heading: Math.PI,
  active: false,
  /** True whenever the feet are off a surface — flying or falling. */
  airborne: false,
  /** Thruster fuel remaining, 0..1. Read by the gauge every frame without
   * passing through React state: a value that changes 60 times a second has
   * no business re-rendering a component tree. */
  fuel: 1,
};
