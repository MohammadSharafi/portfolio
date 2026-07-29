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

/**
 * The probe a *baked* room reflects, which is the room itself.
 *
 * `buildEnvironment` above is a sky: a cold dome, a horizon band, a ground
 * bounce. That is the right answer when the environment is doing the lighting,
 * and the wrong one the moment a lightmap takes that job over — because what is
 * left for the probe to do is specular, and specular is a *reflection of the
 * surroundings*. A chrome drawer pull inside a room at night does not reflect
 * a blue sky. It reflects dark walls, a warm lamp, two bright monitors and a
 * window. Handing it the sky tints every metal and every gloss in the room
 * faintly blue, which is a cast that reads as "3D" long before anyone works out
 * why.
 *
 * So this is a crude model of the room's own interior: mostly dark, with the
 * four things in it bright enough to see in a reflection, roughly where they
 * actually are. It never lights anything directly — the lightmap does that —
 * so it can be dim and still do its whole job.
 */
export function buildRoomProbe(renderer: WebGLRenderer): {
  texture: Texture;
  dispose(): void;
} {
  const scene = new Scene();

  const panel = (color: Color, intensity: number) =>
    new MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), side: BackSide });

  // The room's own shell, seen from inside: dark, and very slightly warm from
  // the lamps rather than neutral grey. This is most of what any reflection in
  // the room is actually looking at.
  // Very dim on purpose. three.js scales diffuse and specular IBL together
  // with one `environmentIntensity`, so every bit of brightness given to the
  // shell also lands as flat ambient on every surface in the room — and the
  // lightmap has already accounted for all of that. Setting the shell to
  // something that looked "right" as a room lifted the walls out of shadow and
  // undid the falloff the bake spent an hour resolving. What the probe is
  // actually for is the four bright things below.
  const shell = new Mesh(new BoxGeometry(9, 5.4, 9), panel(new Color('#2a2733'), 0.09));
  shell.position.y = 1.4;
  scene.add(shell);

  // The floor, warmer and darker still — it is wood, and it is below
  // everything, so it is what the underside of every surface sees.
  const floor = new Mesh(new BoxGeometry(8.6, 0.3, 8.6), panel(new Color('#40301f'), 0.16));
  floor.position.y = -1.2;
  scene.add(floor);

  // The two monitors. Bright, cold, and the dominant reflection on anything
  // sitting on the desk — which is where most of the room's metal lives.
  const screens = new Mesh(new BoxGeometry(1.9, 0.65, 0.1), panel(new Color('#8fc4ff'), 6.0));
  screens.position.set(0.1, 1.15, -2.3);
  scene.add(screens);

  // The desk lamp: small, warm, and by far the strongest single source. A
  // highlight from this is what tells the eye a surface is glossy at all.
  const lamp = new Mesh(new SphereGeometry(0.16, 12, 8), panel(new Color('#ffb367'), 22.0));
  lamp.position.set(0.8, 1.1, -2.1);
  scene.add(lamp);

  // The floor lamp on the other side, so reflections have two directions and
  // metal does not read as monochrome.
  const standing = new Mesh(new SphereGeometry(0.2, 12, 8), panel(new Color('#ffc98a'), 12.0));
  standing.position.set(-1.2, 1.45, 1.85);
  scene.add(standing);

  // The window. Cold, large, and the only thing in the room that is a sky.
  const window_ = new Mesh(new BoxGeometry(0.1, 1.2, 1.7), panel(new Color('#5f7fc0'), 2.2));
  window_.position.set(2.05, 1.55, -2.5);
  scene.add(window_);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(scene, 0.04);
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
