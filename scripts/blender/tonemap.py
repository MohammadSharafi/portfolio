"""
The view transform the room is finished through.

Cycles renders and bakes in scene-linear radiance, which is unbounded: a monitor
panel or an LED can sit at 8.0 while the wall behind it sits at 0.4. A PNG holds
0..1. Something has to map one onto the other, and *which* something is most of
the difference between a render that looks photographed and one that looks like
a screenshot of a 3D program.

Baking straight to an 8-bit image, which is what this project did first, takes
the cheapest possible option: hard-clip at 1.0. Every value above one becomes
pure white, so the lamp, the screens, the LED strips and the sky through the
window all resolve to the same flat #ffffff with no shape and no colour — a
violet strip clips to white the moment it is bright enough to notice. Worse, the
clip is per-channel, so a warm highlight loses red first and *shifts hue* on its
way to white.

A filmic curve compresses the top end instead of severing it. Highlights roll
off, keep their hue and stay separable, and the shadows get a gentle toe that
stops the dark half of the room crushing to black. The curve here is Krzysztof
Narkowicz's ACES fit — the same shape three.js applies as `ACESFilmicToneMapping`
— which matters because the baked room draws through `MeshBasicMaterial` with
`toneMapped: false`. The atlas *is* the final image, so it has to leave here in
exactly the state the browser would otherwise have put it in.
"""

from __future__ import annotations

import numpy as np

# Rec. 709 luminance weights, for the saturation step below.
_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def aces(rgb: np.ndarray) -> np.ndarray:
    """
    Narkowicz's ACES filmic approximation, per channel.

    The 0.6 pre-scale is part of the fit: it places middle grey where the curve
    expects it, and dropping it (easy to do, since the formula looks complete
    without it) lifts the whole image about a third of a stop and flattens the
    toe.
    """
    x = rgb * 0.6
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def saturate(rgb: np.ndarray, amount: float) -> np.ndarray:
    """
    Push chroma back in.

    Every filmic curve desaturates as it compresses, because the brightest
    channel is squeezed hardest — which is correct for film and wrong for a room
    whose whole identity is a violet wall facing a cyan one. Without this the
    two washes converge on white exactly where they are strongest, and the room
    reads as grey again in precisely the places the colour was meant to live.
    """
    if amount == 1.0:
        return rgb
    luma = rgb @ _LUMA
    return np.clip(luma[..., None] + (rgb - luma[..., None]) * amount, 0.0, 1.0)


def apply(
    pixels: np.ndarray,
    *,
    exposure: float = 0.0,
    saturation: float = 1.12,
) -> np.ndarray:
    """
    Scene-linear RGB(A) in, display-linear RGB(A) out.

    Display-*linear*, not sRGB-encoded — `encode_srgb` does that, and only when
    the result is on its way to a file. Keeping the two steps apart is what lets
    the preview render and the atlas share this function while writing their
    pixels out through different paths.

    `exposure` is in stops, so +1 doubles the light.
    """
    working = pixels.astype(np.float32, copy=True)
    has_alpha = working.shape[-1] == 4
    rgb = working[..., :3]

    rgb *= np.float32(2.0**exposure)
    rgb = aces(rgb)
    rgb = saturate(rgb, saturation)

    if has_alpha:
        # The bake writes coverage into alpha; the atlas is opaque and any
        # partially transparent texel is a seam waiting to sample background.
        return np.concatenate([rgb, np.ones_like(working[..., 3:])], axis=-1)
    return rgb


def encode_srgb(rgb: np.ndarray) -> np.ndarray:
    """Display-linear float to sRGB-encoded uint8, via the real piecewise OETF."""
    x = np.clip(rgb, 0.0, 1.0)
    low = x * 12.92
    high = 1.055 * np.power(np.maximum(x, 1e-8), 1.0 / 2.4) - 0.055
    return np.rint(np.where(x <= 0.0031308, low, high) * 255.0).astype(np.uint8)


def write_png(path: str, rgb8: np.ndarray) -> None:
    """
    An 8-bit RGB PNG, written here rather than through `Image.save`.

    Blender's saver decides both the bit depth and whether to apply a transfer
    function from the image's float-ness and its colorspace, and it does not do
    what the obvious reading of either suggests: a float-buffer image saves as
    *16-bit* with the pixels written raw, no sRGB encode, whatever
    `colorspace_settings` says. Baking into a float buffer — which the highlight
    rolloff requires, since an 8-bit buffer clamps before the curve can run —
    therefore silently produced a 15 MB 16-bit atlas full of linear values, which
    the browser then decoded as sRGB and drew about two stops too dark.

    Sixty lines of zlib is a smaller price than a pipeline whose colour depends
    on guessing another program's conventions. What goes in is what lands on
    disk.
    """
    import struct
    import zlib

    height, width, channels = rgb8.shape
    if channels != 3:
        raise ValueError(f"expected RGB, got {channels} channels")

    # Each scanline is prefixed with its filter type; 0 means "none".
    raw = np.concatenate(
        [np.zeros((height, 1), dtype=np.uint8), rgb8.reshape(height, width * 3)], axis=1
    ).tobytes()

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        # 8 bits per channel, colour type 2 (truecolour), no interlacing.
        handle.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)))
        handle.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        handle.write(chunk(b"IEND", b""))
