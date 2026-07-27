import { useEffect, useState } from 'react';

const BAKED = '/models/room-baked.glb';
const LIT = '/models/room.glb';

export interface RoomAsset {
  url: string;
  /** True once we know the baked atlas exists and the room can render unlit. */
  baked: boolean;
  resolved: boolean;
}

/**
 * Asset manager: picks the baked room when one has been produced, otherwise the
 * real-time lit one.
 *
 * `scripts/blender/bake_room.py` has to run on a machine with Cycles, which the
 * CI container does not have, so the baked model is an optional artefact rather
 * than a build output. Probing for it with a HEAD request means running the bake
 * is a drop-in upgrade — no rebuild, no code change, no flag to remember.
 */
export function useRoomAsset(): RoomAsset {
  const [asset, setAsset] = useState<RoomAsset>({ url: LIT, baked: false, resolved: false });

  useEffect(() => {
    let cancelled = false;

    fetch(BAKED, { method: 'HEAD' })
      .then((response) => {
        if (cancelled) return;
        // A dev server that rewrites unknown paths to index.html will answer
        // 200 with HTML, so the content type is checked rather than the status.
        const type = response.headers.get('content-type') ?? '';
        const found = response.ok && !type.includes('text/html');
        setAsset({ url: found ? BAKED : LIT, baked: found, resolved: true });
      })
      .catch(() => {
        if (!cancelled) setAsset({ url: LIT, baked: false, resolved: true });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return asset;
}
