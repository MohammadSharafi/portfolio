import { Color } from 'three';

/**
 * Scene palette. Kept in one place so the room reads as a single lit space
 * rather than a pile of unrelated primitives — the main thing that separates a
 * procedural scene that looks designed from one that looks generated.
 *
 * Values are deliberately desaturated and close in value: the colour interest
 * comes from the warm lamp against the cool screens, not from the albedo.
 */
export const palette = {
  floor: new Color('#12151d'),
  rug: new Color('#1d2130'),
  wall: new Color('#191d28'),
  wallTrim: new Color('#232838'),

  deskTop: new Color('#6b4f3a'),
  deskEdge: new Color('#7d5d45'),
  deskFrame: new Color('#1a1e27'),
  deskMat: new Color('#15181f'),
  chair: new Color('#242936'),

  plastic: new Color('#14171e'),
  bezel: new Color('#0d1016'),
  metal: new Color('#8e97ab'),
  darkMetal: new Color('#2a2f3c'),
  keycap: new Color('#232733'),

  plantPot: new Color('#8a5540'),
  plantLeaf: new Color('#356f4c'),
  plantLeafAlt: new Color('#2a5c40'),

  lampShade: new Color('#e8edf6'),
  lampWarm: new Color('#ffa94d'),

  paper: new Color('#cbd3e2'),
  primary: new Color('#4d7cff'),
  accent: new Color('#a855f7'),
  screenGlow: new Color('#6aa6ff'),
} as const;
