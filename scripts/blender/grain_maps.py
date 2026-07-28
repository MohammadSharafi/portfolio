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


# ---------------------------------------------------------------------------
# The rug
# ---------------------------------------------------------------------------
#
# An Isfahan medallion carpet, drawn rather than tiled. Everything else in this
# module is surface break-up that repeats every half metre; a carpet is a single
# design that must span the whole object exactly once, so it gets its own
# function, its own resolution, and a full-colour output instead of a greyscale
# multiplier.
#
# It is tractable to draw because a medallion carpet is symmetric about both
# axes: compose one quadrant and mirror it twice. The borders are a motif
# repeated along a path. Neither needs a single hand-placed vertex.

RUG_SIZE = 2048

# Natural dyes, in linear space. Madder is a deep brick with a brown undertone,
# not a primary red — getting that wrong is the difference between an Isfahan
# carpet and a doormat.
_MADDER = (0.185, 0.038, 0.030)
_INDIGO = (0.030, 0.055, 0.135)
_IVORY = (0.700, 0.630, 0.480)
_GOLD = (0.430, 0.280, 0.070)
_GREEN = (0.045, 0.115, 0.080)
_RUST = (0.320, 0.110, 0.045)


def _lay(image: np.ndarray, mask: np.ndarray, colour) -> None:
    for channel in range(3):
        image[..., channel] = np.where(mask, colour[channel], image[..., channel])


def _band(value: np.ndarray, centre: float, width: float) -> np.ndarray:
    return np.abs(value - centre) < width


