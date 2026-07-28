import { useEffect, useState } from 'react';

const ROOM = '/models/room.glb';
const LIGHTMAP = '/models/room-lightmap.jpg';
const STAMP = '/models/room-lightmap.json';

/** SHA-256 of the `room.glb` this bundle was built against, inlined by Vite. */
declare const __ROOM_HASH__: string;

export interface RoomAsset {
  url: string;
  /** The lightmap to hang on the room's materials, once one is known to match. */
  lightmap: string | null;
  /**
   * What `lightMapIntensity` has to be for this particular bake.
   *
   * It travels with the image rather than living in the runtime because it is
   * a property *of the bake*: it encodes the divisor that squeezed that bake's
   * irradiance into a JPEG, which depends on how bright that bake came out.
   * Hardcoding it here would mean every re-bake silently changed the room's
   * exposure until someone noticed and re-tuned a constant by eye.
   */
  intensity: number;
  resolved: boolean;
}

/**
 * Asset manager: picks the baked room when one has been produced *for this
 * room*, otherwise the real-time lit one.
 *
 * `scripts/blender/bake_room.py` has to run on a machine with Cycles, which the
 * CI container does not have, so the baked model is an optional artefact rather
 * than a build output.
 *
 * The test is not merely "does a baked model exist". Because the runtime
 * prefers it, a bake that has fallen behind does not degrade the room quietly —
 * it *replaces* it with an older room, and every change made since becomes
 * invisible. That happened twice. Both times the room looked broken in ways the
 * source said were already fixed, and both times the cause was a stale file
 * nobody thought to look at.
 *
 * So the bake records which `room.glb` it came from, the build inlines the hash
 * of the `room.glb` it shipped, and a mismatch means the baked model is
 * ignored. A stale bake now costs its lighting rather than its contents, and it
 * heals itself the moment someone re-bakes.
 */
export function useRoomAsset(): RoomAsset {
  const [asset, setAsset] = useState<RoomAsset>({
    url: ROOM,
    lightmap: null,
    intensity: 1,
    resolved: false,
  });

  useEffect(() => {
    let cancelled = false;

    const settle = (found: boolean, intensity = 1) => {
      if (cancelled) return;
      // One model either way. The bake adds lighting to it rather than
      // replacing it — there is no second copy of the room any more.
      setAsset({ url: ROOM, lightmap: found ? LIGHTMAP : null, intensity, resolved: true });
    };

    // A dev server that rewrites unknown paths to index.html answers 200 with
    // HTML, so the content type is checked rather than the status.
    const isRealFile = (response: Response) =>
      response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');

    void (async () => {
      try {
        const image = await fetch(LIGHTMAP, { method: 'HEAD' });
        if (!isRealFile(image)) return settle(false);

        const stamp = await fetch(STAMP);
        // Baked before the stamp existed, so its provenance is unknowable. An
        // unlit room is a smaller loss than confidently showing the wrong one.
        if (!isRealFile(stamp)) return settle(false);

        const { source, intensity } = (await stamp.json()) as {
          source?: string;
          intensity?: number;
        };
        // A bake from before the stamp carried an intensity would be scaled by
        // its own unknown divisor, so 1 is the only safe reading of a missing
        // field — and it is wrong, which is the point: it looks wrong rather
        // than looking plausible and being wrong.
        settle(Boolean(source) && source === __ROOM_HASH__, intensity ?? 1);
      } catch {
        settle(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return asset;
}
