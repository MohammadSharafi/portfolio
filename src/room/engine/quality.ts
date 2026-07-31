/**
 * What this machine can afford.
 *
 * The room was built and tuned on a fast desktop GPU, and everything in it is
 * priced accordingly: 1,800 shader-animated dust motes, a 4096 lightmap, a
 * 2048 aging atlas, five shadow-casting lights on the unbaked path and a
 * seven-effect composer. On the machine it was authored on that is a
 * comfortable 60; on an integrated GPU it is a slideshow, and a portfolio that
 * stutters on a recruiter's laptop has failed at the only job it has.
 *
 * The honest fix is not to make the room cheaper for everyone — it is to spend
 * what the machine has. Tiers are decided once, from what the GPU says it is
 * and what the browser will admit to, and every system reads the same answer.
 *
 * Nothing here degrades *art direction*: the lighting, the bake and the
 * materials are identical across tiers. What changes is sampling — pixel
 * ratio, particle count, shadow map size, whether the lens artefacts are
 * drawn. A low tier should look like the same room photographed with a cheaper
 * camera, not like a different room.
 */

export type Tier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: Tier;
  /** Clamp for the renderer's device pixel ratio. The single biggest lever
   *  there is: cost scales with the square of this. */
  dpr: [number, number];
  /** Dust motes. The vertex shader is cheap per particle but the fill is not,
   *  and they are additive over the whole frame. */
  dust: number;
  /** Shadow map resolution for the room's practicals on the unbaked path. */
  shadowMap: number;
  /** How many of the unbaked path's lights are allowed to cast. Shadow maps
   *  are per-light full scene re-renders — the most expensive thing in the
   *  fallback by a wide margin. */
  shadowCasters: number;
  /** Ambient occlusion at all, and at what fraction of resolution. */
  ao: boolean;
  /** The lens's own faults: grain, fringing, vignette. Cheap individually,
   *  three extra full-screen passes together. */
  lensArtefacts: boolean;
  /** Bloom. Kept on everywhere — the room's emissives are meaningless without
   *  it — but the mipmap blur is dropped on low. */
  bloomMipmap: boolean;
  /** Anti-aliasing in the WebGL context. */
  antialias: boolean;
}

const PRESETS: Record<Tier, Omit<QualitySettings, 'tier'>> = {
  low: {
    dpr: [0.75, 1],
    dust: 380,
    shadowMap: 512,
    shadowCasters: 1,
    ao: false,
    lensArtefacts: false,
    bloomMipmap: false,
    antialias: false,
  },
  medium: {
    dpr: [1, 1.5],
    dust: 900,
    shadowMap: 1024,
    shadowCasters: 3,
    ao: true,
    lensArtefacts: true,
    bloomMipmap: true,
    antialias: true,
  },
  high: {
    dpr: [1, 2],
    dust: 1800,
    shadowMap: 2048,
    shadowCasters: 5,
    ao: true,
    lensArtefacts: true,
    bloomMipmap: true,
    antialias: true,
  },
};

/**
 * Reads the GPU's own description of itself.
 *
 * `WEBGL_debug_renderer_info` is the only direct signal a browser gives about
 * the hardware, and several of them now lie or refuse — Safari returns a
 * generic string, Firefox can be configured to. So this is one input among
 * several rather than the decision, and every branch has to survive getting
 * nothing back.
 */
function readRenderer(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = info
      ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string);
    // Release the context rather than leaving it to the GC: browsers cap the
    // number of live WebGL contexts, and the room needs the one that matters.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (raw ?? '').toLowerCase();
  } catch {
    return '';
  }
}

/** Integrated and mobile parts, by the substrings their renderer strings use. */
const MODEST = [
  'intel',
  'uhd graphics',
  'hd graphics',
  'iris',
  'mali',
  'adreno',
  'powervr',
  'videocore',
  'swiftshader',
  'llvmpipe',
  'software',
];

/** Discrete parts that comfortably carry the full room. */
const CAPABLE = ['nvidia', 'geforce', 'rtx', 'gtx', 'radeon rx', 'apple m'];

export function detectTier(): Tier {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'medium';

  const renderer = readRenderer();
  // Software rasterisers are not a tier, they are a warning. Anything above
  // the floor on one of these is unusable.
  if (renderer.includes('swiftshader') || renderer.includes('llvmpipe')) return 'low';

  const cores = navigator.hardwareConcurrency ?? 4;
  // Non-standard and absent on Safari and Firefox, so it can only ever be used
  // to move *down*: its absence must not imply a weak machine.
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  // A coarse pointer with a small viewport is a phone, whatever the GPU says.
  const handheld =
    window.matchMedia('(pointer: coarse)').matches &&
    Math.min(window.innerWidth, window.innerHeight) < 820;
  if (handheld) return 'low';

  if (cores <= 4 || (memory !== undefined && memory <= 4)) return 'low';

  if (CAPABLE.some((token) => renderer.includes(token)) && cores >= 8) return 'high';
  if (MODEST.some((token) => renderer.includes(token))) return 'medium';

  // Nothing conclusive. Medium is the honest default: it is the tier that
  // looks right on the machines this cannot identify, and being wrong towards
  // "smooth" is much less costly than being wrong towards "pretty".
  return cores >= 8 ? 'high' : 'medium';
}

/**
 * Decided once per page load and cached.
 *
 * Re-deciding per component would let two systems disagree about which room
 * they are drawing, and `detectTier` allocates a throwaway WebGL context.
 */
let cached: QualitySettings | null = null;

export function quality(): QualitySettings {
  if (cached) return cached;
  const tier = override() ?? detectTier();
  cached = { tier, ...PRESETS[tier] };
  return cached;
}

/** `?quality=low` — for testing a tier without owning the hardware. */
function override(): Tier | null {
  if (typeof window === 'undefined') return null;
  const asked = new URLSearchParams(window.location.search).get('quality');
  return asked === 'low' || asked === 'medium' || asked === 'high' ? asked : null;
}
