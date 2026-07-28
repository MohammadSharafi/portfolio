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
function Scene({ url, baked }: { url: string; baked: boolean }) {
  const reducedMotion = useReducedMotion();
  const [root, setRoot] = useState<Object3D | null>(null);
  const lampOn = useEngine((state) => state.lampOn);

  return (
    <>
      <CameraRig reducedMotion={reducedMotion} />

      {/* A baked room carries its own lighting, so lighting it again would be
        both wrong and wasted. The lit path gets a full rig instead. */}
      {baked ? null : (
        <>
          {/* The real-time rig mirrors the practicals in `add_lighting`, in
            glTF coordinates: Blender's (x, y, z) arrives here as (x, z, -y).

            It is worth keeping these two in agreement. This path is not a
            debug mode — it is what every visitor sees whenever the baked atlas
            is missing or its source hash does not match the shipped room, and
            a fallback lit by a completely different scheme means a stale bake
            changes what the room *is* rather than just how well it is lit. */}
          <SceneEnvironment intensity={0.16} />
          {/* Ambient is deliberately tiny. A high uniform term lights the
            inside of every corner as brightly as the middle of every wall,
            which is the single thing that makes a real-time room read as flat
            — the ambient-occlusion pass below carries the fill instead, and it
            knows where the corners are. */}
          <ambientLight color="#2a3454" intensity={0.11} />
          {/* Standing in for the wide, weak overhead source: the room has no
            ceiling, and without this the tops of the sofa and the shelf fall
            into the same darkness as the corners. */}
          <directionalLight
            color="#ffd9b8"
            intensity={1.15}
            position={[0.3, 6, -0.4]}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0006}
            shadow-normalBias={0.02}
          >
            <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 30]} />
          </directionalLight>
          {/* The LED strip behind the monitors, washing the back wall violet. */}
          <pointLight
            color="#9e4dff"
            intensity={13}
            distance={5.5}
            decay={2}
            position={[0.02, 1.34, 2.4]}
          />
          {/* Its cyan counterpart on the shelf wall. Two opposed colours across
            a room is what describes every surface's form by hue as well as by
            value. */}
          <pointLight
            color="#3daeff"
            intensity={16}
            distance={6.5}
            decay={2}
            position={[-2.7, 1.8, -0.3]}
          />
          {/* The monitors. Brightest thing in a room like this at night. */}
          <pointLight
            color="#99bdff"
            intensity={9}
            distance={4.5}
            decay={2}
            position={[0.05, 1.27, 2.0]}
          />
          {/* The desk lamp is a real light: switching it changes what the room
            is lit by, not just what one bulb looks like. */}
          <pointLight
            color="#ff9942"
            intensity={lampOn ? 7 : 0}
            distance={4}
            decay={2}
            position={[-1.02, 1.12, 2]}
          />
          {/* The floor lamp behind the sofa's far arm. */}
          <pointLight
            color="#ffb86e"
            intensity={6}
            distance={4.5}
            decay={2}
            position={[-1.22, 1.5, -1.85]}
          />
          {/* City light through the window. */}
          <pointLight
            color="#85aeff"
            intensity={4}
            distance={4}
            decay={2}
            position={[2.05, 1.7, 2.45]}
          />
        </>
      )}

      <RoomModel url={url} baked={baked} onReady={setRoot} />

      {root ? <Screens root={root} /> : null}
      {root ? <Animations root={root} /> : null}

      {/* Physics runs paused under reduced motion: objects tumbling of their
        own accord is exactly the kind of unrequested movement the preference
        is asking us not to produce. */}
      <Physics gravity={[0, -9.81, 0]} paused={reducedMotion} timeStep="vary">
        {root ? <Props root={root} /> : null}
      </Physics>

      <EffectComposer enableNormalPass={false}>
        {/* Ambient occlusion, and only on the lit path — a baked room already
          carries its own occlusion in the lightmap, and a second pass on top
          would darken every corner twice.

          This is the largest single difference between the real-time room and
          the baked one. Direct light plus an environment gives no contact
          shadow at all: every object floats a little, because the crease where
          it meets the floor is exactly as bright as the floor. */}
        {baked ? (
          <></>
        ) : (
          <N8AO aoRadius={0.55} intensity={2.4} distanceFalloff={0.8} quality="medium" halfRes />
        )}
        {/* Threshold above 1.0 on purpose.

          The baked atlas is tone-mapped into 0..1, so nothing drawn straight
          from it can ever reach this — which means bloom applies to the light
          sources and to nothing else. Those are the meshes `RoomModel` draws at
          `GLOW_GAIN` and the screens `Screens` lifts to 1.3.

          The previous 0.88 predates the atlas carrying any range at all: it had
          to reach down into ordinary lit surfaces to find anything to bloom, so
          the whiteboard, the paper and the pale walls all hazed. */}
        <Bloom intensity={0.9} luminanceThreshold={1.02} luminanceSmoothing={0.22} mipmapBlur />
        {/* Lighter than it was. The room now falls off into real darkness at
          the edges on its own, and a heavy vignette on top of that closed the
          corners up entirely. */}
        <Vignette eskil={false} offset={0.36} darkness={0.5} />
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
        shadows={!asset.baked}
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
          gl.toneMappingExposure = 1.15;
        }}
      >
        <Suspense fallback={null}>
          {asset.resolved ? <Scene url={asset.url} baked={asset.baked} /> : null}
        </Suspense>
      </Canvas>

      <Overlay />
    </div>
  );
}
