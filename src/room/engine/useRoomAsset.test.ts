import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomAsset } from './useRoomAsset';

/**
 * The gate that decides whether a bake is applied to the room it is served with.
 *
 * Worth testing because both ways of getting it wrong are silent. Reject a
 * valid bake and the room quietly loses its lighting, which reads as the bake
 * having failed and sends you back to Blender for an hour. Accept an invalid
 * one and the room is lit for a layout it no longer has — dust on the underside
 * of the desk, shadows from furniture that moved — which reads as a shader bug
 * and sends you into the wrong file entirely.
 *
 * It has already been wrong in both directions: too strict, discarding an
 * hour-long bake because a texture changed, and then wrong in the other
 * direction when `build_room` published a fingerprint taken after it had
 * dropped an object the bake still rendered with.
 */

const GEOMETRY = 'geometry-fingerprint-of-the-served-room';
const STALE = 'fingerprint-of-some-older-room';

declare const globalThis: { __ROOM_HASH__?: string; __ROOM_GEOMETRY__?: string } & typeof global;

/** A fetch that answers the three asset probes the hook makes. */
function serve({
  stamp,
  aging = true,
  lightmap = true,
}: {
  stamp: Record<string, unknown> | null;
  aging?: boolean;
  lightmap?: boolean;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const present = (ok: boolean) =>
      ({
        ok,
        headers: new Headers({ 'content-type': ok ? 'image/png' : 'text/html' }),
      }) as Response;

    if (url.endsWith('room-lightmap.jpg')) return present(lightmap);
    if (url.endsWith('room-aging.png')) return present(aging);
    if (url.endsWith('room-lightmap.json')) {
      if (!stamp) return present(false);
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => stamp,
      } as Response;
    }
    return present(false);
  }) as unknown as typeof fetch;
}

describe('useRoomAsset', () => {
  beforeEach(() => {
    globalThis.__ROOM_HASH__ = 'sha-of-the-served-glb';
    globalThis.__ROOM_GEOMETRY__ = GEOMETRY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a bake whose geometry matches the room being served', async () => {
    vi.stubGlobal('fetch', serve({ stamp: { geometry: GEOMETRY, intensity: 4.7 } }));

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBe('/models/room-lightmap.jpg');
    expect(result.current.aging).toBe('/models/room-aging.png');
    expect(result.current.intensity).toBe(4.7);
  });

  it('keeps a bake when only the textures changed', async () => {
    // The whole point of fingerprinting geometry rather than the file: a
    // different `source` is not a reason to throw an hour of baking away.
    vi.stubGlobal(
      'fetch',
      serve({ stamp: { source: 'sha-of-a-different-glb', geometry: GEOMETRY, intensity: 4.7 } })
    );

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBe('/models/room-lightmap.jpg');
  });

  it('discards a bake taken of a differently shaped room', async () => {
    vi.stubGlobal('fetch', serve({ stamp: { geometry: STALE, intensity: 4.7 } }));

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBeNull();
    expect(result.current.aging).toBeNull();
    // Not the stale bake's scale — nothing is being scaled.
    expect(result.current.intensity).toBe(1);
  });

  it('falls back to the strict file hash for a bake predating fingerprints', async () => {
    vi.stubGlobal('fetch', serve({ stamp: { source: 'sha-of-the-served-glb', intensity: 3.9 } }));

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBe('/models/room-lightmap.jpg');
  });

  it('discards an old bake whose file hash no longer matches', async () => {
    vi.stubGlobal('fetch', serve({ stamp: { source: 'sha-of-a-different-glb', intensity: 3.9 } }));

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBeNull();
  });

  it('lights the room even when the aging atlas is missing', async () => {
    // `--skip-aging` is a supported way to bake, so its absence is normal.
    vi.stubGlobal('fetch', serve({ stamp: { geometry: GEOMETRY, intensity: 4.7 }, aging: false }));

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBe('/models/room-lightmap.jpg');
    expect(result.current.aging).toBeNull();
  });

  it('resolves to an unlit room when there is no stamp at all', async () => {
    // A dev server that rewrites unknown paths to index.html answers 200 with
    // HTML, which is why the hook checks content type rather than status.
    vi.stubGlobal('fetch', serve({ stamp: null }));

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.url).toBe('/models/room.glb');
    expect(result.current.lightmap).toBeNull();
  });

  it('resolves rather than hanging when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );

    const { result } = renderHook(() => useRoomAsset());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    expect(result.current.lightmap).toBeNull();
  });
});
