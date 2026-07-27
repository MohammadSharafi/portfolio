import type { Vec3 } from './primitives';
import { anchors, type View } from './journey';

/** Ids are shared with `src/data/hotspots.ts`, which supplies the copy. */
export const hotspotIds = [
  'village-window',
  'exam-books',
  'university-arcade',
  'city-spire',
  'crossing-bridge',
  'monitor-projects',
  'monitor-code',
  'monitor-terminal',
  'tower',
  'shelf',
  'award',
  'phone',
] as const;

export type HotspotId = (typeof hotspotIds)[number];

export interface HotspotAnchor {
  id: HotspotId;
  /** Index into `src/data/journey.ts`. Markers only show for the live chapter. */
  chapter: number;
  /**
   * World point the marker pins to. Chosen to sit just clear of the object
   * rather than on it, so a marker never buries the thing it labels.
   */
  anchor: Vec3;
  /** Where the camera goes when the hotspot is opened. */
  view: View;
}

/** Stage-local → world, matching how `journey.ts` places each chapter. */
const at = (anchor: number, [x, y, z]: Vec3): Vec3 => [x + anchor, y, z];
const view = (anchor: number, position: Vec3, target: Vec3): View => ({
  position: at(anchor, position),
  target: at(anchor, target),
});

/**
 * The objects a visitor can open, one emblematic model per outdoor chapter and
 * the full desk in the present-day room.
 *
 * Markers are projected into screen space each frame and positioned over real
 * DOM buttons, rather than picked with a raycaster. Raycasting the meshes would
 * give a mouse user the same result and a keyboard user nothing at all — the
 * canvas is `aria-hidden` and has no tab stops — so the buttons are the control
 * and the projection only decides where to put them. Adding another hotspot is
 * one entry here and one in `src/data/hotspots.ts`; no new machinery.
 */
export const hotspotAnchors: readonly HotspotAnchor[] = [
  {
    id: 'village-window',
    chapter: 0,
    anchor: at(anchors.village, [-3.2, 2.75, 1.6]),
    view: view(anchors.village, [2.2, 1.9, 5.6], [-3.2, 1.5, 1.6]),
  },
  {
    id: 'exam-books',
    chapter: 1,
    anchor: at(anchors.exam, [-0.62, 1.3, -0.42]),
    view: view(anchors.exam, [0.95, 1.3, 1.15], [-0.62, 0.95, -0.42]),
  },
  {
    id: 'university-arcade',
    chapter: 2,
    anchor: at(anchors.university, [5.05, 4.0, 1.48]),
    view: view(anchors.university, [1.4, 2.0, 3.4], [5.2, 2.1, 1.1]),
  },
  {
    id: 'city-spire',
    chapter: 3,
    anchor: at(anchors.city, [-9, 24.5, -19]),
    view: view(anchors.city, [-1.5, 12.0, 2.5], [-9, 20.0, -19]),
  },
  {
    id: 'crossing-bridge',
    chapter: 4,
    anchor: at(anchors.crossing, [-6.5, 12.4, -6]),
    view: view(anchors.crossing, [1.8, 6.5, 6.2], [-6.5, 8.0, -6]),
  },

  // The room. Everything below is already at the world origin.
  {
    id: 'monitor-projects',
    chapter: 5,
    anchor: [0, 1.46, -1.7],
    view: { position: [0.05, 1.22, -0.5], target: [0, 1.08, -1.72] },
  },
  {
    id: 'monitor-code',
    chapter: 5,
    anchor: [-1.05, 1.34, -1.6],
    view: { position: [-0.72, 1.16, -0.6], target: [-1.05, 1.02, -1.62] },
  },
  {
    id: 'monitor-terminal',
    chapter: 5,
    anchor: [1.02, 1.5, -1.6],
    view: { position: [1.42, 1.24, -0.62], target: [1.02, 1.06, -1.62] },
  },
  {
    id: 'tower',
    chapter: 5,
    anchor: [1.62, 0.98, -1.15],
    view: { position: [2.45, 0.88, -0.25], target: [1.62, 0.5, -1.15] },
  },
  {
    id: 'shelf',
    chapter: 5,
    anchor: [-1.5, 2.26, -2.0],
    view: { position: [-0.75, 2.24, -0.95], target: [-1.5, 2.05, -2.05] },
  },
  {
    id: 'award',
    chapter: 5,
    anchor: [-1.32, 0.97, -1.15],
    view: { position: [-0.85, 1.0, -0.6], target: [-1.32, 0.85, -1.16] },
  },
  {
    id: 'phone',
    chapter: 5,
    anchor: [0.85, 0.87, -1.35],
    view: { position: [1.02, 1.14, -0.72], target: [0.85, 0.79, -1.35] },
  },
];

export const hotspotAnchorById = new Map(hotspotAnchors.map((hotspot) => [hotspot.id, hotspot]));

/** Where a marker sits on screen. Reused across frames — do not retain it. */
export interface HotspotPlacement {
  id: HotspotId;
  x: number;
  y: number;
  /** False when the anchor is behind the camera, off-viewport, or not live. */
  visible: boolean;
}
