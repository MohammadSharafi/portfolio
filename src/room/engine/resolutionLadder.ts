/**
 * The pixel ratios a tier is allowed to step through, sharpest first.
 *
 * Its own module rather than a helper inside `AdaptiveResolution.tsx` for two
 * reasons. Exporting a plain function from a file that also exports a component
 * breaks React Fast Refresh, which is worth avoiding on a file that is edited
 * while looking at the room. And this is the piece worth testing on its own —
 * the component around it needs a WebGL context and a render loop, while this
 * is arithmetic with an invariant that has already been wrong once.
 *
 * Geometric from the tier's ceiling down to its floor, so the last rung *is*
 * the floor. The version this replaces stepped by fixed fractions of the
 * ceiling and clamped at the bottom, which left the declared minimum usually
 * unreachable: the low tier bottomed out at 1.2 while its preset promised 0.9,
 * so the weakest phones never received the rung written for them. That was
 * harmless while the ceiling was 1 and stopped being harmless the moment it
 * became 2.
 *
 * Four rungs, spaced evenly in ratio rather than in value, because what a
 * viewer notices is proportional change — the same absolute step is a shrug
 * near the ceiling and a cliff near the floor.
 */
export function ladder([min, max]: [number, number]): number[] {
  if (max <= min) return [max];
  const steps = 4;
  const rungs = Array.from(
    { length: steps },
    (_, i) => +(max * (min / max) ** (i / (steps - 1))).toFixed(3)
  );
  return [...new Set(rungs)];
}
