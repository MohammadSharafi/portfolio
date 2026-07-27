import { useEffect, useState } from 'react';

const BAKED = '/models/room-baked.glb';
const STAMP = '/models/room-baked.json';
const LIT = '/models/room.glb';

/** SHA-256 of the `room.glb` this bundle was built against, inlined by Vite. */
declare const __ROOM_HASH__: string;

export interface RoomAsset {
  url: string;
  /** True once we know the baked atlas exists and the room can render unlit. */
  baked: boolean;
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
  const [asset, setAsset] = useState<RoomAsset>({ url: LIT, baked: false, resolved: false });

  useEffect(() => {
    let cancelled = false;

    const settle = (found: boolean) => {
      if (cancelled) return;
      setAsset({ url: found ? BAKED : LIT, baked: found, resolved: true });
    };

    // A dev server that rewrites unknown paths to index.html answers 200 with
    // HTML, so the content type is checked rather than the status.
    const isRealFile = (response: Response) =>
      response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');

    void (async () => {
      try {
        const model = await fetch(BAKED, { method: 'HEAD' });
        if (!isRealFile(model)) return settle(false);

        const stamp = await fetch(STAMP);
        // Baked before the stamp existed, so its provenance is unknowable. An
        // unlit room is a smaller loss than confidently showing the wrong one.
        if (!isRealFile(stamp)) return settle(false);

        const { source } = (await stamp.json()) as { source?: string };
        settle(Boolean(source) && source === __ROOM_HASH__);
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
