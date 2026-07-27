"""
Seamless surface textures, synthesised rather than downloaded.

The room ships one GLB and no texture library. Every earlier attempt at surface
detail lived in a Blender node graph, which the glTF exporter cannot carry — it
writes a flat colour and drops the graph — so the model that actually reached
the browser was untextured plastic, and the only textured version of the room
was the one produced by a bake nobody had run yet. That is the wrong way round:
the thing on the web should be the good one.

So the maps are generated here as images, packed into the GLB, and used by the
plain export. No network, no asset pipeline, no licence to track.

Each map tiles exactly. The noise is built in the frequency domain — a random
spectrum with a 1/f falloff, inverse-transformed — which is periodic by
construction, so there is no seam to hide and no blending to get wrong. Shaping
the spectrum anisotropically is what separates wood from brushed aluminium:
both are 1/f noise, one is stretched a hundred times further along one axis.
"""

from __future__ import annotations

import math

import numpy as np

# 256 is not a compromise. These are surface break-up, not detail anyone reads:
# they tile every half metre, so a 256 px map lands around 500 texels/m, finer
# than the bake atlas resolves and finer than the room is ever seen at. Doubling
# it would quadruple the bytes on the wire for nothing visible.
SIZE = 256

# How many metres one tile of the texture covers. Every mesh's UVs are scaled to
# this at export, so a desk and a mug show grain at the same physical size —
# without it, unwrapping packs each object into 0..1 and a coffee mug ends up
# with the grain of a floorboard.
TILE_METRES = 0.5


def _noise(rng: np.random.Generator, beta: float, stretch: tuple[float, float]) -> np.ndarray:
    """
    Tiling fractal noise, shaped in the frequency domain.

    `beta` is the spectral falloff: 1.0 is rough and grainy, 2.5 is soft and
    cloudy. `stretch` scales the frequency axes, so (40, 1) makes long fibres
    running along U.
    """
    fx = np.fft.fftfreq(SIZE)[:, None] * stretch[0]
    fy = np.fft.fftfreq(SIZE)[None, :] * stretch[1]
    radius = np.sqrt(fx * fx + fy * fy)
    radius[0, 0] = 1.0  # The DC term carries the mean; it is zeroed below.

    spectrum = rng.normal(size=(SIZE, SIZE)) + 1j * rng.normal(size=(SIZE, SIZE))
    spectrum /= radius**beta
    spectrum[0, 0] = 0.0

    field = np.fft.ifft2(spectrum).real
    span = field.max() - field.min()
    return (field - field.min()) / (span if span else 1.0)


def _weave(over: int) -> np.ndarray:
    """A woven over-and-under, for upholstery. `over` is threads per tile."""
    u = np.linspace(0, 2 * math.pi * over, SIZE, endpoint=False)[:, None]
    v = np.linspace(0, 2 * math.pi * over, SIZE, endpoint=False)[None, :]
    warp = np.sin(u) * 0.5 + 0.5
    weft = np.sin(v) * 0.5 + 0.5
    # Alternating squares take the warp or the weft, which is what makes a
    # weave read as threads crossing rather than as a grid.
    checker = ((np.floor(u / math.pi) + np.floor(v / math.pi)) % 2).astype(float)
    return warp * checker + weft * (1 - checker)


