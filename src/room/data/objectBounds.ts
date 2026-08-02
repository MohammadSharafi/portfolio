/**
 * Where every interactive object actually is, measured from `room.glb`.
 *
 * GENERATED — run `python3 scripts/room_bounds.py --ts` after re-exporting the
 * room. `bounds.test.ts` re-parses the GLB and fails if this file has drifted,
 * so a stale copy cannot ship.
 *
 * Camera stops used to be hand-authored positions and targets, and there was no
 * way to see that one had gone stale: an object moves in `build_room.py`, the
 * numbers pointed at where it used to be, and the result looks like a shot that
 * was always framed slightly badly. Three of them were aimed at empty space —
 * the notebook's target sat 70 cm to the left of the notebook. Stops are
 * derived from these boxes now, so re-exporting the room re-aims every camera.
 *
 * Coordinates are glTF space (Y-up), which is what the browser uses.
 */

export interface ObjectBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}

export const objectBounds = {
  'monitor-health': {
    min: [-0.6311, 0.9025, 2.2499],
    max: [-0.0144, 1.2775, 2.3838],
    center: [-0.3227, 1.09, 2.3169],
    size: [0.6168, 0.375, 0.1338],
  },
  'monitor-code': {
    min: [0.0144, 0.9025, 2.2499],
    max: [0.6311, 1.2775, 2.3838],
    center: [0.3227, 1.09, 2.3169],
    size: [0.6168, 0.375, 0.1338],
  },
  cv: {
    min: [0.798, 0.7156, 1.8216],
    max: [1.042, 1.0958, 2.1133],
    center: [0.92, 0.9057, 1.9675],
    size: [0.244, 0.3802, 0.2916],
  },
  laptop: {
    min: [-0.743, 0.79, 1.9564],
    max: [-0.3835, 1.0254, 2.2055],
    center: [-0.5632, 0.9077, 2.0809],
    size: [0.3595, 0.2354, 0.2491],
  },
  notebook: {
    min: [0.1666, 0.79, 2.0317],
    max: [0.3534, 0.806, 2.2683],
    center: [0.26, 0.798, 2.15],
    size: [0.1867, 0.016, 0.2366],
  },
  bookshelf: {
    min: [-3.1554, 0.3175, -1.63],
    max: [-2.894, 2.108, -0.15],
    center: [-3.0247, 1.2128, -0.89],
    size: [0.2614, 1.7905, 1.48],
  },
  whiteboard: {
    min: [-3.165, 1.145, 0.55],
    max: [-3.088, 2.295, 2.15],
    center: [-3.1265, 1.72, 1.35],
    size: [0.077, 1.15, 1.6],
  },
  'sticky-notes': {
    min: [-3.079, 1.1975, 0.8589],
    max: [-3.0601, 1.6396, 2.0333],
    center: [-3.0696, 1.4186, 1.4461],
    size: [0.0189, 0.4421, 1.1744],
  },
  'server-rack': {
    min: [2.63, 0, 1.814],
    max: [3.13, 0.98, 2.45],
    center: [2.88, 0.49, 2.132],
    size: [0.5, 0.98, 0.636],
  },
  certificates: {
    min: [-1.7225, 1.7675, 2.484],
    max: [-0.8875, 2.2525, 2.484],
    center: [-1.305, 2.01, 2.484],
    size: [0.835, 0.485, 0],
  },
  lamp: {
    min: [0.6792, 0.79, 2.0946],
    max: [1.095, 1.315, 2.515],
    center: [0.8871, 1.0525, 2.3048],
    size: [0.4158, 0.525, 0.4204],
  },
  window: {
    min: [-52.95, -20.0333, 2.35],
    max: [57.05, 34.0333, 76],
    center: [2.05, 7, 39.175],
    size: [110, 54.0667, 73.65],
  },
  mug: {
    min: [0.357, 0.7975, 1.847],
    max: [0.499, 0.893, 1.933],
    center: [0.428, 0.8453, 1.89],
    size: [0.142, 0.0955, 0.086],
  },
  headphones: {
    min: [0.5241, 0.79, 1.7985],
    max: [0.7959, 0.9127, 1.9015],
    center: [0.66, 0.8514, 1.85],
    size: [0.2717, 0.1227, 0.1029],
  },
  keyboard: {
    min: [-0.3142, 0.7893, 1.8609],
    max: [-0.0058, 0.8226, 2.001],
    center: [-0.16, 0.806, 1.931],
    size: [0.3085, 0.0334, 0.1401],
  },
} as const satisfies Record<string, ObjectBounds>;
