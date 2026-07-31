import { useEffect, useRef } from 'react';
import { Flame, Hand } from 'lucide-react';
import { useEngine } from '../engine/store';
import { isTouch, resetTouchInput, touchInput } from '../engine/touchInput';
import { roomObjectById } from '../data/objects';

/**
 * The room's controls, for a thumb.
 *
 * Mounted only on touch devices, and only while driving. On a desktop these
 * would be clutter over a scene; on a phone they are the difference between a
 * playable room and a robot that cannot be moved at all.
 *
 * The layout is the one every player already knows without being told: motion
 * under the left thumb, actions under the right, both low enough to reach
 * one-handed and inset far enough from the edges to clear a home indicator and
 * the browser's own swipe gestures. Everything carries `data-room-ui`, which is
 * how the look-drag handler in `Character` knows a gesture belongs to a control
 * and not to the camera — without that, every push of the stick would also
 * swing the view.
 *
 * The stick writes straight into `touchInput` on the pointer event rather than
 * through React state. A stick updates continuously while held, and a store
 * write per move event would re-render this tree dozens of times a second to
 * move a knob 40 pixels; the knob's transform is set on the node directly for
 * the same reason the minimap's marker is.
 */

/** How far the knob travels, in pixels, before the axis reads full. */
const RADIUS = 46;
/** Below this fraction of the radius, the stick reads as centred. A thumb
 *  resting on a stick is never quite still, and without a dead zone the robot
 *  creeps. */
const DEAD_ZONE = 0.16;

export function TouchControls() {
  const controlled = useEngine((state) => state.controlled);
  const focused = useEngine((state) => state.focused);
  const nearby = useEngine((state) => state.nearby);
  const nearGuitar = useEngine((state) => state.nearGuitar);
  const musicOpen = useEngine((state) => state.musicOpen);
  const focus = useEngine((state) => state.focus);
  const setMusicOpen = useEngine((state) => state.setMusicOpen);

  if (!isTouch || !controlled || focused !== null) return null;

  const nearbyObject = nearby ? roomObjectById.get(nearby) : undefined;
  const canAct = nearGuitar || nearbyObject !== undefined;

  const act = () => {
    if (nearGuitar) setMusicOpen(!musicOpen);
    else if (nearby) focus(nearby);
  };

  return (
    <>
      <Stick />

      {/* Actions, right thumb. */}
      <div
        data-room-ui
        className="pointer-events-auto absolute bottom-8 right-6 flex touch-none select-none flex-col items-center gap-3"
        style={{ touchAction: 'none' }}
      >
        {/* Shown only when there is something to do, so the button never
          teaches a visitor that pressing it does nothing. */}
        {canAct ? (
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              act();
            }}
            className="flex size-[68px] flex-col items-center justify-center gap-0.5 rounded-full border border-emerald-300/50 bg-emerald-400/20 text-emerald-100 backdrop-blur-md active:bg-emerald-400/35"
          >
            <Hand className="size-5" aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">
              {nearGuitar ? (musicOpen ? 'Close' : 'Play') : 'Open'}
            </span>
          </button>
        ) : null}

        {/* Thrusters. Held, not toggled — the fuel budget only means something
          if holding it is a decision the thumb keeps making. */}
        <button
          type="button"
          aria-label="Hold to fly"
          onPointerDown={(event) => {
            event.preventDefault();
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
            touchInput.thrust = true;
          }}
          onPointerUp={() => {
            touchInput.thrust = false;
          }}
          onPointerCancel={() => {
            touchInput.thrust = false;
          }}
          onPointerLeave={() => {
            touchInput.thrust = false;
          }}
          className="flex size-[84px] flex-col items-center justify-center gap-1 rounded-full border border-white/20 bg-white/10 text-white/85 backdrop-blur-md active:border-amber-300/60 active:bg-amber-400/25"
        >
          <Flame className="size-6" aria-hidden="true" />
          <span className="text-[10px] font-medium leading-none">Fly</span>
        </button>
      </div>
    </>
  );
}

/**
 * The movement stick.
 *
 * A separate component purely so that its effect fires at the right time, and
 * that is worth spelling out because the first version silently did nothing.
 * `TouchControls` returns `null` until the visitor is driving, so on first
 * mount there is no stick in the DOM — and an effect with an empty dependency
 * array runs exactly once, then, against a ref that is still null. It bailed
 * out, never attached a single listener, and never ran again when the controls
 * finally appeared. The stick rendered perfectly and did nothing at all.
 *
 * Mounting it only when it is shown makes its own mount the moment its effect
 * runs, which is the only arrangement where the two cannot disagree.
 */
function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const node = base.current;
    if (!node) return;

    const write = (dx: number, dy: number) => {
      const distance = Math.hypot(dx, dy);
      const clamped = Math.min(1, distance / RADIUS);
      const scale = distance > 0 ? (clamped * RADIUS) / distance : 0;
      if (knob.current) {
        knob.current.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
      }

      if (clamped < DEAD_ZONE) {
        touchInput.drive = 0;
        touchInput.steer = 0;
        return;
      }
      // Rescaled past the dead zone so the first responsive position is a
      // gentle walk rather than a jump to 16% speed.
      const live = (clamped - DEAD_ZONE) / (1 - DEAD_ZONE);
      const nx = dx / (distance || 1);
      const ny = dy / (distance || 1);
      // Screen up is negative y and means forward; screen right is positive x
      // and means turn right, which is negative steer in the room's convention.
      touchInput.drive = -ny * live;
      touchInput.steer = -nx * live;
    };

    const centre = () => {
      const box = node.getBoundingClientRect();
      // The stick centres on the *base*, not on where the thumb landed, so the
      // control has a fixed neutral the visitor can find without looking.
      origin.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };

    const down = (event: PointerEvent) => {
      if (active.current !== null) return;
      active.current = event.pointerId;
      // Origin first, capture second, and the capture guarded.
      //
      // The order is not cosmetic. `setPointerCapture` throws if the pointer id
      // is not currently active — which is exactly what happens for a synthetic
      // event, and can happen for a real one that ended between dispatch and
      // handling. Capturing first meant the throw skipped `centre()`, leaving
      // the origin at (0, 0): every offset was then measured from the top-left
      // of the window, so a thumb resting on the stick read as a full push
      // down and to the right, and the robot walked backwards on touch.
      centre();
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // Without capture the stick still works while the thumb stays over it;
        // it only loses the ability to track a thumb dragged off the control.
      }
      write(event.clientX - origin.current.x, event.clientY - origin.current.y);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== active.current) return;
      write(event.clientX - origin.current.x, event.clientY - origin.current.y);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== active.current) return;
      active.current = null;
      touchInput.drive = 0;
      touchInput.steer = 0;
      if (knob.current) knob.current.style.transform = 'translate(0px, 0px)';
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      // Leaving with a thumb down must not latch the robot into walking.
      resetTouchInput();
    };
  }, []);

  return (
    <div
      ref={base}
      data-room-ui
      className="pointer-events-auto absolute bottom-8 left-6 size-[124px] touch-none select-none rounded-full border border-white/15 bg-black/35 backdrop-blur-sm"
      style={{ touchAction: 'none' }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          ref={knob}
          className="size-[54px] rounded-full border border-white/25 bg-white/20 shadow-lg backdrop-blur-md"
        />
      </div>
    </div>
  );
}
