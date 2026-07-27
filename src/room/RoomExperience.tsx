import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { ACESFilmicToneMapping } from 'three';
import { RoomModel } from './systems/RoomModel';
import { CameraRig } from './engine/CameraRig';
import { SceneEnvironment } from './systems/SceneEnvironment';
import { Overlay } from './ui/Overlay';
import { useRoomAsset } from './engine/useRoomAsset';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Scene manager: composes the room, its rig and its UI.
 *
 * Deliberately thin. Every system it mounts owns its own state through the
 * engine store, so this file stays a list of what exists rather than becoming
 * the place all the wiring accumulates.
 */
function Scene({ url, baked }: { url: string; baked: boolean }) {
  const reducedMotion = useReducedMotion();

  return (
    <>
      <CameraRig reducedMotion={reducedMotion} />

      {/* A baked room carries its own lighting, so lighting it again would be
        both wrong and wasted. The lit path gets a full rig instead. */}
      {baked ? null : (
        <>
          <SceneEnvironment intensity={0.45} />
          <ambientLight color="#4a5878" intensity={0.6} />
          <directionalLight
            color="#93b0e8"
            intensity={1.9}
            position={[5, 7, -5]}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0009}
          >
            <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 30]} />
          </directionalLight>
          <pointLight color="#ffb367" intensity={9} distance={5} decay={2} position={[-1.02, 1.15, 2]} />
          <pointLight color="#6aa6ff" intensity={6} distance={5} decay={2} position={[0, 1.25, 1.9]} />
        </>
      )}

      <RoomModel url={url} baked={baked} />

      <EffectComposer enableNormalPass={false}>
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
        shadows={!asset.baked}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 34, near: 0.1, far: 200, position: [5.4, 4.2, -5.6] }}
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
