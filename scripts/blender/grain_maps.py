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

# How far the border system reaches in from each edge, as a fraction of the
# carpet. Named because the spandrels are positioned against it: a lachak sits
# in the corner of the *field*, so both have to agree about where the field
# starts or the corners come out half-buried.
BORDER_DEPTH = 0.098

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


def _rosette(r: np.ndarray, a: np.ndarray, size: float, lobes: int, depth: float) -> np.ndarray:
    """A lobed rosette — the shape almost every Persian motif is built from."""
    return r < size * (1.0 + depth * np.cos(lobes * a))


def persian_rug() -> np.ndarray:
    """A madder-red Isfahan medallion carpet, RGB, spanning the whole rug once."""
    n = RUG_SIZE
    rng = np.random.default_rng(1361)
    y, x = np.mgrid[0:n, 0:n] / (n - 1.0)
    u, v = x - 0.5, y - 0.5

    # Every motif below is a function of |u| and |v| rather than of u and v.
    #
    # That one substitution is what makes the carpet look woven instead of
    # generated, and it is the whole reason an Isfahan is tractable to draw. A
    # medallion carpet is symmetric about both axes, so a design expressed in
    # absolute coordinates is four-fold symmetric for free — no quadrant to
    # compose and mirror by hand, no seam down the middle to hide.
    #
    # The previous field was drawn from sine waves of u and v directly. Nothing
    # lined up with anything, so instead of arabesque it produced a warped mesh
    # that read as chicken wire stretched over the field, and the eye
    # immediately knew it was looking at noise rather than ornament.
    au, av = np.abs(u), np.abs(v)
    edge = np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y))
    angle = np.arctan2(v, u)
    radius = np.sqrt(u * u + (v * 1.06) ** 2)

    image = np.empty((n, n, 3))
    _lay(image, np.ones_like(x, dtype=bool), _MADDER)

    # ---------------------------------------------------------------- field
    #
    # A herati lattice: the commonest Persian field pattern there is, and the
    # one most people would actually recognise. Each repeat is a diamond with a
    # rosette at its centre and four curved leaves lying along the diagonals.
    #
    # Taking the modulus of |u| rather than of u keeps the lattice registered to
    # the centre of the carpet, so the repeat mirrors about both axes and the
    # medallion lands on a node instead of halfway between four of them.
    def lattice(period: float, offset: float = 0.0):
        lu = ((au + offset) / period) % 1.0 - 0.5
        lv = ((av + offset) / period) % 1.0 - 0.5
        return lu, lv, np.sqrt(lu * lu + lv * lv), np.arctan2(lv, lu)

    period = 0.118
    lu, lv, lr, la = lattice(period)

    # The vine that links each repeat to its neighbours, then the diamond it
    # encloses. Thin: an Isfahan field is mostly ground with fine ornament over
    # it, and a heavy line turns the lattice into a cage.
    _lay(image, np.abs(np.abs(lu) + np.abs(lv) - 0.42) < 0.011, _GOLD)
    _lay(image, np.abs(np.abs(lu) + np.abs(lv) - 0.30) < 0.007, _GREEN)

    # The four leaves — the "fish" of herati — lying along the diagonals of each
    # cell, curved by biasing the band with the radius.
    leaf = (np.abs(np.abs(lu) - np.abs(lv)) < 0.052 - 0.06 * lr) & (lr > 0.135) & (lr < 0.335)
    _lay(image, leaf, _GREEN)
    _lay(image, leaf & (np.abs(np.abs(lu) - np.abs(lv)) < 0.020 - 0.03 * lr), _IVORY)

    # The rosette at every node.
    _lay(image, _rosette(lr, la, 0.108, 8, 0.26), _IVORY)
    _lay(image, _rosette(lr, la, 0.074, 8, 0.30), _RUST)
    _lay(image, _rosette(lr, la, 0.036, 8, 0.34), _INDIGO)

    # A second lattice, offset half a cell, carrying small palmettes into the
    # gaps the first one leaves. Density is what separates a carpet from a
    # tablecloth; a single lattice reads as far too sparse.
    lu2, lv2, lr2, la2 = lattice(period, period / 2.0)
    _lay(image, _rosette(lr2, la2, 0.052, 6, 0.40), _GOLD)
    _lay(image, _rosette(lr2, la2, 0.022, 6, 0.40), _IVORY)

    # ------------------------------------------------------------ medallion
    #
    # The toranj. Sixteen shallow lobes, not a starburst: a lobe on a real
    # medallion is a rounded scallop, and driving the modulation hard enough to
    # see from across the room turns it into a cog.
    lobed = 0.225 * (1.0 + 0.072 * np.cos(16 * angle))
    _lay(image, radius < lobed + 0.012, _IVORY)
    _lay(image, radius < lobed, _INDIGO)
    # Ornament inside the medallion, so it is not a flat disc of blue.
    inner = radius < lobed * 0.90
    _lay(image, inner, _INDIGO)
    # A ring of small rosettes set around the medallion's inner field, placed by
    # angle so they follow its edge. Borrowing the field lattice for this instead
    # laid a bare X of crossing diagonals across the middle of the toranj —
    # the lattice is registered to the carpet, not to the medallion, so nothing
    # it produces here lands anywhere meaningful.
    #
    # Discrete blobs, found by distance to eight points on a ring, rather than a
    # radial band gated by the angle. The gated band is the obvious way to write
    # it and produces spokes: it keeps a *wedge* at every angle that passes the
    # test, so the ornament fans out into a cartwheel instead of resolving into
    # separate flowers.
    sector = 2.0 * np.pi / 8.0
    offset = (angle % sector) - sector / 2.0
    seat = lobed * 0.74
    blob = np.sqrt((radius - seat) ** 2 + (seat * offset) ** 2)
    _lay(image, inner & (blob < 0.032), _GOLD)
    _lay(image, inner & (blob < 0.017), _IVORY)
    _lay(image, radius < lobed * 0.62, _RUST)
    _lay(image, _band(radius, lobed * 0.62, 0.005), _GOLD)
    _lay(image, radius < lobed * 0.50, _MADDER)
    _lay(image, _rosette(radius, angle, 0.082, 12, 0.20), _IVORY)
    _lay(image, _rosette(radius, angle, 0.056, 12, 0.24), _INDIGO)
    _lay(image, _rosette(radius, angle, 0.026, 8, 0.30), _GOLD)

    # Pendants, hung from the medallion on the long axis. Written against |v| so
    # both ends are identical without drawing either of them twice.
    pv = (av - 0.300) * 2.1
    stalk = (np.sqrt(u * u * 30.0 + (av - 0.245) ** 2 * 1.4) < 0.070) & (av > 0.18)
    _lay(image, stalk, _INDIGO)
    pendant = np.sqrt(u * u * 7.0 + pv * pv) < 0.150 * (1 + 0.14 * np.cos(12 * angle))
    _lay(image, pendant, _IVORY)
    _lay(image, np.sqrt(u * u * 7.6 + pv * pv) < 0.130 * (1 + 0.14 * np.cos(12 * angle)), _INDIGO)
    _lay(image, np.sqrt(u * u * 9.5 + pv * pv) < 0.078, _RUST)
    _lay(image, np.sqrt(u * u * 15.0 + pv * pv) < 0.034, _GOLD)

    # ------------------------------------------------------------ spandrels
    #
    # Lachak: quarter-medallions in the corners, which is what frames the field
    # and makes the toranj read as floating rather than as a stamp. Measured
    # from the corner, with a scalloped inner edge so it meets the field the way
    # the medallion does — a plain circular arc reads as a cream blob, which is
    # exactly what the previous pass produced.
    # Measured from the corner of the *field*, not the corner of the carpet.
    #
    # A lachak is a quarter-medallion sitting in the field's corner, so its
    # centre is where the two inner guard borders would meet. Measuring from the
    # carpet's own corner instead puts the centre of the fan underneath the
    # border, which then overdraws most of it — what was left showing was a thin
    # crescent with a hook on the end, and it read as damage rather than as
    # ornament.
    field_corner = 0.5 - BORDER_DEPTH
    du, dv = field_corner - au, field_corner - av
    corner = np.sqrt(du * du + dv * dv)
    # Five scallops across the quarter turn, from an angle measured about that
    # same corner. Guarded against the origin, where the angle is undefined and
    # an unguarded arctan2 makes the modulation thrash.
    corner_angle = np.arctan2(dv, np.where(np.abs(du) < 1e-6, 1e-6, du))
    # Sized so the field still reads as the carpet's subject. At 0.250 the four
    # fans met the medallion and squeezed the madder ground into a thin cross.
    lip = 0.170 * (1.0 + 0.060 * np.cos(20 * corner_angle))
    spandrel = (corner < lip) & (du > -0.02) & (dv > -0.02)
    _lay(image, spandrel, _IVORY)
    # Ornament inside it, from the same lattice the field uses so the two agree.
    _lay(image, spandrel & (np.abs(np.abs(lu) + np.abs(lv) - 0.42) < 0.011), _RUST)
    _lay(image, spandrel & leaf, _GREEN)
    _lay(image, spandrel & _rosette(lr, la, 0.074, 8, 0.30), _INDIGO)
    _lay(image, spandrel & _rosette(lr, la, 0.036, 8, 0.34), _RUST)
    # A gold hairline just inside the scalloped edge, then the edge itself.
    _lay(image, spandrel & _band(corner, lip - 0.016, 0.003), _GOLD)
    _lay(image, spandrel & (corner > lip - 0.006), _INDIGO)

    # --------------------------------------------------------------- border
    #
    # A wide main border between two narrow guards, which is the standard
    # system. Proportions matter more than the motifs: a border under about a
    # tenth of the width reads as a picture frame rather than as part of the
    # weaving.
    along = np.where(np.minimum(x, 1 - x) < np.minimum(y, 1 - y), y, x)
    # Mirrored about the middle of each side, so the run of cartouches is
    # symmetric and the corners resolve instead of being cut off mid-motif.
    beat = np.abs(along - 0.5)

    _lay(image, edge < BORDER_DEPTH, _INDIGO)

    # Outer guard.
    _lay(image, _band(edge, 0.086, 0.011), _GOLD)
    _lay(image, _band(edge, 0.086, 0.011) & (np.abs(np.sin(70 * np.pi * beat)) < 0.42), _MADDER)

    # Main border: alternating palmettes threaded on a vine.
    main = edge < 0.078
    across = (edge - 0.039) / 0.039
    node = np.abs(np.sin(26 * np.pi * beat))
    _lay(image, main & (np.abs(across) < 0.10), _GOLD)
    big = main & ((np.abs(across) * 0.85 + (1.0 - node) * 1.5) < 0.60)
    _lay(image, big, _IVORY)
    _lay(image, big & ((np.abs(across) * 0.85 + (1.0 - node) * 1.5) < 0.34), _RUST)
    _lay(image, big & ((np.abs(across) * 0.85 + (1.0 - node) * 1.5) < 0.15), _INDIGO)
    small = main & ((np.abs(across) * 1.6 + node * 1.5) < 0.55)
    _lay(image, small, _GOLD)
    _lay(image, small & ((np.abs(across) * 1.6 + node * 1.5) < 0.28), _IVORY)

    # Inner guard, then the selvedge the pile is bound off against.
    _lay(image, _band(edge, 0.026, 0.010), _GOLD)
    _lay(image, _band(edge, 0.026, 0.010) & (np.abs(np.sin(70 * np.pi * beat)) < 0.42), _MADDER)
    _lay(image, edge < 0.012, _INDIGO)
    _lay(image, edge < 0.006, _RUST)

    # ----------------------------------------------------------------- wool
    #
    # Abrash: faint horizontal bands where the dye lot changed mid-weave. The
    # single clearest signal that a carpet was knotted by hand rather than
    # printed, and it costs one line.
    lots = np.cumsum(rng.normal(0, 1, n)) * 0.004
    image *= (1.0 + lots[:, None] * 0.55)[..., None]

    # Wool, and the knot grid it is tied on.
    knots = 1.0 + 0.055 * np.sin(np.pi * n * x / 11.0) * np.sin(np.pi * n * y / 11.0)
    image *= (knots * (1.0 + rng.normal(0, 0.018, (n, n))))[..., None]

    # Pile direction. The nap lies one way, so the carpet is lighter seen from
    # one end and darker from the other — miss it and the whole thing reads as
    # wallpaper lying on the floor. A gentle gradient along the weave, which the
    # anisotropic sheen in the normal map then agrees with.
    image *= (1.0 + 0.10 * (y - 0.5))[..., None]

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
