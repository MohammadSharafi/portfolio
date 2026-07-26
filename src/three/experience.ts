import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildRoom } from './room';
import { buildJourney, roomSky, roomViews, type Stage, type View } from './journey';
import { buildEnvironment } from './environment';
import { codeScreen, projectsScreen, terminalScreen } from './screens';
import { palette } from './palette';
import type { SceneQuality } from '@/lib/webgl';

export interface ExperienceOptions {
  canvas: HTMLCanvasElement;
  projectTitles: readonly string[];
  terminalLines: readonly string[];
  /** Suppresses idle motion and pointer parallax. */
  reducedMotion: boolean;
  /** Scales shadows, pixel ratio and post-processing to the device. */
  quality: SceneQuality;
  /** Fires when the chapter under the camera changes, for the DOM captions. */
  onChapter?: (index: number) => void;
}

export interface Experience {
  /** 0 = the village, 1 = the desk. Driven by page scroll. */
  setProgress(progress: number): void;
  dispose(): void;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Smoothstep, so the camera settles into each stop instead of sliding past it. */
function ease(t: number) {
  return t * t * (3 - 2 * t);
}

export function createExperience(options: ExperienceOptions): Experience {
  const { canvas, projectTitles, terminalLines, reducedMotion, quality, onChapter } = options;
  const high = quality === 'high';

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // Capped: shadow-mapped scenes at 3x DPR cost far more than they show.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.25));

  const scene = new Scene();
  scene.background = roomSky.clone();
  scene.fog = new Fog(scene.background.clone(), 8, 32);

  const environment = buildEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;

  const camera = new PerspectiveCamera(38, 1, 0.1, 220);

  /**
   * Every shot in the journey is composed horizontally — an arcade receding
   * across the frame, a bridge spanning it, a skyline. A PerspectiveCamera's
   * `fov` is vertical, so on a portrait phone a fixed value crops the sides off
   * exactly the part that was composed. Widening the vertical field by the
   * aspect shortfall keeps the horizontal field constant instead, so a phone
   * sees the same shot as a desktop, taller. Clamped so an extreme viewport
   * cannot bend the frame into a fisheye.
   */
  const REFERENCE_ASPECT = 16 / 9;
  const BASE_FOV = 38;
  const fovForAspect = (aspect: number) => {
    if (aspect >= REFERENCE_ASPECT) return BASE_FOV;
    const half = Math.tan((BASE_FOV * Math.PI) / 360) * (REFERENCE_ASPECT / aspect);
    return Math.min(76, (Math.atan(half) * 360) / Math.PI);
  };

  // Content ------------------------------------------------------------------
  const journey = buildJourney();
  scene.add(journey.root);

  const room = buildRoom({
    code: codeScreen(),
    projects: projectsScreen(projectTitles),
    terminal: terminalScreen(terminalLines),
  });
  scene.add(room.root);

  // The star dome is parented to a group re-centred on the camera every frame,
  // so the stars stay at infinity across ninety units of travel rather than
  // sliding past the window like confetti.
  const sky = new Group();
  sky.add(journey.stars.points);
  scene.add(sky);

  // Lighting -----------------------------------------------------------------
  // Three lights carry all six chapters. Their colour, intensity and position
  // are eased between the stage rigs as the camera travels, which is both far
  // cheaper than a light per chapter and the reason the transitions read as one
  // continuous change of time of day rather than as cuts.
  const ambient = new AmbientLight(new Color('#2b3550'), 0.34);
  scene.add(ambient);

  const sun = new DirectionalLight(new Color('#8fa8dd'), 0.55);
  sun.castShadow = high;
  sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 48;
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  // The shadow camera is only fourteen units across, so it tracks the active
  // chapter instead of trying to cover the whole ninety-unit world at a
  // resolution that would turn every shadow into a staircase.
  const sunTarget = new Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;

  const accent = new PointLight(new Color('#ffbe6b'), 7, 10, 2);
  accent.castShadow = false;
  scene.add(accent);

  // The room keeps its own rig: it is an interior lit by its own screens and
  // lamp, and no travelling light can stand in for that.
  const screenLight = new PointLight(palette.screenGlow, 3.1, 5.5, 2);
  screenLight.position.set(0, 1.15, -1.35);
  scene.add(screenLight);

  const lampLight = new PointLight(palette.lampWarm, 4.6, 4.5, 2);
  lampLight.position.set(...room.lampPosition);
  lampLight.castShadow = high;
  lampLight.shadow.mapSize.set(512, 512);
  lampLight.shadow.bias = -0.004;
  scene.add(lampLight);

  const rim = new PointLight(new Color('#6f8cff'), 1.1, 7, 2);
  rim.position.set(0.4, 2.3, -2.0);
  scene.add(rim);

  // The room's interior rig laid out as a stage, so the last three camera stops
  // interpolate through exactly the same code path as the outdoor ones.
  const roomStage: Omit<Stage, 'root' | 'view'> = {
    sky: roomSky,
    fog: [7.5, 17],
    ambient: { color: new Color('#3d4761'), intensity: 0.35 },
    sun: { color: new Color('#93b0e8'), intensity: 0.42, position: [4, 6, 4] },
    accent: { color: palette.accent, intensity: 1.6, distance: 6, position: [-2.4, 2.1, 0.6] },
    stars: 0,
  };

  /** Every camera stop, with the lighting rig that belongs to it. */
  const stops: Array<{ view: View; rig: Omit<Stage, 'root' | 'view'>; chapter: number }> = [];
  journey.stages.forEach((stage, index) => {
    stops.push({ view: stage.view, rig: stage, chapter: index });
  });
  for (const view of roomViews) {
    stops.push({ view, rig: roomStage, chapter: journey.stages.length });
  }

  // Post-processing ----------------------------------------------------------
  // Bloom is what sells a lit window in a dark village and a screen in a dark
  // room: without it an emissive material is just a bright rectangle. Only on
  // the high tier — it costs a full-resolution pass plus the blur pyramid.
  const composer = high ? new EffectComposer(renderer) : null;
  let bloomPass: UnrealBloomPass | null = null;

  if (composer) {
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1),
      0.3, // strength — a glow around bright sources, not a haze over the scene
      0.45, // radius
      0.9 // threshold — deliberately high. A city has hundreds of lit windows,
      // and at a lower threshold their combined bloom turned the whole chapter
      // into white fog. Only genuine highlights are allowed to bleed.
    );
    composer.addPass(bloomPass);
    // OutputPass applies tone mapping and colour space at the end of the chain,
    // which is where they belong once a composer is involved.
    composer.addPass(new OutputPass());
  }

  // Interaction --------------------------------------------------------------
  const pointer = { x: 0, y: 0 };
  const smoothed = { x: 0, y: 0 };
  let progress = 0;
  let renderedProgress = 0;
  let reportedChapter = -1;

  const onPointerMove = (event: PointerEvent) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
  };
  if (!reducedMotion) window.addEventListener('pointermove', onPointerMove, { passive: true });

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    composer?.setSize(clientWidth, clientHeight);
    bloomPass?.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.fov = fovForAspect(camera.aspect);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // Render loop --------------------------------------------------------------
  let frame = 0;
  let running = true;
  let clock = 0;
  let last = 0;

  const skyColour = new Color();
  const fogColour = new Color();
  const target = new Vector3();

  /**
   * Exponential smoothing with the frame time folded in. A fixed per-frame
   * factor would make the camera converge twice as fast on a 120Hz display as
   * on a 60Hz one and crawl on anything slower — the journey has to take the
   * same wall-clock time to travel however fast the device can draw it.
   */
  const approach = (current: number, goal: number, rate: number, dt: number) =>
    current + (goal - current) * (1 - Math.exp(-rate * dt));

  const tick = (now = 0) => {
    if (!running) return;
    frame = requestAnimationFrame(tick);

    // Clamped so a backgrounded tab or a stall does not teleport the camera.
    const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    renderedProgress = approach(renderedProgress, progress, 4.5, dt);
    smoothed.x = approach(smoothed.x, pointer.x, 3, dt);
    smoothed.y = approach(smoothed.y, pointer.y, 3, dt);

    const scaled = renderedProgress * (stops.length - 1);
    const index = Math.min(Math.floor(scaled), stops.length - 2);
    const from = stops[index]!;
    const to = stops[index + 1]!;
    const t = ease(scaled - index);

    const parallaxX = reducedMotion ? 0 : smoothed.x * 0.4;
    const parallaxY = reducedMotion ? 0 : -smoothed.y * 0.26;

    camera.position.set(
      lerp(from.view.position[0], to.view.position[0], t) + parallaxX,
      lerp(from.view.position[1], to.view.position[1], t) + parallaxY,
      lerp(from.view.position[2], to.view.position[2], t)
    );
    target.set(
      lerp(from.view.target[0], to.view.target[0], t),
      lerp(from.view.target[1], to.view.target[1], t),
      lerp(from.view.target[2], to.view.target[2], t)
    );
    camera.lookAt(target);

    // Sky, fog and the whole light rig cross-fade between the two stops.
    skyColour.copy(from.rig.sky).lerp(to.rig.sky, t);
    (scene.background as Color).copy(skyColour);
    fogColour.copy(skyColour);
    const fog = scene.fog as Fog;
    fog.color.copy(fogColour);
    fog.near = lerp(from.rig.fog[0], to.rig.fog[0], t);
    fog.far = lerp(from.rig.fog[1], to.rig.fog[1], t);

    ambient.color.copy(from.rig.ambient.color).lerp(to.rig.ambient.color, t);
    ambient.intensity = lerp(from.rig.ambient.intensity, to.rig.ambient.intensity, t);

    sun.color.copy(from.rig.sun.color).lerp(to.rig.sun.color, t);
    sun.intensity = lerp(from.rig.sun.intensity, to.rig.sun.intensity, t);
    // Anchored to the camera's X so the tight shadow frustum always contains
    // whatever the visitor is currently looking at.
    sunTarget.position.set(camera.position.x - parallaxX, 1, target.z);
    sun.position.set(
      sunTarget.position.x + lerp(from.rig.sun.position[0], to.rig.sun.position[0], t),
      lerp(from.rig.sun.position[1], to.rig.sun.position[1], t),
      lerp(from.rig.sun.position[2], to.rig.sun.position[2], t)
    );

    accent.color.copy(from.rig.accent.color).lerp(to.rig.accent.color, t);
    accent.intensity = lerp(from.rig.accent.intensity, to.rig.accent.intensity, t);
    accent.distance = lerp(from.rig.accent.distance, to.rig.accent.distance, t);
    accent.position.set(
      lerp(from.rig.accent.position[0], to.rig.accent.position[0], t),
      lerp(from.rig.accent.position[1], to.rig.accent.position[1], t),
      lerp(from.rig.accent.position[2], to.rig.accent.position[2], t)
    );

    journey.stars.material.opacity = lerp(from.rig.stars, to.rig.stars, t);
    sky.position.copy(camera.position);

    // The room's own sources only matter once the camera is inside it, and
    // dimming them to nothing keeps them from lifting the night chapters.
    const inRoom = Math.max(0, Math.min(1, (renderedProgress - 0.72) / 0.14));
    screenLight.intensity = inRoom * (reducedMotion ? 3.1 : 3.1 + Math.sin(clock * 2.1) * 0.14);
    lampLight.intensity = inRoom * 4.6;
    rim.intensity = inRoom * 1.1;

    if (!reducedMotion) {
      room.animated.leaves.rotation.y = Math.sin(clock * 0.25) * 0.06;
      room.animated.trinket.rotation.y += 0.36 * dt;
      room.animated.trinket.rotation.x = Math.sin(clock * 0.4) * 0.12;
      for (const stage of journey.stages) stage.tick?.(clock);
    }

    const chapter = t < 0.5 ? from.chapter : to.chapter;
    if (chapter !== reportedChapter) {
      reportedChapter = chapter;
      onChapter?.(chapter);
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);
  };

  // Only render while the canvas is actually on screen.
  const visibility = new IntersectionObserver(
    ([entry]) => {
      const visible = entry?.isIntersecting ?? false;
      if (visible && !running) {
        running = true;
        tick();
      } else if (!visible) {
        running = false;
        cancelAnimationFrame(frame);
      }
    },
    { threshold: 0 }
  );
  visibility.observe(canvas);

  const onVisibilityChange = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!running) {
      running = true;
      tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  tick();

  return {
    setProgress(next) {
      progress = Math.min(1, Math.max(0, next));
    },
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
      composer?.dispose();
      environment.dispose();
      scene.traverse((object) => {
        const mesh = object as { geometry?: { dispose(): void }; material?: unknown };
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => (m as { dispose(): void }).dispose());
        else if (material) (material as { dispose(): void }).dispose();
      });
      renderer.dispose();
    },
  };
}
