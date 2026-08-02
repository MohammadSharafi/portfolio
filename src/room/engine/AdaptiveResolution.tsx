import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { quality } from './quality';

/**
 * The room, measuring itself.
 *
 * `quality.ts` decides a tier once, from a GPU name and a core count, and that
 * guess is the only thing standing between a visitor and a slideshow. It is a
 * guess made from bad evidence: `WEBGL_debug_renderer_info` reports "Apple M1
 * Pro" for a fanless laptop and for a machine six times its speed, several
 * browsers refuse to answer at all, and none of them know what else is running,
 * how big the window is, or whether the display is Retina. A single-shot
 * prediction cannot be right often enough.
 *
 * So it stops predicting and starts watching. Frame times are sampled, and when
 * the room is measurably not keeping up the pixel ratio steps down. That is by
 * far the biggest lever available at runtime — cost scales with its square, so
 * 1.75 to 1.05 is a little under a third of the fragment work — and unlike
 * every other knob it changes only sharpness, never what is in the room.
 *
 * This replaces drei's `AdaptiveDpr`, which was mounted here and had never once
 * fired. That component reads `state.performance.current`, which only moves
 * when something calls `regress()` — a thing drei's own controls do and this
 * room, driving its camera by hand, never did. It was inert scenery: the room
 * could drop to 20 fps and nothing anywhere would notice.
 *
 * ## Why it only ever goes down
 *
 * Stepping back up needs proof of headroom, and a vsynced frame time cannot
 * provide it: a machine with 30% to spare and one with 300% both report exactly
 * one refresh interval. Anything that raised the ratio would be doing it on the
 * evidence that nothing is currently on fire, which is how you get a loop that
 * climbs until it stutters, drops, and climbs again — visible, permanent
 * breathing, and worse than simply being slightly soft. A ratchet gives up a
 * little sharpness on a machine that was briefly busy. That is the cheaper
 * mistake, and it is bounded: the floor is still a full device pixel per CSS
 * pixel on the two upper tiers.
 */

/** Frames per verdict — about a second and a half at 60. Long enough that one
 *  bad frame cannot swing the median, short enough to react before a visitor
 *  has decided the site is broken. */
const WINDOW = 90;

/** Frames discarded after mount and after each change. The frames immediately
 *  following a resize include the resize, and the first seconds of the room's
 *  life are texture uploads and shader compilation — real, but not what the
 *  room costs to run, and condemning a machine for them would leave every
 *  visitor at the floor. */
const SETTLE = 75;

/** Beyond this a frame is a stall, not a slow frame: a GC pause, a texture
 *  upload, a tab returning from the background. They are excluded rather than
 *  clamped, because the question is what steady-state costs. */
const STALL_MS = 250;

/** 50 fps. Comfortably below every common refresh rate, so this triggers on
 *  genuine inability rather than on a 120 Hz display missing its target — a
 *  60 fps frame is a fine frame, and on a ProMotion Mac it is the norm. */
const SLOW_MS = 20;

/** Consecutive slow windows before stepping down. Two, so a single window that
 *  happened to catch a panel opening or the robot spawning cannot cost the
 *  visitor sharpness for the rest of the session. */
const STRIKES = 2;

/**
 * The ratios this tier is allowed to use, sharpest first.
 *
 * Multiplicative rather than a fixed list, so it works for a tier whose ceiling
 * is 1.75 and for one whose ceiling is 1. Each rung is roughly 30% less
 * fragment work than the one above it — big enough to actually rescue a frame
 * rate, small enough that no single step is visible as a jump in softness.
 */
function ladder([min, max]: [number, number]): number[] {
  const rungs = [1, 0.85, 0.72, 0.6].map((factor) => Math.max(min, +(max * factor).toFixed(3)));
  return [...new Set(rungs)];
}

export function AdaptiveResolution() {
  const setDpr = useThree((state) => state.setDpr);
  const steps = useRef(ladder(quality().dpr));
  const rung = useRef(0);
  const samples = useRef<number[]>([]);
  const settle = useRef(SETTLE);
  const strikes = useRef(0);

  useFrame((_, delta) => {
    // `delta` is seconds since the last frame, which is the number this is
    // about — not the time spent inside this callback.
    const ms = delta * 1000;

    if (settle.current > 0) {
      settle.current -= 1;
      return;
    }
    if (ms > STALL_MS) return;

    const window = samples.current;
    window.push(ms);
    if (window.length < WINDOW) return;

    // Median, not mean: one 90 ms frame in ninety should not read as a machine
    // that cannot cope, and with a mean it would.
    const sorted = [...window].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    window.length = 0;

    if (median <= SLOW_MS) {
      strikes.current = 0;
      return;
    }

    strikes.current += 1;
    if (strikes.current < STRIKES) return;
    strikes.current = 0;

    const next = rung.current + 1;
    if (next >= steps.current.length) return; // Already at the floor.
    rung.current = next;
    settle.current = SETTLE;
    setDpr(steps.current[next]!);
  });

  return null;
}
