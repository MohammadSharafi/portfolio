import { Color } from 'three';

/**
 * Scene palette. Kept in one place so the room reads as a single lit space
 * rather than a pile of unrelated primitives — the main thing that separates a
 * procedural scene that looks designed from one that looks generated.
 */
export const palette = {
  floor: new Color('#171a24'),
  rug: new Color('#242938'),
  wall: new Color('#1c202c'),
  wallTrim: new Color('#252a38'),

  deskTop: new Color('#5b4433'),
  deskFrame: new Color('#22262f'),
  chair: new Color('#2a2f3d'),

  plastic: new Color('#1a1d26'),
  metal: new Color('#3a4050'),
  keycap: new Color('#2c313f'),

  plantPot: new Color('#7a4a38'),
  plantLeaf: new Color('#2f6b46'),

  lampShade: new Color('#c9d3e6'),
  lampWarm: new Color('#ffb066'),

  primary: new Color('#4d7cff'),
  accent: new Color('#a855f7'),
  screenGlow: new Color('#63a4ff'),
} as const;