def persian_rug() -> np.ndarray:
    """A madder-red Isfahan medallion carpet, RGB, spanning the whole rug once."""
    n = RUG_SIZE
    rng = np.random.default_rng(1361)
    y, x = np.mgrid[0:n, 0:n] / (n - 1.0)
    u, v = x - 0.5, y - 0.5
    radius = np.sqrt(u * u + (v * 1.12) ** 2)
    angle = np.arctan2(v, u)
    edge = np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y))

    image = np.empty((n, n, 3))
    _lay(image, np.ones_like(x, dtype=bool), _MADDER)

    # The field: arabesque vine scrolls. Thin continuous stems, made by taking a
    # sine wave whose phase is warped by another wave and keeping only the
    # values near zero. Thresholding a *product* of two waves instead — the
    # first attempt — widens the line wherever either factor passes through
    # zero, so the tracery came out as large amorphous blobs covering half the
    # field. An Isfahan field is mostly red with fine ornament drawn over it.
    def stem(freq: float, warp: float, wobble: float, phase: float, axis: int) -> np.ndarray:
        drive = (x, y)[axis] * freq
        cross = (y, x)[axis] * wobble
        return np.abs(np.sin(np.pi * drive + warp * np.sin(np.pi * cross + phase)))

    _lay(image, stem(19, 1.05, 7, 0.0, 0) < 0.030, _IVORY)
    _lay(image, stem(17, 1.15, 6, 1.4, 1) < 0.030, _IVORY)
    _lay(image, stem(27, 0.85, 9, 2.1, 0) < 0.016, _GOLD)
    _lay(image, stem(25, 0.95, 8, 0.6, 1) < 0.016, _GOLD)
    _lay(image, stem(37, 0.70, 13, 1.9, 0) < 0.009, _GREEN)

    # Rosettes where the stems cross, alternating ivory and gold, and a scatter
    # of small palmettes between them.
    knot = (stem(19, 1.05, 7, 0.0, 0) < 0.075) & (stem(17, 1.15, 6, 1.4, 1) < 0.075)
    _lay(image, knot, _GOLD)
    _lay(image, knot & (stem(19, 1.05, 7, 0.0, 0) < 0.035), _IVORY)
    buds = (np.sin(19 * np.pi * x + 1.6) * np.sin(17 * np.pi * y + 0.4)) > 0.988
    _lay(image, buds, _IVORY)

    # The medallion — toranj. A lobed rosette, which is a circle whose radius is
    # modulated by the angle, plus concentric rings and two pendants on the long
    # axis. Sixteen lobes is the usual count.
    lobed = 0.212 * (1.0 + 0.155 * np.cos(16 * angle))
    _lay(image, radius < lobed, _INDIGO)
    _lay(image, _band(radius, lobed * 0.93, 0.006), _IVORY)
    _lay(image, radius < lobed * 0.72, _RUST)
    _lay(image, _band(radius, lobed * 0.60, 0.005), _GOLD)
    # The rosette at the centre, and a ring of small lobes inside it.
    _lay(image, radius < 0.085 * (1.0 + 0.22 * np.cos(12 * angle)), _IVORY)
    _lay(image, radius < 0.040 * (1.0 + 0.30 * np.cos(8 * angle)), _INDIGO)

    # Pendants, above and below.
    for sign in (-1.0, 1.0):
        # Close enough to overlap the medallion's lobes: a pendant is hung from
        # the toranj, not set beside it.
        pv = (v - sign * 0.255) * 2.2
        stalk = np.sqrt(u * u * 26.0 + (v - sign * 0.20) ** 2 * 1.4) < 0.075
        _lay(image, stalk, _INDIGO)
        pendant = np.sqrt(u * u * 6.5 + pv * pv) < 0.155 * (1 + 0.22 * np.cos(12 * angle))
        _lay(image, pendant, _INDIGO)
        _lay(image, np.sqrt(u * u * 8.5 + pv * pv) < 0.085, _RUST)
        _lay(image, np.sqrt(u * u * 14.0 + pv * pv) < 0.040, _IVORY)

    # Corner spandrels — lachak. Ivory quarter-fans in each corner, which is
    # what frames the field and makes the medallion read as floating in it.
    corner = np.minimum(np.abs(u), np.abs(v)) * 0 + np.sqrt(
        (np.abs(u) - 0.5) ** 2 + (np.abs(v) - 0.5) ** 2
    )
    spandrel = corner < 0.235 * (1.0 + 0.10 * np.cos(10 * angle))
    _lay(image, spandrel, _IVORY)
    _lay(image, spandrel & (stem(23, 0.9, 8, 0.7, 0) < 0.030), _RUST)
    _lay(image, spandrel & (stem(21, 1.0, 7, 2.2, 1) < 0.026), _INDIGO)
    _lay(image, spandrel & (corner > 0.225), _INDIGO)

    # The border system: a wide main border between two narrow guard borders.
    _lay(image, _band(edge, 0.052, 0.006), _GOLD)
    main = _band(edge, 0.030, 0.020)
    _lay(image, main, _INDIGO)
    # Its repeating motif — alternating palmettes along the run, made from a
    # single periodic function of whichever axis the border is running along.
    along = np.where(np.minimum(x, 1 - x) < np.minimum(y, 1 - y), y, x)
    across = (edge - 0.030) / 0.020
    # Cartouches: a lozenge repeated along the run, alternating in size, with a
    # vine threaded between them. Straight stripes read as tape, not weaving.
    beat = np.sin(64 * np.pi * along)
    lozenge = (np.abs(across) + np.abs(beat) * 0.55) < 0.62
    _lay(image, main & lozenge, _IVORY)
    _lay(image, main & lozenge & ((np.abs(across) + np.abs(beat) * 0.55) < 0.30), _RUST)
    _lay(image, main & (np.abs(np.sin(64 * np.pi * along + 1.57)) < 0.10) & (np.abs(across) > 0.55), _GOLD)
    _lay(image, _band(edge, 0.010, 0.005), _GOLD)
    _lay(image, edge < 0.005, _MADDER)

    # Abrash: faint horizontal bands where the dye lot changed mid-weave. The
    # single clearest signal that a carpet was knotted by hand rather than
    # printed, and it costs one line.
    lots = np.cumsum(rng.normal(0, 1, n)) * 0.004
    image *= (1.0 + lots[:, None] * 0.55)[..., None]

    # Wool, and the knot grid it is tied on.
    knots = 1.0 + 0.055 * np.sin(np.pi * n * x / 11.0) * np.sin(np.pi * n * y / 11.0)
    image *= (knots * (1.0 + rng.normal(0, 0.018, (n, n))))[..., None]

    # Traffic wear along the path from the door, and under the chair castors.
    wear = 1.0 - 0.20 * np.exp(-(((x - 0.30) / 0.16) ** 2 + ((y - 0.62) / 0.42) ** 2))
    image *= wear[..., None]

    # The fringe: warp threads running past the pile at the two ends, uneven and
    # missing a few. It is the warp itself, not a trim added to the edges.
    strands = (np.sin(np.pi * n * x / 3.0) > -0.2) & (rng.random((n, n)) > 0.04)
    for lo, hi in ((0.0, 0.022), (0.978, 1.0)):
        ends = (y >= lo) & (y <= hi) & strands
        _lay(image, ends, (0.62, 0.57, 0.46))
        _lay(image, (y >= lo) & (y <= hi) & ~strands, (0.05, 0.05, 0.06))

    return np.clip(image, 0.0, 1.0)


def persian_rug_normal() -> np.ndarray:
    """Pile depth for the carpet, from the luminance of its own design."""
    height = persian_rug().mean(axis=2)
    height = 0.55 * height + 0.45 * _noise_at(RUG_SIZE, 1.0, (1.0, 2.6))
    scale = 0.006 * RUG_SIZE / 3.7  # 6 mm of pile across a 3.7 m rug
    dx = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * scale
    dy = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * scale
    length = np.sqrt(dx * dx + dy * dy + 1.0)
    out = np.empty((RUG_SIZE, RUG_SIZE, 3))
    out[..., 0] = (-dx / length) * 0.5 + 0.5
    out[..., 1] = (-dy / length) * 0.5 + 0.5
    out[..., 2] = (1.0 / length) * 0.5 + 0.5
    return out


def _noise_at(size: int, beta: float, stretch: tuple[float, float]) -> np.ndarray:
    """`_noise`, at an arbitrary resolution."""
    rng = np.random.default_rng(4711)
    fx = np.fft.fftfreq(size)[:, None] * stretch[0]
    fy = np.fft.fftfreq(size)[None, :] * stretch[1]
    radius = np.sqrt(fx * fx + fy * fy)
    radius[0, 0] = 1.0
    spectrum = rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))
    spectrum /= radius**beta
    spectrum[0, 0] = 0.0
    field = np.fft.ifft2(spectrum).real
    span = field.max() - field.min()
    return (field - field.min()) / (span if span else 1.0)
