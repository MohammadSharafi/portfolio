import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { buildEnvironment, buildRoomProbe } from '@/three/environment';

/**
 * The image-based lighting for the lit (unbaked) room.
 *
 * Drei's `<Environment preset="…">` fetches an HDR from a CDN at runtime. This
 * site has shipped with zero third-party requests since the rebuild, and the
 * preset also fails outright with no network — which is exactly how it was
 * caught. `buildEnvironment` generates the same kind of prefiltered radiance
 * locally from a procedural sky, so the room lights itself with nothing
 * fetched and nothing to go down.
 */
export function SceneEnvironment({
  intensity = 0.45,
  interior = false,
}: {
  intensity?: number;
  /**
   * Reflect the room instead of the sky.
   *
   * A baked room's probe is only ever doing specular — the lightmap owns the
   * diffuse — and specular is a reflection of the surroundings. Indoors at
   * night those surroundings are dark walls and a few lamps, not a sky.
   */
  interior?: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const environment = interior ? buildRoomProbe(gl) : buildEnvironment(gl);
    scene.environment = environment.texture;
    scene.environmentIntensity = intensity;

    return () => {
      scene.environment = null;
      environment.dispose();
    };
  }, [gl, scene, intensity, interior]);

  return null;
}
