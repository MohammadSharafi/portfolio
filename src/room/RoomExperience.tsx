import { Suspense, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import {
  ChromaticAberration,
  EffectComposer,
  Bloom,
  N8AO,
  Noise,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { ACESFilmicToneMapping, type Object3D } from 'three';
import { Physics } from '@react-three/rapier';
import { RoomModel } from './systems/RoomModel';
import { CameraRig } from './engine/CameraRig';
import { SceneEnvironment } from './systems/SceneEnvironment';
import { Screens } from './systems/Screens';
import { Props } from './systems/Props';
import { Animations } from './systems/Animations';
import { Atmosphere } from './systems/Atmosphere';
import { Character } from './systems/Character';
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
/**
 * The camera's exposure, chosen per lighting path.
 *
 * The bake is a physically honest picture of a dim room, and printed at the
 * fallback's 1.25 it reads as a dark rectangle with furniture implied in it —
 * the same finding as the wide Cycles preview. A photographer in this room
 * would simply hold the shutter open longer; this is that decision. The
 * fallback keeps its own grade: its lights were tuned at 1.25 and pushing
 * them through 2.05 would clip every warm core in the frame.
 */
function Exposure({ baked }: { baked: boolean }) {
  const gl = useThree((state) => state.gl);
  gl.toneMappingExposure = baked ? 2.05 : 1.25;
  return null;
}

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
      <Exposure baked={baked} />

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
          <ambientLight color="#1d2331" intensity={0.15} />

          {/* The poor man's global illumination. A hemisphere light with a
            warm ground and a cool sky is what one bounce off this room's
            surfaces actually sums to — lamplight coming back up off the rug
            and boards, window-blue coming down off the ceiling. It is dim on
            purpose: its job is to tie the practicals into one room, put a
            breath of warmth on the undersides the lamps cannot reach, and
            stop any object reading as lit by its own private source. */}
          {/* Lifted from 0.28 to 0.40. The bounce is what keeps the corners
            the practicals never reach from going to flat black — readable,
            not lit. Raising the directional or the practicals instead would
            have cost the night its contrast; a hemisphere adds floor and
            leaves every highlight where it was. */}
          <hemisphereLight args={['#232a3d', '#503823', 0.4]} />

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

          {/* The strips, as light rather than as geometry.
            They are emissive in the model and glow without these — and glowing
            without lighting anything is exactly what makes a strip read as a
            sticker stuck on the furniture. Matching `build_led_strips`: cyan
            under the bookshelf's shelves, magenta under the desk's front edge.

            Point lights placed at the runs rather than directionals, because
            these are short strips on furniture and their whole character is
            that the light falls off within a metre. A directional would light
            the entire room the colour of a 30 cm strip.

            The under-desk run is a *spot*, pointing straight down. A point
            light there sits 8 cm below the desk top and radiates into a sphere,
            so most of its output went straight up through a desk that does not
            cast a shadow for it — the room flooded magenta and a hotspot
            appeared on the desk surface, lit from underneath by the strip
            beneath it. A cone only emits where a strip in a channel emits. */}
          {/* 6.5, down from 9. At 9 the pale books on the lit shelves clipped
            to white where the strip's throw and its emissive glow stacked —
            the shelf close-up was a row of glowing erasers.

            A shadow-casting spot into the case, not a point. What made the
            desk lamp read as real was never its colour — it was that the mug
            and the headphones *blocked* it, and the shelf light blocked
            nothing: every book was lit as if the ones beside it were not
            there. Aimed at the case, full penumbra, the books now shade each
            other and the shelves shade the wall behind them. */}
          <spotLight
            color="#47dbff"
            intensity={4.2}
            distance={1.3}
            decay={2}
            angle={1.15}
            penumbra={1}
            position={[-2.72, 0.9, -0.95]}
            target-position={[-3.3, 0.5, -0.95]}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.015}
            shadow-camera-near={0.1}
            shadow-camera-far={3}
          />
          {/* The under-desk run, and the reason the desk looks like it is
            floating. This is the single most recognisable thing in every
            reference photograph of a setup like this, and the browser had the
            emissive strip without the light, so it had the line and not the
            effect.

            Casting, so the desk's legs, the bin and the chair base print
            magenta-edged shadows on the boards instead of hovering in an
            even wash. */}
          <spotLight
            color="#ff4ab4"
            intensity={2.2}
            distance={0.9}
            decay={2}
            angle={1.35}
            penumbra={1}
            position={[0.05, 0.7, 2.05]}
            target-position={[0.05, 0, 2.05]}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.015}
            shadow-camera-near={0.1}
            shadow-camera-far={2.5}
          />

          {/* The desk lamp: the brightest thing in the room by a long way,
            because everything above this is cold and without a warm centre to
            measure them against they stop being atmosphere and become a colour
            cast. A real switch, too — turning it off changes what the room is
            lit by.

            A spot rather than a point, matching `add_lighting`. A point light
            radiates into a sphere, so its pool has no edge and nothing in the
            frame says where the light came from; a shade throws a cone, and
            the cone's edge on the desk is the evidence of the fixture. */}
          {/* 16, down from 19. With the spot now starting at the shade's
            mouth it sits ~10 cm closer to the desk than it used to, and the
            inverse-square term turned that into a scorched core: the mug and
            the headphones clipped to white where the pool was brightest. */}
          <spotLight
            color="#ff9a42"
            intensity={lampOn ? 17 : 0}
            distance={3.4}
            decay={2}
            angle={0.74}
            // Full penumbra. A shade is a diffuser with thickness, not an
            // aperture in a sheet of card, so its pool has no line anywhere —
            // brightness just arrives on the desk and fades out. At 0.85
            // there was still a readable rim, and a rim is what makes a pool
            // look projected onto the table instead of falling on it.
            penumbra={1}
            // At the shade's *mouth*, on the shade's own axis — Blender aims
            // the cone along (0.3, -0.42, 1.0) in build_lamp, so the light
            // leaves along (-0.3, +0.42, -1.0), which in glTF space is
            // (-0.267, -0.889, -0.373). The spot used to sit up at the head
            // aiming on a much shallower line, so the cone visibly started
            // above the fixture and its pool sat off the shade's axis: the
            // head faced one way and the light fell the other.
            position={[0.785, 1.06, 2.2]}
            target-position={[0.7, 0.79, 2.09]}
            // The lamp casts, and this is most of what was missing from the
            // desk. Every prop on it — the mug, the pen cup, the headphones,
            // the CV — sat in a warm pool with no shadow under it, which is the
            // one cue that says an object is resting on a surface rather than
            // pasted onto it. A light this close and this small throws sharp,
            // short, high-contrast shadows, and their absence is why the desk
            // read as flat no matter how the pool was tuned.
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.012}
            shadow-camera-near={0.15}
            shadow-camera-far={4}
          />
          {/* The floor lamp, by the shelf, so the lounge end is not simply the
            part of the room the desk lamp did not reach. */}
          {/* The floor lamp, in two parts, because one point light was doing
            two different jobs badly.

            The casting cone is the lamp the eye believes: a wide, fully
            feathered spot dropping from the shade, so the sofa's arm, the
            coffee table and the speaker all print soft shadows on the rug the
            way the mug does under the desk lamp. That blocking is the whole
            reason the desk lamp reads as real, and the lounge had none of it.

            The dim point is what a paper shade also does — leak a little
            light in every direction. No shadows on it: it exists to keep the
            shelf end and the wall from going black, and at this intensity it
            cannot flatten the cone's shadows. Together they replace the old
            single 15-intensity point that lit everything and shadowed
            nothing, and blew the shade white from its own outside. */}
          {/* From the shade's mouth (the cone opens downward, so the light
            starts at its bottom edge, not its centre), and at 0.92 rad the
            pool on the rug has a visible gradient — at 1.15 the cone was so
            wide the lounge read as evenly lit and nothing said a lamp was
            doing it. */}
          {/* Warmer than the desk lamp's throw, not cooler — a paper shade
            over a tungsten bulb is the warmest source a room like this has.
            And *off the pole's axis*, tilted a few degrees: with the origin
            exactly on the axis the pole ran down the hottest line of the
            cone and bleached white along its whole length, which is the
            glowing-stick artefact the screenshots kept showing. From 12 cm
            aside, the pole catches a warm graze at the top and falls off,
            which is what a pole under a shade actually does. */}
          <spotLight
            color="#ffa763"
            intensity={9}
            distance={4.2}
            decay={2}
            angle={1.15}
            penumbra={1}
            position={[-1.22, 1.42, -1.85]}
            target-position={[-1.22, 0, -1.85]}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.015}
            shadow-camera-near={0.2}
            shadow-camera-far={4.5}
          />
          {/* The radial term is the lamp. A fabric shade glows in every
            direction, and it is this light — not the down-cone — that puts
            the warm gradient on the sofa's near arm and cushions, brightest
            where they face the shade and falling away around the curve. Held
            15 cm off the pole so the metal catches a warm graze (the
            reference photos show exactly that) instead of burning white at
            zero distance. The down-spot above is now just the soft pool on
            the rug and the soft shadows the furniture casts out of it. */}
          {/* Lower and a touch dimmer: at shade height this light printed
            its own hot patch on one side of the cloth — a lamp shade must be
            lit from inside itself, not from a point floating beside it. At
            chest height it feeds the sofa and the pole and leaves the shade
            to its own glow. */}
          <pointLight
            color="#ffa763"
            intensity={3.4}
            distance={3.4}
            decay={2}
            position={[-0.96, 1.12, -1.78]}
          />
          {/* The strip controller's red standby LED under the desk's front
            lip, as a light and not only as an emissive chip. Tiny throw on
            purpose: a pilot LED tints half a metre of board and nothing
            else — but it sits on the one under-desk surface the room's
            cameras actually see, so the red point and its faint pool read
            from the chair view. */}
          {/* No light for the standby LED any more — the emissive chip in the
            model is the indicator. Even at 0.45 the throw painted one red
            corner on the drawer unit, and a pilot lamp that paints furniture
            is a darkroom bulb. */}
          {/* The monitors, cold and close — and *forward*. As a point light
            this shone through its own monitors (nothing here casts for it)
            and painted a two-metre radial bloom on the wall behind them,
            far brighter than two screens could ever throw backwards. Screens
            emit where they face: a cone at the keyboard and the sitter, and
            the wall stays out of it entirely. */}
          <spotLight
            color="#5a93ff"
            intensity={5}
            distance={2.6}
            decay={2}
            angle={1.1}
            penumbra={1}
            position={[0, 1.15, 2.1]}
            target-position={[0, 0.55, 1.3]}
          />
          {/* What the light bar actually does to the wall: a short, contained
            wash dropping from the bar, gone within a metre. This replaces the
            wall's share of the old radial glow with one that visibly belongs
            to the fixture above it. */}
          <spotLight
            color="#8f7bff"
            intensity={3}
            distance={1.6}
            decay={2}
            angle={1.0}
            penumbra={1}
            position={[0, 1.26, 2.45]}
            target-position={[0, 0.85, 2.54]}
          />
          {/* City glow at the window: the coldest thing in the room. Pulled
            40 cm off the glass, because at z=2.42 it sat exactly on the
            window's centre mullion — a light source zero millimetres from a
            painted bar turns it into a white-hot sabre, which is precisely
            what the window photo showed. Off the plane, the frame is lit
            like the rest of the sill instead of from inside itself. */}
          <pointLight
            color="#6f93e0"
            intensity={3.5}
            distance={4.2}
            decay={2}
            position={[2.05, 1.62, 1.98]}
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

      {/* Dust in the air, lit by whatever the room is lit by. Mounted on
        both paths — the bake owns surfaces, never the air. */}
      <Atmosphere />

      {root ? <Screens root={root} /> : null}
      {root ? <Animations root={root} /> : null}

      {/* Physics runs paused under reduced motion: objects tumbling of their
        own accord is exactly the kind of unrequested movement the preference
        is asking us not to produce. */}
      <Physics gravity={[0, -9.81, 0]} paused={reducedMotion} timeStep="vary">
        {root ? <Props root={root} /> : null}
        {/* The robot lives inside the physics world so its capsule can shove
          the props; visually it is driven directly, so it still walks when
          reduced motion pauses the solver. */}
        {root ? <Character root={root} /> : null}
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
        {/* Tighter than it was, and it had to be.
          The strips are authored at emissive strengths of 7 to 16 so that
          Cycles gets a real emitter to bounce light off. Three.js hands those
          straight to the shader, so at a 0.88 threshold every strip in the room
          sat far into the bloom's range: the monitor's backlight came out as a
          clipped white line with a halo the size of the wall behind it, with no
          colour left in either. A strip that blooms white is a fluorescent
          tube. */}
        <Bloom intensity={0.34} luminanceThreshold={0.96} luminanceSmoothing={0.22} mipmapBlur />
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
        {/* The lens's own faults, applied after the curve where a lens
          applies them. A rendered image with none of them is *too* clean —
          every real photograph of a room like this carries a breath of grain
          and a fringe of colour at its high-contrast edges, and their absence
          is one of the quiet tells of CG. Both are set well below the level
          of being seen; they are felt as texture. */}
        <ChromaticAberration offset={[0.0005, 0.0003]} />
        <Noise premultiply opacity={0.055} />
        {/* A vignette is a lens artefact, and a lens darkens the image it
          forms rather than the light entering it. */}
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
          // 200, and it stays there. Tightening this to 24 to buy depth
          // precision for the keycap legends looked reasonable and broke the
          // room: the city outside the window and the sky occluder sit far
          // beyond the walls, so the far plane cut through the scene and the
          // depth-based passes had the ground pulled out from under them.
          // The legends were fixed properly instead, by giving them a
          // quarter-millimetre of real clearance in the model.
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
