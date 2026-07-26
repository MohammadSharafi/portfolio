import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildRoom } from './room';
import { codeScreen, projectsScreen, terminalScreen } from './screens';
import { palette } from './palette';
import type { SceneQuality } from '@/lib/webgl';

export interface ExperienceOptions {
  canvas: HTMLCanvasElement;
  projectTitles: readonly string[];
  terminalLines: readonly string[];
  /** Suppresses idle motion and pointer parallax. */
  reducedMotion: boolean;
  /** Scales shadows and pixel ratio to the device rather than excluding it. */
  quality: SceneQuality;
}

export interface Experience {
  /** 0 = first viewpoint, 1 = last. Driven by page scroll. */
  setProgress(progress: number): void;
  dispose(): void;
}

/** Camera viewpoints the scroll interpolates between. */
const VIEWS: Array<{ position: [number, number, number]; target: [number, number, number] }> = [
  // Opens close on the desk, then drifts across the room and pulls back.
  { position: [2.15, 1.55, 1.75], target: [0.15, 1.0, -1.55] },
  { position: [1.1, 1.28, 0.65], target: [0.05, 1.05, -1.72] },
  { position: [-1.15, 1.42, 0.75], target: [-0.5, 1.02, -1.7] },
  { position: [2.25, 1.5, 0.95], target: [1.4, 0.85, -1.6] },
  { position: [3.4, 2.45, 3.3], target: [0, 1.0, -1.5] },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function createExperience(options: ExperienceOptions): Experience {
  const { canvas, projectTitles, terminalLines, reducedMotion, quality } = options;
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
  scene.background = new Color('#080a10');
  scene.fog = new Fog('#080a10', 7.5, 17);

  // A generated studio environment gives every standard material something to
  // reflect. Without it metals read as flat grey and the whole room looks
  // rendered rather than lit. Held well below 1 so it tints rather than fills.
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.28;
  pmrem.dispose();

  const camera = new PerspectiveCamera(38, 1, 0.1, 60);

  // Lighting -----------------------------------------------------------------
  scene.add(new AmbientLight(new Color('#3d4761'), 0.35));

  // Cool moonlight from the window side, deliberately weak: the room is lit by
  // its own screens and lamp, and the contrast between those is the mood.
  const key = new DirectionalLight(new Color('#93b0e8'), 0.42);
  key.position.set(4, 6, 4);
  key.castShadow = high;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0015;
  scene.add(key);

  const room = buildRoom({
    code: codeScreen(),
    projects: projectsScreen(projectTitles),
    terminal: terminalScreen(terminalLines),
  });
  scene.add(room.root);

  // Screen bounce and the warm desk lamp do most of the mood.
  const screenLight = new PointLight(palette.screenGlow, 3.1, 5.5, 2);
  screenLight.position.set(0, 1.15, -1.35);
  scene.add(screenLight);

  const lampLight = new PointLight(palette.lampWarm, 4.6, 4.5, 2);
  lampLight.position.set(...room.lampPosition);
  lampLight.castShadow = high;
  lampLight.shadow.mapSize.set(512, 512);
  lampLight.shadow.bias = -0.004;
  scene.add(lampLight);

  const accentLight = new PointLight(palette.accent, 1.6, 6, 2);
  accentLight.position.set(-2.4, 2.1, 0.6);
  scene.add(accentLight);

  // Rim from behind the desk lifts the monitor silhouettes off the back wall.
  const rim = new PointLight(new Color('#6f8cff'), 1.1, 7, 2);
  rim.position.set(0.4, 2.3, -2.0);
  scene.add(rim);

  // Post-processing ----------------------------------------------------------
  // Bloom is what sells lit screens in a dark room: without it an emissive
  // material is just a bright rectangle. Only on the high tier — it costs a
  // full-resolution pass plus the blur pyramid.
  const composer = high ? new EffectComposer(renderer) : null;
  let bloomPass: UnrealBloomPass | null = null;

  if (composer) {
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1),
      0.34, // strength — a glow around bright sources, not a haze over the room
      0.45, // radius
      0.82 // threshold — high, so screen *text* stays crisp and only true
      // highlights (the bulb, the brightest UI fills) bleed
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
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // Render loop --------------------------------------------------------------
  let frame = 0;
  let running = true;
  const clock = { t: 0 };

  const tick = () => {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    clock.t += 0.016;

    // Ease toward the scroll target so fast scrolling still reads smoothly.
    renderedProgress += (progress - renderedProgress) * 0.075;
    smoothed.x += (pointer.x - smoothed.x) * 0.05;
    smoothed.y += (pointer.y - smoothed.y) * 0.05;

    const scaled = renderedProgress * (VIEWS.length - 1);
    const index = Math.min(Math.floor(scaled), VIEWS.length - 2);
    const t = scaled - index;
    const from = VIEWS[index]!;
    const to = VIEWS[index + 1]!;
    const ease = t * t * (3 - 2 * t);

    const parallaxX = reducedMotion ? 0 : smoothed.x * 0.5;
    const parallaxY = reducedMotion ? 0 : -smoothed.y * 0.3;

    camera.position.set(
      lerp(from.position[0], to.position[0], ease) + parallaxX,
      lerp(from.position[1], to.position[1], ease) + parallaxY,
      lerp(from.position[2], to.position[2], ease)
    );
    camera.lookAt(
      lerp(from.target[0], to.target[0], ease),
      lerp(from.target[1], to.target[1], ease),
      lerp(from.target[2], to.target[2], ease)
    );

    if (!reducedMotion) {
      room.animated.leaves.rotation.y = Math.sin(clock.t * 0.25) * 0.06;
      room.animated.trinket.rotation.y += 0.006;
      room.animated.trinket.rotation.x = Math.sin(clock.t * 0.4) * 0.12;
      // Screens breathe very slightly, the way a real display flickers.
      screenLight.intensity = 3.1 + Math.sin(clock.t * 2.1) * 0.14;
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
      environment.texture.dispose();
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
