#!/usr/bin/env python3
"""LinkedIn-ready crops of the room, from the Cycles renders.

Different from `make_og_image.py`, and worth keeping separate. That one builds
the *link preview* — the rectangle a scraper reads out of the page's meta tags,
which is always 1200×630 and always carries the name and the pitch, because a
preview card has to explain itself with no post around it.

These are images to *upload*. They go in the post body, where the caption is
already doing the explaining, so they carry no text at all — a screenshot with
a headline baked into it reads as an advertisement, and a picture of a room
reads as work. They are also squarer, because a feed gives a 1:1 or 4:5 image
far more vertical space than a 1.91:1 one, and space is attention.

    blender --background --python scripts/blender/render_hero.py -- --view hero --width 2400
    python3 scripts/make_social_images.py

Writes into share/ — gitignored, since these are deliverables rather than
source.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RENDERS = ROOT / "scripts" / "blender" / "renders"
OUT = ROOT / "share"

# (render, output name, width, height, vertical bias)
#
# The bias moves the crop window up or down as a fraction of the slack, because
# every one of these frames has its content above the midline — the room's floor
# takes the bottom third and there is nothing in it worth the space.
JOBS = [
    ("og.png", "linkedin-room-square.png", 1200, 1200, -0.10),
    ("og.png", "linkedin-room-portrait.png", 1200, 1500, -0.06),
    ("hero.png", "linkedin-hero-square.png", 1200, 1200, -0.05),
    ("desk.png", "linkedin-desk-square.png", 1200, 1200, 0.0),
]


def main() -> int:
    try:
        from PIL import Image, ImageEnhance
    except ImportError:
        print("Pillow is required:  pip install Pillow", file=sys.stderr)
        return 1

    OUT.mkdir(exist_ok=True)
    written = 0

    for source_name, out_name, width, height, bias in JOBS:
        source = RENDERS / source_name
        if not source.exists():
            print(f"[social] {source_name} not rendered yet; skipped", file=sys.stderr)
            continue

        with Image.open(source) as raw:
            image = raw.convert("RGB")

        # Cover and crop, never letterbox.
        scale = max(width / image.width, height / image.height)
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)), Image.LANCZOS
        )
        left = (image.width - width) // 2
        slack = image.height - height
        top = max(0, min(slack, round(slack * (0.5 + bias))))
        crop = image.crop((left, top, left + width, top + height))

        # The same lift the card gets, and for the same reason: these are
        # physically correct night interiors, and a feed is scrolled past on a
        # phone in daylight. Gentler here — there is no text to keep legible,
        # so the only job is stopping it read as a dark smudge at thumbnail
        # size.
        crop = ImageEnhance.Brightness(crop).enhance(1.24)
        crop = ImageEnhance.Contrast(crop).enhance(1.04)

        target = OUT / out_name
        crop.save(target, optimize=True)
        print(f"[social] {out_name}  {width}x{height}  {target.stat().st_size / 1024:.0f} KB")
        written += 1

    if not written:
        print("[social] nothing written — render the views first", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
