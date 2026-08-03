import { describe, expect, it } from 'vitest';
import { ladder } from './resolutionLadder';
import { PRESETS, type Tier } from './quality';

/**
 * The pixel ratio is the only quality setting that moves at runtime, and it is
 * the one a visitor sees most directly — too low and the room is a smear, too
 * high and it stutters. These lock the two properties that make the ladder
 * trustworthy, both of which have already been wrong once.
 */

const TIERS: Tier[] = ['low', 'medium', 'high'];

describe('the resolution ladder', () => {
  it('starts at the tier ceiling and ends at its floor', () => {
    // The bug this replaces: rungs were fixed fractions of the ceiling, then
    // clamped at the bottom, so the floor was only reached if 0.6 × ceiling
    // happened to fall below it. On the low tier it did not — the ladder
    // bottomed out at 1.2 while the preset promised 0.9, and the weakest
    // phones never received the rung written for them.
    for (const tier of TIERS) {
      const [min, max] = PRESETS[tier].dpr;
      const rungs = ladder([min, max]);
      expect(rungs.at(0), `${tier} ceiling`).toBeCloseTo(max, 3);
      expect(rungs.at(-1), `${tier} floor`).toBeCloseTo(min, 3);
    }
  });

  it('descends, and never leaves a step big enough to see as a jump', () => {
    for (const tier of TIERS) {
      const rungs = ladder(PRESETS[tier].dpr);
      for (let i = 1; i < rungs.length; i += 1) {
        const previous = rungs[i - 1]!;
        const current = rungs[i]!;
        expect(current, `${tier} rung ${i}`).toBeLessThan(previous);
        // No single step may halve the linear resolution. A drop that large
        // reads as the picture breaking rather than as the room easing off.
        expect(current / previous, `${tier} rung ${i} ratio`).toBeGreaterThan(0.6);
      }
    }
  });

  it('survives a tier whose floor equals its ceiling', () => {
    expect(ladder([1, 1])).toEqual([1]);
  });
});

describe('tier presets', () => {
  it('never renders a phone below one device pixel per CSS pixel at the top', () => {
    // The low tier used to cap at 1, which on a 3× handset is a third of the
    // linear resolution. Whatever else changes, its ceiling must stay above
    // the point where the room is being reconstructed from fewer samples than
    // the screen has pixels.
    expect(PRESETS.low.dpr[1]).toBeGreaterThanOrEqual(1.5);
  });

  it('spends fewer MSAA samples the weaker the tier', () => {
    expect(PRESETS.low.multisampling).toBeLessThan(PRESETS.medium.multisampling);
    expect(PRESETS.medium.multisampling).toBeLessThan(PRESETS.high.multisampling);
  });

  it('keeps every floor at or above the point of visible softness', () => {
    for (const tier of TIERS) {
      expect(PRESETS[tier].dpr[0], tier).toBeGreaterThanOrEqual(0.9);
    }
  });
});
