import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { EffectComposer, Bloom, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
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
      <SceneEnvironment intensity={baked ? 0.35 : 0.3} interior={baked} />

      {/* The rest of the rig is the lit room's business. A baked room carries
        its own direct and bounced light, so re-lighting it would double every
        shadow it already has.

        This is the fallback, and it has to *look like* the bake rather than
        merely stand in for it. It is what a visitor sees whenever the lightmap
        does not match the model — which, during any stretch of modelling work,
        is most of the time. It used to be a single cold key with a cold fill,
        which against the pale walls blew the room out to one flat blue-white
        and looked nothing like the room the bake produces.

        So it mirrors `add_lighting` in build_room.py, which no longer has an
        overhead at all: two LED coves, a desk lamp, a floor lamp, the monitors
        and the window, with a dim cool bounce standing in for the ceiling.
        Two rigs, one art direction. */}
      {baked ? null : (
        <>
          {/* Barely there, and cool. This stands in for the light the ceiling
            returns after the practicals have thrown their share at it — which
            in a room lit by two LED coves and a lamp is very little, and blue.
            It was 0.55 and warm, which filled every shadow to the same value as
            everything else and left the room with no shape in it. */}
          <ambientLight color="#232a3a" intensity={0.16} />

          {/* Not a key any more — the overhead is off. This is the same bounce
            term from above given a direction so surfaces facing up read a
            little brighter than surfaces facing down, which is what bounce
            does. It still casts the room's one shadow map: a second
            shadow-caster in a room this size reads as two suns. */}
          <directionalLight
            color="#8f9ec4"
            intensity={0.42}
            position={[0.6, 6.2, 1.4]}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0006}
            shadow-normalBias={0.02}
          >
            <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 30]} />
          </directionalLight>

          {/* The two coves, as light rather than as geometry. The strips
            themselves are emissive in the model and would glow without these —
            and glowing without lighting the wall behind them is exactly what
            makes a strip read as a sticker. Cyan down the shelf wall, magenta
            along the window wall, matching `build_led_strips`. */}
          <directionalLight color="#47dbff" intensity={0.62} position={[-6.5, 2.6, 0.4]} />
          <directionalLight color="#ff4ab4" intensity={0.5} position={[0.4, 2.4, -6.2]} />

          {/* The desk lamp, and it has to be the brightest thing in the room by
            a long way — everything above this is cold, and without a warm
            centre to measure them against they stop being atmosphere and become
            a colour cast. A real switch, too: turning it off changes what the
            room is lit by. */}
          <pointLight
            color="#ff9a42"
            intensity={lampOn ? 30 : 0}
            distance={3.4}
            decay={2}
            position={[0.8, 1.1, 2.22]}
          />
          {/* The floor lamp, by the shelf, so the lounge end is not simply the
            part of the room the desk lamp did not reach. */}
          <pointLight
            color="#ffb877"
            intensity={18}
            distance={3.8}
            decay={2}
            position={[-1.22, 1.44, -1.85]}
          />
          {/* The monitors, cold and close. */}
          <pointLight
            color="#5a93ff"
            intensity={5}
            distance={2.6}
            decay={2}
            position={[0, 1.1, 2.24]}
          />
          {/* City glow at the window: the coldest thing in the room. */}
          <pointLight
            color="#6f93e0"
            intensity={4}
            distance={4.2}
            decay={2}
            position={[2.05, 1.7, 2.42]}
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
        {/* The room had no tone mapping at all, and it took a long time to see.
          `EffectComposer` sets `gl.toneMapping` to `NoToneMapping` on mount,
          because postprocessing expects to own the view transform itself — so
          the `ACESFilmicToneMapping` set on the renderer below was overwritten
          before it ever drew a frame, and `toneMappingExposure` moved nothing.
          The scene was rendering linear and being written out with only the
          sRGB transfer over it.
          That is most of why the room read as flat and lifeless no matter what
          the lighting did. There was no shoulder, so anything above 1.0 clipped
          instead of rolling off, and no toe, so the shadows had no separation
          left in them. It also invalidated the whole argument for matching the
          browser's exposure to `tonemap.py` — the two could not have agreed,
          because one end was not applying a curve. */}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        {/* After the curve, deliberately. A vignette is a lens artefact, and a
          lens darkens the image it forms rather than the light entering it. */}
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
          // Grading, and it has to be a large number.
          //
          // This is the exposure of the *composer's* tone mapping, not the
          // renderer's — see the ToneMapping effect above, which is what
          // actually applies the curve. The room is a night scene lit by
          // practicals, so the light physically arriving at most surfaces is a
          // small fraction of a stop; graded at 1.0 it is technically faithful
          // to the Cycles reference and reads on a screen as a dark rectangle
          // with some furniture implied in it.
          //
          // A photograph of this room would be taken at a long exposure for
          // exactly the same reason. Matching the reference render's exposure
          // was a mistake dressed up as rigour: the reference is a physically
          // correct picture of a dim room, and the site needs a *legible* one.
          gl.toneMappingExposure = 1.25;
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
