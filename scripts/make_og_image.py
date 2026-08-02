#!/usr/bin/env python3
"""Compose the social card from a Cycles render of the room.

A link to this site is shared into a feed as a 1200×630 rectangle, and for most
people that rectangle *is* the site — it decides whether anyone clicks at all.
The first version of it was a clean text treatment: name, role, a line about the
work, six technology chips. Everything true, and it described a portfolio page.
It said nothing about the one thing that makes the link worth opening, which is
that the portfolio is a room you can walk around.

So the room is the card, and nothing is written on it. The platform prints the
title and the description beside the thumbnail as real text; anything painted
into the picture as well is the same sentence twice, and the second copy cannot
be selected, translated or read aloud. What is left is a photograph of the
place, which is the honest advertisement for it.

Composed here rather than screenshotted from the running site for the same
reason `render_hero.py` exists at all: the browser's room is a real-time
compromise — no refraction, no depth of field, a lightmap standing in for
global illumination — and a still has to pay none of that. The card is the
photograph; the site is the place.

    blender --background --python scripts/blender/render_hero.py -- --view og --width 2400
    python3 scripts/make_og_image.py

Writes public/og-image.png at 1200×630.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RENDER = ROOT / "scripts" / "blender" / "renders" / "og.png"
OUT = ROOT / "public" / "og-image.png"

WIDTH, HEIGHT = 1200, 630

# What used to be drawn here, and is not any more: a PORTFOLIO eyebrow, the
# name, the role, a tagline, a stack list, and an availability pill in the
# bottom corner. Also the gradient scrim behind them, which existed only so
# white type would hold against the lit monitors and with nothing to protect
# was just dimming a third of the picture.
#
# The pill is worth its own note, because it was the worst of them. A link
# preview is scraped once and then travels on its own — into a DM, a group
# chat, someone's saved links — and no platform lets you edit one after it has
# been cached. "Open to senior engineering roles" was therefore burned into an
# image with an unbounded lifetime, and it was the last thing the card said
# before the reader reached the link. The room says it in the contact panel
# instead, where it is current and where someone went looking for it.


def main() -> int:
    try:
        from PIL import Image
    except ImportError:
        print("Pillow is required:  pip install Pillow", file=sys.stderr)
        return 1

    if not RENDER.exists():
        print(
            f"{RENDER} is not there. Render it first:\n"
            "    blender --background --python scripts/blender/render_hero.py "
            "-- --view og --width 2400",
            file=sys.stderr,
        )
        return 1

    with Image.open(RENDER) as raw:
        room = raw.convert("RGB")

    # Cover, not fit: fill the card and crop the overflow rather than letterbox
    # it. The render is composed knowing this happens — see the `og` view.
    scale = max(WIDTH / room.width, HEIGHT / room.height)
    room = room.resize((round(room.width * scale), round(room.height * scale)), Image.LANCZOS)
    left = (room.width - WIDTH) // 2
    # Biased above centre. The room's floor occupies the bottom of the frame and
    # its content — desk, shelves, the lit wall — sits above the midline.
    top = max(0, (room.height - HEIGHT) // 2 - round(room.height * 0.04))
    card = room.crop((left, top, left + WIDTH, top + HEIGHT))

    # The render is a night interior and physically correct, which at thumbnail
    # size in a feed reads as a dark smudge — the card has to survive being
    # glanced at on a phone in daylight, scrolling past.
    #
    # Gentler than it was. The old numbers were set to keep white type legible
    # over lit monitors; with no type on the card, the only job left is stopping
    # the room going muddy at thumbnail size, and overdoing it costs the night
    # exactly the mood that makes anyone click.
    from PIL import ImageEnhance

    card = ImageEnhance.Brightness(card).enhance(1.24)
    card = ImageEnhance.Contrast(card).enhance(1.04)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    card.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB, {WIDTH}x{HEIGHT})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
