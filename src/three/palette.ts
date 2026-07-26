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

/**
 * The journey palette. Every chapter stays inside the same night-to-blue-hour
 * range as the room: the story is told with light temperature — cold sky and
 * one warm window in the village, warm sandstone under a cold sky at the
 * university, sodium haze over Tehran, blue hour on the water — rather than
 * with six unrelated colour schemes, which would read as a slideshow.
 */
export const journeyPalette = {
  // Village
  earth: new Color('#2b2419'),
  earthPath: new Color('#3a3122'),
  ridge: new Color('#171d2c'),
  hill: new Color('#242b24'),
  mudBrick: new Color('#5c4a37'),
  mudBrickAlt: new Color('#4d3f30'),
  roofTile: new Color('#3b2f23'),
  window: new Color('#ffbe6b'),
  moon: new Color('#dfe7ff'),
  foliage: new Color('#294232'),
  bark: new Color('#2b2119'),

  // Exam years
  courtyard: new Color('#262b34'),
  chalkboard: new Color('#14211b'),
  chalk: new Color('#93a49b'),
  bulb: new Color('#ffd6a0'),

  // University
  sandstone: new Color('#6d5a45'),
  sandstoneDeep: new Color('#4b3d2f'),
  tilework: new Color('#1f6f88'),
  tileworkAlt: new Color('#2b4f96'),
  pool: new Color('#0c1620'),
  cypress: new Color('#1b2c22'),

  // Tehran
  asphalt: new Color('#1d1d25'),
  tower: new Color('#3a3c50'),
  towerAlt: new Color('#43455c'),
  officeLight: new Color('#ffd9a0'),
  sodium: new Color('#ff9d4d'),

  // The crossing
  water: new Color('#101b2c'),
  shore: new Color('#1b1f2c'),
  bridge: new Color('#343c52'),
  cable: new Color('#495273'),
  dome: new Color('#2f374a'),
  minaret: new Color('#3a4258'),
  ferry: new Color('#2a3040'),
} as const;

/** Sky and fog colour held while each chapter is on screen. */
export const skies = {
  village: new Color('#05070f'),
  exam: new Color('#080a13'),
  university: new Color('#0a0f1a'),
  city: new Color('#150f14'),
  crossing: new Color('#070d18'),
  room: new Color('#080a10'),
} as const;
