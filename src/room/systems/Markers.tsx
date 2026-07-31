import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { useEngine } from '../engine/store';
import { roomObjects } from '../data/objects';
import { boundsFor } from '../data/framing';
import { quality } from '../engine/quality';

/**
 * Labels that live in the room rather than over it.
 *
 * The room's central problem as a portfolio is that it looks like a picture.
 * Nothing about a rendered desk says the CV standing on it can be opened, and
 * a visitor who does not think to click furniture will read the whole site as
 * a screensaver and leave. The old answer was one line of grey text at the top
 * of the frame — "Click anything in the room" — which is both easy to miss and
 * hard to act on, because it does not say *which* things.
 *
 * So each interactive object gets a marker pinned to its own bounding box in
 * world space. They sit in the scene, so they carry the room's perspective and
 * parallax: the marker over the bookshelf is genuinely across the room, and
 * moving the camera moves it the way it moves the shelf. That is the whole
 * argument for doing this in 3D instead of drawing hotspots on a flat overlay
 * — an overlay would have to be re-solved every time the camera breathes, and
 * would still read as chrome laid on top of a photograph.
 *
 * They persist into walk mode, which they did not at first. Hiding them there
 * had a reason — the follow camera sits 12 cm off the boards and the labels
 * are the only thing in the frame not made of room — but it got the trade
 * backwards: down at robot height is exactly where a visitor is *most* lost,
 * with the desk looming like a building and no way to tell which of its edges
 * is worth walking to. Signposts belong where navigation is hard.
 */

export function Markers() {
  const focused = useEngine((state) => state.focused);
  const entered = useEngine((state) => state.entered);
  const hovered = useEngine((state) => state.hovered);
  const controlled = useEngine((state) => state.controlled);
  const nearGuitar = useEngine((state) => state.nearGuitar);
  const focus = useEngine((state) => state.focus);
  const hover = useEngine((state) => state.hover);

  // Anchored to the top of each measured box, so a marker sits above its
  // object rather than inside it — and follows if the object ever moves.
  const pins = useMemo(
    () =>
      roomObjects
        .filter((object) => object.marker !== undefined)
        .map((object) => {
          const bounds = boundsFor(object.id, object.framing);
          return {
            key: object.id,
            label: object.label,
            guide: object.guide,
            id: object.id,
            at: [bounds.center[0], bounds.max[1] + object.marker!.lift, bounds.center[2]] as [
              number,
              number,
              number,
            ],
          };
        }),
    []
  );

  // `Html` is a DOM node per marker with its transform written every frame.
  // A dozen is nothing on a desktop and is real work on a phone, where the
  // markers are also least useful — there is no hover there to reveal them.
  if (quality().tier === 'low') return null;
  // Hidden only while a panel is open, where they would sit on top of the
  // thing the visitor has already chosen to look at.
  if (!entered || focused !== null) return null;

  return (
    <>
      {pins.map((pin) => (
        <Html
          key={pin.key}
          position={pin.at}
          center
          // Scales with distance, so a marker across the room is smaller than
          // one on the desk — without this they all render at the same size
          // and the room reads flat.
          //
          // Much smaller while driving. The factor sets an apparent size at a
          // reference distance, and the two modes view the room from utterly
          // different ones: the establishing camera sits ten metres out, the
          // follow camera forty centimetres behind a robot the height of a
          // coffee cup. Carrying the wide-shot number into walk mode made the
          // desk labels taller than the desk.
          distanceFactor={controlled ? 2.1 : 6}
          zIndexRange={[20, 0]}
          // Cheap: no occlusion render target, no raycast per frame. The room
          // is seen from outside its walls, so nothing is ever behind them.
          occlude={false}
        >
          <button
            type="button"
            // The canvas is aria-hidden and these live inside it, so they are
            // decorative duplicates of the index's buttons rather than a
            // second, competing set of controls for a screen reader.
            aria-hidden="true"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              focus(pin.id);
            }}
            onPointerOver={() => hover(pin.id)}
            onPointerOut={() => hover(null)}
            className="group flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-black/70 py-1 pl-1 pr-2.5 backdrop-blur-sm transition-colors hover:border-emerald-300/60 hover:bg-black/85"
          >
            <span className="relative flex size-2.5 shrink-0 items-center justify-center">
              <span className="absolute size-2.5 animate-ping rounded-full bg-emerald-300/40" />
              <span className="size-1.5 rounded-full bg-emerald-300" />
            </span>
            <span className="text-[11px] font-medium leading-none text-white/85">{pin.label}</span>
            {/* The instruction, revealed on approach rather than shouted. A
              room with a dozen sentences floating in it is unreadable. */}
            <span
              className={
                hovered === pin.id
                  ? 'max-w-[13rem] overflow-hidden text-[11px] leading-none text-white/50 transition-all duration-300'
                  : 'max-w-0 overflow-hidden text-[11px] leading-none text-white/50 transition-all duration-300'
              }
            >
              <span className="pl-1.5">{pin.guide}</span>
            </span>
          </button>
        </Html>
      ))}

      <GuitarMarker controlled={controlled} near={nearGuitar} />
    </>
  );
}

/**
 * The guitar's marker, which is not like the others.
 *
 * Every other marker points at an entry in the object registry and opens a
 * panel. The guitar is not in that registry at all: it is a *walk-mode*
 * interaction, reached by driving the robot up to it and pressing E, and there
 * is no camera stop or panel behind it. So it gets a label that describes the
 * thing you actually have to do, and changes it once you are close enough to
 * do it — which is the only honest way to advertise an action whose
 * availability depends on where you are standing.
 *
 * Its position is hard-coded from the model's own guitar rather than measured
 * through `objectBounds`, because that file only covers `ix_` objects. The
 * number matches the one `Character` reads out of the scene graph; the *old*
 * numbers in the collision list and on the minimap did not, and pointed at the
 * opposite corner of the room.
 */
const GUITAR_AT: [number, number, number] = [-2.86, 1.32, -2.3];

function GuitarMarker({ controlled, near }: { controlled: boolean; near: boolean }) {
  return (
    <Html
      position={GUITAR_AT}
      center
      distanceFactor={controlled ? 2.1 : 6}
      zIndexRange={[20, 0]}
      occlude={false}
    >
      <div
        aria-hidden="true"
        className={
          near
            ? 'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-300/70 bg-emerald-400/20 py-1 pl-1 pr-2.5 backdrop-blur-sm'
            : 'flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-black/70 py-1 pl-1 pr-2.5 backdrop-blur-sm'
        }
      >
        <span className="relative flex size-2.5 shrink-0 items-center justify-center">
          <span className="absolute size-2.5 animate-ping rounded-full bg-emerald-300/40" />
          <span className="size-1.5 rounded-full bg-emerald-300" />
        </span>
        <span className="text-[11px] font-medium leading-none text-white/85">Guitar</span>
        <span className="text-[11px] leading-none text-white/50">
          {near ? (
            <span className="pl-1 text-emerald-200">press E to play</span>
          ) : controlled ? (
            <span className="pl-1">walk over to play it</span>
          ) : (
            <span className="pl-1">it plays music</span>
          )}
        </span>
      </div>
    </Html>
  );
}
