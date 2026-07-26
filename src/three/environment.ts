import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * A procedural HDR environment, prefiltered into a mip chain by PMREMGenerator.
 *
 * Three's stock RoomEnvironment is a white studio box: correct for a product
 * shot, wrong for every chapter here, where it made polished metal reflect a
 * bright ceiling that does not exist and washed the night out. This builds the
 * sky the scene is actually under — a cold gradient dome with a warm ground
 * bounce and a bright horizon band — and lets the emissive panels run well
 * above 1.0 so the prefiltered radiance is genuinely high dynamic range rather
 * than a clamped LDR image. That range is what gives the water, the pool and
 * the metal in the room a reflection with any depth to it.
 */
export function buildEnvironment(renderer: WebGLRenderer): {
  texture: Texture;
  dispose(): void;
} {
  const scene = new Scene();

  const panel = (color: Color, intensity: number) =>
    new MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), side: BackSide });

  // Sky dome: cold above, and dark enough that nothing reads as an overcast day.
  const dome = new Mesh(new SphereGeometry(12, 24, 16), panel(new Color('#2b3858'), 1.15));
  scene.add(dome);

  // Ground bounce: warm, weak, and only on the lower half.
  const floor = new Mesh(
    new SphereGeometry(11.6, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    panel(new Color('#3a2a1e'), 0.55)
  );
  scene.add(floor);

  // Horizon band, the brightest thing in the environment. Reflective surfaces
  // pick this up as the streak of light that makes them read as wet or polished.
  const horizon = new Mesh(new BoxGeometry(26, 1.1, 26), panel(new Color('#6f86c4'), 3.4));
  horizon.position.y = 0.6;
  scene.add(horizon);

  // A single warm source off to one side, so reflections have a direction.
  const warm = new Mesh(new BoxGeometry(5, 4, 0.4), panel(new Color('#ffb367'), 5.5));
  warm.position.set(6.5, 3.2, -7);
  scene.add(warm);

  // And a cold one opposite it, which is what stops metal looking monochrome.
  const cold = new Mesh(new BoxGeometry(6, 5, 0.4), panel(new Color('#8fb4ff'), 3.2));
  cold.position.set(-7.5, 4.5, 6);
  scene.add(cold);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();

  scene.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (material && !Array.isArray(material)) material.dispose();
  });

  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
