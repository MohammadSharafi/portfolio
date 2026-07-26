/**
 * Whether this device can render the 3D room at all.
 *
 * The scene is an enhancement: the full portfolio exists in accessible DOM
 * either way, so a device without WebGL simply gets the flat hero.
 */
export function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

export type SceneQuality = 'high' | 'low';

/**
 * Picks a quality tier rather than excluding devices.
 *
 * Gating on something like `cores <= 4` would drop a large share of ordinary
 * laptops and most phones out of the headline experience. Scaling shadows and
 * pixel ratio keeps the room on screen everywhere that can draw it.
 */
export function detectQuality(): SceneQuality {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'low';

  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  if (memory <= 4 || cores <= 2 || (coarsePointer && cores <= 6)) return 'low';
  return 'high';
}
