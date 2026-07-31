/**
 * The room, driven by a thumb.
 *
 * Everything about walking this room assumed a keyboard: W and S to move, A
 * and D to turn, Space held for the thrusters, E to interact, and the pointer's
 * absolute position on screen aimed the view. On a phone that is not a degraded
 * experience, it is no experience — there is no key to press and no cursor to
 * rest in the middle of the screen, so "Walk the room" put a visitor in control
 * of a robot they had no way of moving.
 *
 * This is the other half of the input, kept as plain module state rather than
 * React state for the same reason `characterState` is: it changes every frame
 * that a thumb is down, and a store write per frame would re-render the overlay
 * sixty times a second to move a robot.
 *
 * The axes are analogue, not booleans. A stick that reports only on and off
 * makes a 12 cm robot cross a room at exactly one speed, and the whole reason
 * to build a stick rather than four arrow buttons is that a thumb can ask for
 * less than everything.
 */
export const touchInput = {
  /** −1 (back) to 1 (forward). */
  drive: 0,
  /** −1 (right) to 1 (left), matching the keyboard's sign convention. */
  steer: 0,
  /** True while the thruster pad is held. */
  thrust: false,
};

export function resetTouchInput(): void {
  touchInput.drive = 0;
  touchInput.steer = 0;
  touchInput.thrust = false;
}

/**
 * Whether this is a device driven by touch.
 *
 * A coarse pointer is the signal that matters — not screen size, which says
 * nothing (a tablet is wide, a touchscreen laptop is both). Read once: it
 * cannot change without a reload, and every caller has to agree.
 *
 * `matchMedia` rather than `'ontouchstart' in window`, because the latter is
 * true on desktop Chrome with device emulation open and false on some
 * pen-first devices, so it answers a different question than the one asked.
 */
function detectTouch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  // `?touch=1` / `?touch=0` forces the branch, which is the only way to look
  // at the touch layout without holding a phone: resizing a desktop browser
  // narrows the viewport but leaves the pointer fine, so the on-screen stick
  // never appears and the mobile build cannot be reviewed at all. Same
  // escape hatch as `?quality=`, for the same reason.
  const asked = new URLSearchParams(window.location.search).get('touch');
  if (asked === '1') return true;
  if (asked === '0') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export const isTouch: boolean = detectTouch();
