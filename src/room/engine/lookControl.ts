import { MathUtils } from 'three';

/**
 * The player's view direction, owned by nobody else.
 *
 * This exists because the camera and the character's neck were the same
 * number, and that was the bug: the view could only go where a head could
 * turn, so from 12 cm off the boards you could never look up at the shelves,
 * the whiteboard or the wall above the monitors — the half of this room that
 * is worth looking at.
 *
 * So the chain runs one way only, and each link is allowed less than the one
 * before it:
 *
 *     pointer  →  look yaw/pitch  →  camera orbit
 *                              ↘   →  head, within a neck's range
 *                                  →  torso, for whatever the neck cannot do
 *
 * The camera takes the angles whole. The head takes as much as a neck can
 * take. The body quietly absorbs the rest. Nothing here knows what an
 * animation is, and the animation system never writes back.
 */

export interface LookConfig {
  /** Radians of yaw at full pointer deflection. */
  yawRange: number;
  /** Radians of pitch: up is positive. Up gets more room than down because
   * that is where this room keeps its content. */
  pitchUp: number;
  pitchDown: number;
  /** Exponential smoothing rate; higher is snappier. Frame-rate independent
   * — the rate is folded with delta time, not applied per frame. */
  responsiveness: number;
  /** Scales pointer travel before it becomes an angle. */
  sensitivity: number;
}

export const lookConfig: LookConfig = {
  yawRange: 1.6,
  pitchUp: 1.25,
  pitchDown: 0.75,
  responsiveness: 7,
  sensitivity: 1,
};

/** Where the neck gives out and the shoulders start helping. */
export const NECK_LIMIT = { yaw: 0.85, pitchUp: 0.55, pitchDown: 0.5 };

/** The live view angles, relative to whichever way the character faces. */
export const look = {
  yaw: 0,
  pitch: 0,
};

const target = { yaw: 0, pitch: 0 };

/**
 * Aim from a pointer position in normalised screen space, where x and y both
 * run -1 (left, top) to +1 (right, bottom).
 *
 * Absolute rather than pointer-locked on purpose: this is a portfolio in a
 * browser tab, and a page that swallows the cursor to be looked around is a
 * page people leave. Resting the pointer near the middle looks straight
 * ahead, so the neutral pose costs nothing to find.
 */
export function aimLook(x: number, y: number): void {
  const { yawRange, pitchUp, pitchDown, sensitivity } = lookConfig;
  target.yaw = MathUtils.clamp(-x * sensitivity, -1, 1) * yawRange;
  // Pointer up is negative y, and up should look up.
  const pitch = MathUtils.clamp(-y * sensitivity, -1, 1);
  target.pitch = pitch >= 0 ? pitch * pitchUp : pitch * pitchDown;
}

/**
 * Aim by a *relative* amount, in normalised screen units.
 *
 * The absolute form above is right for a mouse and wrong for a thumb. A mouse
 * has a resting position on screen that the view can be a function of; a touch
 * has no position at all until it lands, so mapping the landing point straight
 * to an angle flings the view across the room the instant a finger touches the
 * glass. Dragging is the gesture people already expect for looking around, and
 * a drag is a delta.
 *
 * The target is accumulated and clamped rather than derived, so the view stays
 * where the last drag left it — which is also what makes one-handed play
 * possible: aim once, then drive with the other thumb.
 */
export function aimLookBy(dx: number, dy: number): void {
  const { yawRange, pitchUp, pitchDown, sensitivity } = lookConfig;
  // 2.4 turns a comfortable thumb-swipe — roughly a third of the screen — into
  // most of the available range. Below about 2 the visitor runs out of screen
  // before they run out of room to look at.
  const gain = 2.4 * sensitivity;
  target.yaw = MathUtils.clamp(target.yaw - dx * gain * yawRange, -yawRange, yawRange);
  const pitch = MathUtils.clamp(target.pitch - dy * gain * pitchUp, -pitchDown, pitchUp);
  target.pitch = pitch;
}

/** Ease the live angles toward the aim. Call once per frame, before anything
 * reads `look`. */
export function updateLook(dt: number): void {
  const k = 1 - Math.exp(-lookConfig.responsiveness * dt);
  look.yaw += (target.yaw - look.yaw) * k;
  look.pitch += (target.pitch - look.pitch) * k;
}

/** Recentre instantly — used when control is handed over, so the view does
 * not swing across the room on entry. */
export function resetLook(): void {
  target.yaw = 0;
  target.pitch = 0;
  look.yaw = 0;
  look.pitch = 0;
}

/**
 * Split a view angle into what the neck can do and what the body must.
 *
 * Returned separately rather than pre-summed so the caller can put them on
 * different joints — a head that turns 90 degrees on a fixed torso is the
 * single most reliable way to make a character look possessed.
 */
export function splitLook(): {
  headYaw: number;
  headPitch: number;
  bodyYaw: number;
} {
  const headYaw = MathUtils.clamp(look.yaw, -NECK_LIMIT.yaw, NECK_LIMIT.yaw);
  const headPitch = MathUtils.clamp(look.pitch, -NECK_LIMIT.pitchDown, NECK_LIMIT.pitchUp);
  // Only a third of the overflow reaches the torso: a body that tracks the
  // view one-for-one reads as the whole character being dragged around by
  // the camera, which is exactly the feeling this split exists to avoid.
  return { headYaw, headPitch, bodyYaw: (look.yaw - headYaw) * 0.34 };
}