def _height(kind: str) -> np.ndarray:
    """The height field a surface's whole appearance is derived from, 0..1."""
    rng = np.random.default_rng(abs(hash(kind)) % (2**32))

    if kind == "wood":
        # Growth rings: smooth noise pushed through a sine, so the bands are
        # sharp where they crowd together and soft where they spread.
        base = _noise(rng, 2.2, (1.0, 26.0))
        rings = np.sin(base * 26.0) * 0.5 + 0.5
        fibre = _noise(rng, 1.1, (1.0, 60.0))
        return np.clip(rings * 0.62 + fibre * 0.38, 0, 1)

    if kind == "fabric":
        # 64 threads to the tile is about 8 mm each, which is as fine as a
        # 256 px map covering half a metre can resolve without the weave
        # turning to mush. At 34 it read as a garden trellis.
        return np.clip(_weave(64) * 0.6 + _noise(rng, 1.3, (1.0, 1.0)) * 0.4, 0, 1)

    if kind == "pile":
        # Carpet: short fibres, high contrast, laid one way.
        return np.clip(_noise(rng, 0.9, (1.0, 3.2)) * 1.25 - 0.12, 0, 1)

    if kind == "plaster":
        # Fine tooth, deliberately not cloud. A wall is 17 m² and the map tiles
        # every half metre across it, so anything with a recognisable shape in
        # it appears sixty times in a visible grid — the first version used a
        # soft 1/f^2.6 mottle and the walls came out stamped with rows of
        # identical comma-shaped smudges. Grain this fine has no shape to
        # recognise, so the repeat disappears.
        return np.clip(_noise(rng, 1.05, (1.0, 1.0)) * 0.85 + _noise(rng, 0.7, (1.0, 1.0)) * 0.15, 0, 1)

    if kind == "brushed":
        # Scratches running one way, almost no variation across them.
        return np.clip(_noise(rng, 1.0, (1.0, 220.0)), 0, 1)

    if kind == "paper":
        return np.clip(_noise(rng, 1.2, (1.0, 1.0)) * 0.5 + 0.25, 0, 1)

    return np.full((SIZE, SIZE), 0.5)


# Per surface: how far the albedo swings either side of the material colour, how
# far the roughness swings, and how deep the bump reads in metres. A single flat
# albedo is the thing that most reliably makes a rendered room look rendered.
_LOOK = {
    "wood": (0.30, 0.16, 0.0016),
    "fabric": (0.18, 0.12, 0.0009),
    "pile": (0.22, 0.10, 0.0028),
    # Kept faint on purpose. Painted plaster barely varies, and a wall is the
    # largest and flattest thing in the room — whatever is put on it is seen
    # over and over, so it has to be the thing you cannot quite see.
    "plaster": (0.05, 0.05, 0.0004),
    "brushed": (0.16, 0.22, 0.0004),
    "paper": (0.09, 0.05, 0.0004),
}

KINDS = tuple(_LOOK)


def albedo(kind: str) -> np.ndarray:
    """
    A greyscale multiplier around 1.0, applied to the material's own colour.

    Greyscale and shared, rather than a tinted map per material: the exporter
    turns `texture x colour` into a base colour texture and a factor, so twenty
    materials that share a surface type share one image in the GLB instead of
    carrying twenty near-identical copies of the same noise.
    """
    spread = _LOOK.get(kind, (0.0, 0.0, 0.0))[0]
    return np.clip(1.0 - spread + _height(kind) * spread * 2.0, 0.0, 1.0)


def roughness(kind: str, base: float) -> np.ndarray:
    spread = _LOOK.get(kind, (0.0, 0.0, 0.0))[1]
    return np.clip(base - spread + _height(kind) * spread * 2.0, 0.0, 1.0)


def normal(kind: str) -> np.ndarray:
    """
    A tangent-space normal map, from the height field's slope.

    `np.roll` for the differences, which is what keeps the map tiling: the
    gradient at the last column is measured against the first, exactly as it
    will be when the texture repeats.
    """
    depth = _LOOK.get(kind, (0.0, 0.0, 0.0))[2]
    height = _height(kind)
    # Slope in texels converted to slope in metres.
    scale = depth * SIZE / TILE_METRES
    dx = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * scale
    dy = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * scale

    length = np.sqrt(dx * dx + dy * dy + 1.0)
    out = np.empty((SIZE, SIZE, 3))
    out[..., 0] = (-dx / length) * 0.5 + 0.5
    out[..., 1] = (-dy / length) * 0.5 + 0.5
    out[..., 2] = (1.0 / length) * 0.5 + 0.5
    return out
