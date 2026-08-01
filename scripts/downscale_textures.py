#!/usr/bin/env python3
"""Half-size lightmap and aging atlas, for devices that cannot afford the full ones.

The room ships a 4096 lightmap and a 2048 aging mask. On disk that is about
4 MB, which is fine; in GPU memory it is roughly 67 MB and 16 MB once decoded
to RGBA, which on a phone is most of a modest texture budget spent before a
single piece of the room's own geometry has been uploaded. The symptom is not a
lower frame rate — it is the tab being evicted and reloading, which reads as the
site being broken.

Halving each dimension quarters the memory: 17 MB and 4 MB. What it costs is
resolution the small screen could not resolve anyway. A 4096 atlas spread over
an entire room is near a centimetre per texel; at 2048 it is two, which is
still finer than a 375-pixel-wide viewport can show of a whole room.

Run after a bake — `bake_room.py` calls it, and it is safe to run on its own:

    python3 scripts/downscale_textures.py
"""

from __future__ import annotations

import sys
from pathlib import Path

MODELS = Path(__file__).resolve().parent.parent / "public" / "models"

# (source, destination, longest edge). The lightmap is a JPEG and stays one —
# it is smooth, low-frequency light and compresses beautifully. The aging mask
# is a PNG and stays one: its three channels are read independently by the
# shader, and JPEG's chroma subsampling would bleed dust into wear.
WORK = [
    ("room-lightmap.jpg", "room-lightmap-half.jpg", 2048),
    ("room-aging.png", "room-aging-half.png", 1024),
]


def main() -> int:
    try:
        from PIL import Image
    except ImportError:
        print(
            "Pillow is not installed, so the half-size textures were not written.\n"
            "The site still works — every device just loads the full ones.\n"
            "    pip install Pillow",
            file=sys.stderr,
        )
        return 0

    written = 0
    for source_name, out_name, edge in WORK:
        source = MODELS / source_name
        if not source.exists():
            print(f"[downscale] {source_name} is not there yet; skipped", file=sys.stderr)
            continue

        with Image.open(source) as image:
            if max(image.size) <= edge:
                print(f"[downscale] {source_name} is already {image.size[0]}; skipped")
                continue
            # Lanczos rather than the default: both of these are sampled by UV
            # rather than blitted, so any aliasing introduced here is baked into
            # every surface in the room and cannot be filtered out later.
            small = image.resize((edge, edge), Image.LANCZOS)
            out = MODELS / out_name
            if out.suffix == ".jpg":
                small.save(out, quality=88, optimize=True, subsampling=0)
            else:
                small.save(out, optimize=True)

        print(f"[downscale] wrote {out.name} ({out.stat().st_size / 1024:.0f} KB)")
        written += 1

    return 0 if written or True else 1


if __name__ == "__main__":
    raise SystemExit(main())
