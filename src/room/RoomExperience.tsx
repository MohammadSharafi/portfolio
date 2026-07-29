import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { EffectComposer, Bloom, N8AO, Vignette } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, type Object3D } from 'three';
import { Physics } from '@react-three/rapier';
import { RoomModel } from './systems/RoomModel';
import { CameraRig } from './engine/CameraRig';
import { SceneEnvironment } from './systems/SceneEnvironment';
import { Screens } from './systems/Screens';
import { Props } from './systems/Props';
import { Animations } from './systems/Animations';
import { Overlay } from './ui/Overlay';
import { useRoomAsset } from './engine/useRoomAsset';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useEngine } from './engine/store';

/**
 * Scene manager: composes the room, its rig and its UI.
 *
 * Deliberately thin. Every system it mounts owns its own state through the
 * engine store, so this file stays a list of what exists rather than becoming
 * the place all the wiring accumulates.
 */
function Scene({
  url,
  lightmap,
  aging,
  intensity,
}: {
  url: string;
  lightmap: string | null;
  aging: string | null;
  intensity: number;
}) {
  const baked = lightmap !== null;
  const reducedMotion = useReducedMotion();
  const [root, setRoot] = useState<Object3D | null>(null);
  const lampOn = useEngine((state) => state.lampOn);

  return (
    <>
      <CameraRig reducedMotion={reducedMotion} />

      {/* The environment is the one thing a lightmap cannot replace.
        A lightmap is *diffuse* irradiance, and three.js spends it on
        `indirectDiffuse` alone. Metal has no diffuse term at all — its colour
        is entirely what it reflects — so a metal lit only by a lightmap
        renders black, and the room had seventeen such materials: the monitor
        arm, the chair post, the castors, the guitar frets, every drawer pull.
        They were not dark. They were unlit, and no amount of exposure was
        going to bring them back.
        So the probe stays mounted when baked — but it reflects the *room*, not
        the sky. `buildEnvironment` is a cold dome with a horizon band, which is
        right when the environment is doing the lighting and wrong once a
        lightmap has taken that job: what is left for the probe is specular, and
        specular is a reflection of the surroundings. A chrome drawer pull
        indoors at night reflects dark walls, a warm lamp and two bright
        monitors, not a blue sky — and handing it the sky put a faint cold cast
        on every metal and every gloss in the room. */}
      <SceneEnvironment intensity={baked ? 0.35 : 0.62} interior={baked} />

      {/* The rest of the rig is the lit room's business. A baked room carries
        its own direct and bounced light, so re-lighting it would double every
        shadow it already has. */}
      {baked ? null : (
        <>
          {/* Ambient is deliberately low. A high uniform term lights the inside
            of every corner as brightly as the middle of every wall, which is
            the single thing that makes a real-time room read as flat — the
            environment and the ambient-occlusion pass below carry the fill
            instead, and they both know where the corners are. */}
          <ambientLight color="#46536f" intensity={0.22} />
          <directionalLight
            color="#a8c2f0"
            intensity={2.6}
            position={[5, 7, -5]}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0006}
            shadow-normalBias={0.02}
          >
            <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 30]} />
          </directionalLight>
          {/* A dim warm bounce off the floor, opposite the key. Nothing in a
            room is lit from one side only. */}
          <directionalLight color="#ffb98a" intensity={0.5} position={[-4, 1.5, 4]} />
          {/* The desk lamp is a real light: switching it changes what the room
            is lit by, not just what one bulb looks like. */}
          <pointLight
            color="#ffb367"
            intensity={lampOn ? 9 : 0}
            distance={5}
            decay={2}
            position={[-1.02, 1.15, 2]}
          />
          <pointLight
            color="#6aa6ff"
            intensity={6}
            distance={5}
            decay={2}
            position={[0, 1.25, 1.9]}
          />
        </>
      )}

      <RoomModel
        url={url}
        lightmap={lightmap}
        aging={aging}
        intensity={intensity}
        onReady={setRoot}
      />

      {root ? <Screens root={root} /> : null}
      {root ? <Animations root={root} /> : null}

      {/* Physics runs paused under reduced motion: objects tumbling of their
        own accord is exactly the kind of unrequested movement the preference
        is asking us not to produce. */}
      <Physics gravity={[0, -9.81, 0]} paused={reducedMotion} timeStep="vary">
        {root ? <Props root={root} /> : null}
      </Physics>

      <EffectComposer enableNormalPass={false}>
        {/* Ambient occlusion at two very different scales, because the two
          paths are missing two different things.

          Unbaked, there is no occlusion at all: direct light plus an
          environment gives no contact shadow, so every object floats a little
          because the crease where it meets the floor is exactly as bright as
          the floor. That wants a wide radius doing the whole job.

          Baked, the lightmap has already resolved occlusion by path tracing
          it, and a second wide pass would darken every corner twice — which is
          why this used to be switched off entirely. But a 4096 atlas spread
          over an entire room lands somewhere near a centimetre per texel, and
          contact darkening lives below that: the millimetre of shadow where a
          chair castor touches the floor, where a book meets a shelf, where the
          bin sits on the boards. The lightmap cannot resolve it and the eye
          reads its absence as objects hovering.

          So the baked path gets a *small* radius at low strength — fine
          contact only, leaving every larger occlusion to the bake that already
          did it properly. */}
        {baked ? (
          <N8AO aoRadius={0.12} intensity={1.1} distanceFalloff={0.35} quality="medium" halfRes />
        ) : (
          <N8AO aoRadius={0.55} intensity={2.4} distanceFalloff={0.8} quality="medium" halfRes />
        )}
        {/* High threshold on purpose: the room has a lot of small bright
          sources, and a lower one turns their combined bloom into fog. */}
        <Bloom intensity={0.5} luminanceThreshold={0.88} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.72} />
      </EffectComposer>

      <AdaptiveDpr pixelated />
      <Preload all />
    </>
  );
}

export function RoomExperience() {
  const asset = useRoomAsset();

  return (
    <div className="fixed inset-0 bg-[#05070c]">
      <Canvas
        // Decorative: everything it renders is also a button in the overlay.
        aria-hidden="true"
        shadows={asset.lightmap === null}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{
          fov: 34,
          near: 0.1,
          far: 200,
          // Close to HOME_STOP, so the first frame the visitor sees is roughly
          // where the rig is about to ease it to rather than a jump.
          position: [6.55, 4.9, -6.75],
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          // 1.15, not higher. three.js's ACES divides by 0.6 before the curve, which
          // makes it land close to `tonemap.py`'s Narkowicz fit at zero stops —
          // so this is very nearly the exposure the bake and the Cycles previews
          // are judged at, and the browser and the reference render can be
          // compared directly. Raising it to hide a dark room hides the contrast
          // along with it.
          gl.toneMappingExposure = 1.15;
        }}
      >
        <Suspense fallback={null}>
          {asset.resolved ? (
            <Scene
              url={asset.url}
              lightmap={asset.lightmap}
              aging={asset.aging}
              intensity={asset.intensity}
            />
          ) : null}
        </Suspense>
      </Canvas>

      <Overlay />
    </div>
  );
}
