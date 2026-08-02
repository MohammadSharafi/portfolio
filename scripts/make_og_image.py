#!/usr/bin/env python3
"""Compose the social card from a Cycles render of the room.

The card is the advertisement. A link to this site is shared into a feed as a
1200×630 rectangle, and for most people that rectangle *is* the site — it
decides whether anyone clicks at all. The previous card was a clean text
treatment: name, role, a line about the work, six technology chips. Everything
true, and it described a portfolio page. It said nothing about the one thing
that makes this link worth opening, which is that the portfolio is a room you
can walk around.

So the room is the card, and the words sit on it.

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

# Facebook and LinkedIn both crop toward the centre at some sizes, and X's
# summary_large_image is a wider ratio again — so nothing that must be read is
# allowed within this much of any edge.
SAFE = 56

NAME = "Mohammad Sharafi"
ROLE = "Software Engineer"
LINE = "A portfolio you can walk around."
# Kept short enough to finish inside the scrim. The longer version ran past
# the gradient's falloff and its last words landed on the lit monitors, which
# is the one place on this card where light type cannot be read.
SUB = "Procedural Blender room · React Three Fiber"


def font(size: int, bold: bool = False):
    """The best available system face at a size, falling back to Pillow's own.

    Deliberately forgiving: a missing font must produce a plainer card, never a
    crash and never a card with no words on it.
    """
    from PIL import ImageFont

    candidates = (
        [
            "/System/Library/Fonts/SFNSDisplay-Bold.otf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
        if bold
        else [
            "/System/Library/Fonts/SFNSDisplay.otf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    )
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main() -> int:
    try:
        from PIL import Image, ImageDraw
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

    # Lifted before anything is drawn on it.
    #
    # The render is a night interior and physically correct, which at
    # thumbnail size in a feed reads as a dark smudge — the card has to survive
    # being glanced at on a phone in daylight, scrolling past. A flat veil over
    # the top was the first attempt and did the opposite of what was wanted: it
    # dimmed the entire photograph to buy contrast behind the text, so the room
    # went muddy everywhere to solve a problem that only exists in the left
    # third. Brightening the picture and scrimming only where the words go
    # keeps the room bright and the type legible.
    from PIL import ImageEnhance

    card = ImageEnhance.Brightness(card).enhance(1.32)
    card = ImageEnhance.Contrast(card).enhance(1.06)

    # A scrim, heaviest at the left where the words go and gone by mid-frame.
    #
    # Drawn as its own gradient rather than a flat overlay because a flat one
    # dims the whole photograph to make one corner readable — the room ends up
    # muddy everywhere to solve a problem that exists in a third of the card.
    scrim = Image.new("L", (WIDTH, 1))
    for x in range(WIDTH):
        t = x / WIDTH
        # Opaque to about 40%, then falling away fast.
        value = 232 if t < 0.06 else max(0, int(232 * (1 - ((t - 0.06) / 0.58) ** 1.4)))
        scrim.putpixel((x, 0), value)
    mask = scrim.resize((WIDTH, HEIGHT))
    card = Image.composite(Image.new("RGB", (WIDTH, HEIGHT), (6, 8, 14)), card, mask)



    draw = ImageDraw.Draw(card)
    x = SAFE + 8
    y = 150

    draw.text((x, y), "PORTFOLIO", font=font(20, bold=True), fill=(122, 138, 168))
    y += 52

    draw.text((x, y), NAME, font=font(74, bold=True), fill=(247, 249, 252))
    y += 92

    draw.text((x, y), ROLE, font=font(30), fill=(150, 166, 196))
    y += 58

    draw.text((x, y), LINE, font=font(34, bold=True), fill=(226, 234, 246))
    y += 52

    draw.text((x, y), SUB, font=font(20), fill=(132, 148, 176))

    # The availability pill, bottom left, where a reader's eye lands last.
    pill_y = HEIGHT - SAFE - 40
    label = "Open to senior engineering roles"
    pill_font = font(20)
    text_w = draw.textlength(label, font=pill_font)
    draw.rounded_rectangle(
        (x, pill_y, x + text_w + 62, pill_y + 40), radius=20, fill=(18, 24, 36)
    )
    draw.ellipse((x + 20, pill_y + 16, x + 30, pill_y + 26), fill=(52, 211, 153))
    draw.text((x + 40, pill_y + 10), label, font=pill_font, fill=(198, 210, 230))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    card.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB, {WIDTH}x{HEIGHT})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
