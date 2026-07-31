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
 * They are deliberately small and they get out of the way: hidden the moment
 * the visitor focuses an object or takes the robot, and switched off entirely
 * once enough of the room has been opened that the point is made. A permanent
 * scattering of pins over a rendered room would ruin the thing it is
 * advertising.
 */

/** After this many objects opened, the visitor knows the room is clickable. */
const LEARNED = 4;

export function Markers() {
  const focused = useEngine((state) => state.focused);
  const controlled = useEngine((state) => state.controlled);
  const entered = useEngine((state) => state.entered);
  const discovered = useEngine((state) => state.discovered);
  const hovered = useEngine((state) => state.hovered);
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
            object,
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
  // Fifteen is nothing on a desktop and is real work on a phone, where the
  // markers are also least useful — there is no hover there to reveal them.
  if (quality().tier === 'low') return null;
  if (!entered || focused !== null || controlled) return null;
  if (discovered.length >= LEARNED) return null;

  return (
    <>
      {pins.map(({ object, at }) => (
        <Html
          key={object.id}
          position={at}
          center
          // Scales with distance, so a marker across the room is smaller than
          // one on the desk — without this they all render at the same size
          // and the room reads flat.
          distanceFactor={6}
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
              focus(object.id);
            }}
            onPointerOver={() => hover(object.id)}
            onPointerOut={() => hover(null)}
            className="group flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-black/70 py-1 pl-1 pr-2.5 backdrop-blur-sm transition-colors hover:border-emerald-300/60 hover:bg-black/85"
          >
            <span className="relative flex size-2.5 shrink-0 items-center justify-center">
              <span className="absolute size-2.5 animate-ping rounded-full bg-emerald-300/40" />
              <span className="size-1.5 rounded-full bg-emerald-300" />
            </span>
            <span className="text-[11px] font-medium leading-none text-white/85">
              {object.label}
            </span>
            {/* The instruction, revealed on approach rather than shouted. A
              room with fifteen sentences floating in it is unreadable. */}
            <span
              className={
                hovered === object.id
                  ? 'max-w-[13rem] overflow-hidden text-[11px] leading-none text-white/50 transition-all duration-300'
                  : 'max-w-0 overflow-hidden text-[11px] leading-none text-white/50 transition-all duration-300'
              }
            >
              <span className="pl-1.5">{object.guide}</span>
            </span>
          </button>
        </Html>
      ))}
    </>
  );
}
