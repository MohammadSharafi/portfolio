"""
Builds "the digital office" in Blender and exports it as glTF.

Run headless, either against a real Blender install or the `bpy` PyPI module:

    blender --background --python scripts/blender/build_room.py
    python3 scripts/blender/build_room.py

The script is the source of truth for the room, not a .blend file. A binary
.blend cannot be reviewed in a diff, cannot be regenerated deterministically and
rots the moment someone nudges a vertex without telling anyone. Every object
here is placed by name and number, so re-blocking the room is a code change with
a history.

Objects that the web app makes interactive are named with an `ix_` prefix. The
runtime looks them up by that name, so renaming one here without renaming it in
`src/room/data/objects.ts` is a loud failure rather than a silent one.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import re
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector

# Blender runs this by path, so the script's own directory is not
# necessarily on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
OUT_DIR = os.path.join(ROOT, "public", "models")
OUT_GLB = os.path.normpath(os.path.join(OUT_DIR, "room.glb"))
# The shape of the room, hashed. The bake records the same value, and the build
# inlines it, so a lightmap is kept or discarded on whether the *geometry* still
# matches rather than on whether the whole file does. See
# `export_room.geometry_fingerprint`.
OUT_GEOMETRY = os.path.normpath(os.path.join(OUT_DIR, "room-geometry.json"))
BLEND = os.path.join(ROOT, "assets", "room.blend")


def argv_after_dashes() -> list[str]:
    """
    The arguments meant for this script rather than for Blender.

    `blender --background --python foo.py -- --flag` hands the whole command
    line to the script, Blender's own arguments included. Everything after a
    bare `--` is ours; run under plain `python3` there is no `--` and the whole
    tail is ours.
    """
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    # Case-insensitive: the macOS binary is `.../MacOS/Blender`, capital B,
    # and matching only the lowercase name handed Blender's own flags to
    # argparse — every no-`--` invocation died on `--background`.
    return sys.argv[1:] if not sys.argv[0].lower().endswith("blender") else []

# --------------------------------------------------------------------------
# Palette. Kept in one place so the room reads as one lit space; these are the
# same values the runtime falls back to if the model ever fails to load.
# --------------------------------------------------------------------------
PALETTE = {
    # Mid-tone, and that is a deliberate middle between two failures.
    #
    # At 9% reflectance the walls ate nine tenths of every photon, nothing
    # bounced, and the room fell to black however many lamps were pointed into
    # it. At 47% it bounced so well that the room came out flat and bright, and
    # a neon strip against a well-lit wall is a strip of tape.
    #
    # 28% is dark enough for the room to read as dark and pale enough to take a
    # colour. That is what the reference photographs actually do: their walls
    # are not black, they are ordinary walls in a dim room, and the LEDs
    # painting them is the whole effect.
    "wall": (0.285, 0.272, 0.268, 1),
    # The accent wall, a shade warmer than the other. It reads as an accent
    # because of the light thrown at it, not because it is painted a different
    # colour — which is what keeps the two walls in one room.
    "wall_accent": (0.300, 0.278, 0.268, 1),
    "floor": (0.192, 0.137, 0.094, 1),
    # Board-to-board variation. Timber is graded, not uniform: any real floor
    # mixes boards a shade lighter, darker and redder than the mean, and a
    # floor without that mix reads as sheet vinyl printed with plank lines.
    # Close to "floor" on purpose — the variation should be visible as boards,
    # not as a checkerboard.
    "floor_light": (0.224, 0.164, 0.116, 1),
    "floor_dark": (0.158, 0.110, 0.072, 1),
    "floor_warm": (0.204, 0.134, 0.082, 1),
    "rug": (0.114, 0.125, 0.176, 1),
    "desk": (0.361, 0.243, 0.157, 1),
    "desk_frame": (0.086, 0.094, 0.118, 1),
    "metal": (0.451, 0.478, 0.541, 1),
    "dark_metal": (0.129, 0.145, 0.184, 1),
    # Plank joints: near-black with warmth. Gaps between boards are shadow
    # over wood, and shadow over wood is brown, never blue.
    "seam": (0.048, 0.044, 0.040, 1),
    "plastic": (0.063, 0.071, 0.094, 1),
    "keycap": (0.129, 0.145, 0.192, 1),
    "screen": (0.020, 0.031, 0.055, 1),
    "bezel": (0.035, 0.039, 0.051, 1),
    "paper": (0.827, 0.855, 0.910, 1),
    # The cut edge of a page block: warm, and never as bright as it looks —
    # stacked paper seen edge-on is mostly shadow between the leaves.
    "pages": (0.700, 0.648, 0.560, 1),
    # Coffee, seen from above and lit from above: almost black, and warm rather
    # than neutral. Coffee painted brown reads as gravy.
    "brew": (0.055, 0.028, 0.016, 1),
    # What a tungsten bulb looks like through paper.
    "lampglow": (1.0, 0.76, 0.46, 1),
    # Ceiling white. High albedo on purpose — it is there to bounce, and every
    # point of reflectance is light the room gets back.
    "ceiling": (0.855, 0.845, 0.820, 1),
    "board": (0.882, 0.898, 0.929, 1),
    "leaf": (0.208, 0.427, 0.267, 1),
    "leaf_dark": (0.129, 0.290, 0.180, 1),
    "chair_dark": (0.106, 0.114, 0.145, 1),
    "chair_light": (0.180, 0.192, 0.235, 1),
    "sofa": (0.243, 0.255, 0.318, 1),
    "pot": (0.443, 0.286, 0.208, 1),
    "earth": (0.129, 0.094, 0.063, 1),
    "mug": (0.847, 0.353, 0.290, 1),
    "sticky": (0.988, 0.804, 0.294, 1),
    "sticky_alt": (0.541, 0.831, 0.925, 1),
    # The six pads, matching the colours `stickyTexture` draws. The runtime
    # repaints these faces with its own canvas, so strictly these only show in a
    # Cycles render — but a preview where all six are the same yellow is a
    # preview you cannot judge the arrangement from, and the arrangement is the
    # whole point of them.
    "note_yellow": (0.982, 0.792, 0.255, 1),
    "note_mint": (0.383, 0.898, 0.635, 1),
    "note_blue": (0.523, 0.714, 0.991, 1),
    "note_pink": (0.991, 0.601, 0.601, 1),
    "note_violet": (0.723, 0.673, 0.991, 1),
    "note_peach": (0.991, 0.680, 0.407, 1),
    # Eight, mostly muted, spanning a real range of *value*. A cream spine next
    # to a charcoal one is what makes a shelf read as a collection; four
    # saturated mid-tones cycled in a fixed order read as a pattern, and under
    # one coloured wash they all resolve to the same brightness anyway.
    # The reference shelf's dyes: dusty navy, worn maroon, olive drab, tan
    # leather, buff, oxblood, charcoal, slate. Old bindings are cloth and
    # leather, and neither holds a saturated colour — everything here is a
    # brown with a hue leaning out of it, which is what survives both age and
    # a coloured wash.
    "book_a": (0.100, 0.120, 0.190, 1),
    "book_b": (0.230, 0.110, 0.100, 1),
    "book_c": (0.130, 0.150, 0.100, 1),
    "book_d": (0.360, 0.270, 0.160, 1),
    "book_e": (0.470, 0.410, 0.300, 1),
    "book_f": (0.270, 0.070, 0.060, 1),
    "book_g": (0.100, 0.100, 0.110, 1),
    "book_h": (0.150, 0.180, 0.220, 1),
    # The night outside. `night_sky` is the deep blue overhead, `sky_glow` the
    # warm bloom a city throws onto the air just above its rooftops — which is
    # what a skyline's silhouette is actually read against — and `sky_haze` the
    # washed-out body of the far towers, because aerial perspective takes the
    # contrast out of a night skyline long before it takes the lights.
    # The colour of nothing. The occluder behind the room is not a surface, it
    # is the absence of one, and it has to match the background exactly.
    "void": (0.004, 0.005, 0.008, 1),
    "night_sky": (0.055, 0.085, 0.190, 1),
    "sky_glow": (0.300, 0.210, 0.185, 1),
    "sky_haze": (0.115, 0.120, 0.165, 1),
    "warm": (1.0, 0.702, 0.353, 1),
    "cyan": (0.416, 0.749, 1.0, 1),
    "violet": (0.659, 0.482, 1.0, 1),
    # Not pure magenta. An LED strip sold as pink drives its red channel hard
    # and leaves a little blue, and the green it does not emit is what makes it
    # read as a *light* rather than as paint — a fully saturated primary has no
    # highlight left in it, so it flattens to a solid shape.
    "magenta": (1.0, 0.290, 0.706, 1),
    "green": (0.353, 0.906, 0.612, 1),
    "red": (1.0, 0.372, 0.325, 1),
}

_materials: dict[str, bpy.types.Material] = {}

# Whether materials carry generated image maps. On by default — the textured
# room is the one that should reach the browser. `--flat` turns it off, which is
# useful when checking geometry: an untextured render shows a silhouette that
# grain would otherwise disguise.
TEXTURED = True

# Meshes the web app paints a canvas onto. Their UVs are the contract for where
# that image lands, so nothing here may be unwrapped or rescaled.
PAINTED = re.compile(
    r"^(ix_\w+_display|ix_whiteboard_face|ix_sticky_notes|ix_cv_face"
    r"|ix_book_spine_\d+|ix_certificates_\d+|ix_keycap_legends)$"
)

# Objects whose texture is one design covering the whole surface exactly once,
# rather than a treatment that tiles. A carpet tiled eight times across itself
# is a carpet nobody would recognise.
WHOLE_SURFACE = re.compile(r"^rug(\.\d+)?$")

# The rug's footprint in metres. Named because two places need to agree about
# it: the plane that carries the design, and the pile maps that tile across it.
RUG_SPAN = (3.88, 3.48)

# Meshes that get no share of the lightmap.
#
# The Toronto skyline is 7,541 m² of building faces — more surface than
# everything else in the scene put together — and Blender packs a bake atlas in
# proportion to area. Left in, it claimed 94% of a 4096 px atlas and the desk
# got 0.1%, about a 130 px patch stretched across the whole desktop. That, and
# not the lighting, is why the baked room looked soft.
#
# It loses nothing by being excluded. It is 26 m outside a window, its windows
# and sky are emissive already, and its towers are dark night silhouettes that
# read correctly as flat colour. Baked lighting on a distant night skyline is
# spend with no return.
BAKE_EXCLUDE = re.compile(r"^(ix_window|cn_tower|sky|lake|sky_occluder\w*)(\.\d+)?$")

# The smallest share of the atlas any object may claim, as a fraction of the
# linear size the largest object gets. Packing strictly by surface area is right
# in principle and wrong at the extremes: a pencil next to a 120 m² wall lands
# on a handful of texels, which is invisible from across the room and the first
# thing a 12 cm character stands next to.
TEXEL_FLOOR = 0.06

# The desk, which every other desk dimension is derived from. Its back edge sits
# against the wall and its front edge is where a person sits.
DESK_W, DESK_D = 2.2, 0.75
DESK_BACK = -2.50
DESK_FRONT = DESK_BACK + DESK_D
DESK_Y = (DESK_BACK + DESK_FRONT) / 2
DESK_TOP = 0.79

# The working position: where the keyboard sits, and therefore where a person
# sits. The chair is placed from this rather than from a number of its own, so
# the two cannot drift apart.
KEY_X = -0.16

# Where the chair stands: on the laptop's centreline, not the keyboard's.
#
# Measured rather than composed. The establishing camera looks in from high on
# the right, so its sightlines to the three screens cross the chair's depth at
# x = -0.25 (laptop), 0.40 (left monitor) and 0.98 (right monitor). The chair is
# 77 cm wide and the gaps between those lines are 65 and 58 cm, so there is no
# position between them it fits in — every "natural" spot blocks something. On
# the keyboard centreline it hid 100% of the laptop screen; 34 cm to the right
# of that, 47% of the left monitor.
#
# Left of all three lines it is clear, and it lands in front of the laptop —
# which is a place a chair genuinely lives, not a compromise dressed up as one.
# Ten centimetres off the working position, not fifty-five.
#
# The comment on the chair said "on the keyboard's centreline" while this put it
# more than half a metre to the left of it — far enough that nobody sitting in
# it could reach the keys, and far enough that the chair read as abandoned in
# open floor rather than pushed back from the desk. The plan asks for a chair
# that is never square to the desk and never centred; it does not ask for one in
# a different postcode.
# On the keyboard's centreline, and it has to be exactly that. This carried a
# -0.10 offset with a comment above it claiming the centreline, which put the
# chair 10 cm to the left of the working position — far enough to read as
# slightly wrong from across the room and never far enough to look deliberate.
CHAIR_X = KEY_X

# How high the walls run.
#
# Far higher than a room, and deliberately so: they are also what stops the
# camera seeing the Toronto skyline standing in the void beside the room. Cut
# to a realistic 2.7 m, the establishing shot showed the sky plane's edge as a
# hard diagonal across the top-left corner. The height is doing two jobs and
# only one of them is obvious, which is exactly the sort of thing that gets
# broken by a change that looks safe.
WALL_TOP = 5.4

# Where the ceiling sits. The walls run to 5.4 m so the room reads as an open
# box from outside, but a room a person lives in is 2.7 m — and the difference
# matters enormously to the light, because everything above the ceiling is
# hidden anyway and everything below it gets a huge soft reflector.
CEILING_HEIGHT = 2.72

# How thick the carpet is. A hand-knotted wool Isfahan runs 10-14 mm including
# the pile, and having it as a real dimension rather than a fudge factor is what
# lets anything else in the room sit *on* the rug rather than through it — the
# sofa feet and the coffee table both stand on the floor, and the difference is
# only visible because the rug has a height to be above.
RUG_THICKNESS = 0.012

# Geometry built for the bake and kept out of the GLB.
EXPORT_EXCLUDE = re.compile(r"^ceiling(\.\d+)?$")


def drop_export_only() -> int:
    """Remove the bake-only geometry. Call immediately before an export."""
    doomed = [o for o in bpy.context.scene.objects if EXPORT_EXCLUDE.match(o.name)]
    for obj in doomed:
        bpy.data.objects.remove(obj, do_unlink=True)
    return len(doomed)


def reset_scene() -> None:
    global _plants
    _plants = 0
    _materials.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


# Materials that are allowed to be perfectly uniform, and why.
#
# Backdrop: the skyline, the lake and the occluder are painted scenery seen
# through a window at fifteen metres. They have no surface to describe.
# Panels: a screen's appearance is its emission and the canvas the runtime
# paints onto it, not the finish of the glass in front.
FLAT_BY_DESIGN = frozenset(
    {
        "occluder",
        "sky_lit",
        "sky_lit_cool",
        "sky_tower",
        "sky_tower_far",
        "lake",
        "screen",
        "laptop_screen",
        "board_face_mat",
        "cv_board",
        "screen_mask",
        "beacon",
        "bulb",
        "led_red",
        "led_strip",
        "kb_led",
        "monitor_led",
    }
)


# A note on `metallic`, because the room used to get this wrong in thirteen
# places and it is the sort of wrong that looks like a style choice.
#
# Metalness is not a slider. In the metal/rough workflow it selects between two
# different physical models: a conductor, which has no diffuse colour and tints
# its own reflection, and a dielectric, which has diffuse colour and reflects
# white at about 4%. There is no substance that is 30% of the way between them.
# An intermediate value is only meaningful inside a *texture*, where it marks
# the boundary between bare metal and the paint on top of it.
#
# A plastic bin at 0.3 gets 30% of its diffuse colour deleted and 30% of a
# metallic reflection it should not have, which reads as dingy grey — and the
# instinct is then to brighten its colour, which makes it worse. Anything that
# is metal is 1.0 and carries its look in roughness; anything else is 0.0.


def default_grain(roughness: float, metallic: float) -> str:
    """
    The finish a material gets when it does not ask for one.

    Nothing in a real room has a constant roughness. A uniform value returns a
    highlight of identical size and sharpness across a whole surface, and that
    single property is the most reliable giveaway that an image was rendered —
    it is why untextured 3D reads as plastic even when the colours are right.

    Rather than tag a hundred and sixteen materials by hand and rely on whoever
    adds the hundred and seventeenth remembering to, the fallback is derived
    from what the material already says about itself. Metal is metal, anything
    polished has been lacquered or moulded glossy, and everything else is some
    kind of moulded plastic — which, for a desk, a bin, a keyboard and a
    monitor shell, is simply true.
    """
    if metallic > 0.3:
        return "metal"
    if roughness < 0.32:
        return "lacquer"
    return "plastic"


def material(
    name: str,
    colour_key: str,
    *,
    roughness: float = 0.75,
    metallic: float = 0.0,
    emission: float = 0.0,
    emission_key: str | None = None,
    grain: str | None = None,
) -> bpy.types.Material:
    """
    A Principled BSDF material, cached by name so the GLB ships one copy.

    `grain` names a procedural surface break-up. It is recorded as a custom
    property on the material rather than wired in here — see `apply_grain`,
    which the bake calls and the plain export does not.

    Omitting it does not mean "no surface detail"; it means "choose one" — see
    `default_grain`. Genuine exceptions go in `FLAT_BY_DESIGN`, which is a short
    and deliberately awkward list to be added to.
    """
    if name in _materials:
        return _materials[name]

    if grain is None and name not in FLAT_BY_DESIGN and emission <= 0:
        grain = default_grain(roughness, metallic)

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    colour = PALETTE[colour_key]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0:
        # Emission colour defaults to the base colour, which is right for a
        # screen or an LED — the thing glowing *is* the thing you see. It is
        # wrong for anything lit from inside by something else: a paper lamp
        # shade is near-white, and the light coming through it is the colour of
        # the bulb behind it, not the colour of the paper.
        bsdf.inputs["Emission Color"].default_value = PALETTE[emission_key] if emission_key else colour
        bsdf.inputs["Emission Strength"].default_value = emission
    if grain:
        # Recorded either way, so the bake still knows what a surface is even
        # when the maps below are switched off.
        mat["grain"] = grain
        if TEXTURED:
            _add_maps(mat, grain, colour, roughness)
    _materials[name] = mat
    return mat


_grain_images: dict[str, bpy.types.Image] = {}


def _image(name: str, pixels, *, data: bool, lossy: bool = False) -> bpy.types.Image:
    """
    A packed image datablock from a numpy array, greyscale or RGB.

    Packed rather than written next to the .blend: the GLB has to carry the
    bytes, and an image with no file on disk is one that cannot go stale or go
    missing when the repository is cloned somewhere else.
    """
    import numpy as np

    if name in _grain_images:
        return _grain_images[name]

    height, width = pixels.shape[0], pixels.shape[1]
    image = bpy.data.images.new(name, width, height, alpha=False, is_data=data)

    # Colorspace before pixels, not after. Assigning it resets the datablock to
    # a freshly generated buffer, so doing it in the obvious order — fill, then
    # label — silently threw the fill away and packed Blender's default colour
    # grid instead. Every map in the GLB came out a flat 1 KB PNG, and nothing
    # anywhere reported a problem.
    image.colorspace_settings.name = "Non-Color" if data else "sRGB"

    rgba = np.ones((height, width, 4), dtype=np.float32)
    if pixels.ndim == 2:
        rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = pixels
    else:
        rgba[..., :3] = pixels
    # Blender's buffer runs bottom-up; the arrays are built top-down.
    image.pixels.foreach_set(np.ascontiguousarray(np.flipud(rgba)).reshape(-1))
    # `pixels` writes into a buffer the image does not consider dirty until it
    # is told. Without this the pack — and the export after it — takes the
    # blank buffer the datablock was created with, and every map in the GLB
    # comes out a flat 1 KB PNG of nothing. It looks exactly like a texture
    # pipeline that works, right up to the point where you look at the room.
    image.update()

    # PNG for anything a shader reads as data — a lossy normal map is visible
    # banding on every curved surface. JPEG for large pictorial maps, where the
    # difference is invisible and the difference in bytes is not: the carpet
    # weighed 5.8 MB as a PNG and doubled the size of the entire model.
    #
    # It has to go through a real file to come out the other side as a JPEG.
    # Setting `file_format` on a generated image and packing it is not enough —
    # the glTF exporter re-encodes anything without a recognisable filepath, and
    # silently hands back a PNG of exactly the same pixels.
    if lossy:
        scratch = os.path.join(tempfile.gettempdir(), f"{name}.jpg")
        bpy.context.scene.render.image_settings.file_format = "JPEG"
        bpy.context.scene.render.image_settings.quality = 88
        image.file_format = "JPEG"
        image.filepath_raw = scratch
        image.save()
        image.pack()
    else:
        image.file_format = "PNG"
        image.pack()
    _grain_images[name] = image
    return image


def _texture_node(tree, image, location):
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Smart"
    node.location = location
    return node


def _add_maps(mat: bpy.types.Material, kind: str, colour, base_rough: float) -> None:
    """
    Wire generated image maps into a material's colour, roughness and normal.

    The colour map is greyscale and multiplied by the material's own colour,
    because that is the one arrangement the glTF exporter recognises and folds
    into `baseColorTexture` plus `baseColorFactor`. Wiring anything cleverer —
    a noise node, a colour ramp, a mix of two tints — makes the exporter give up
    and write flat white, which is exactly how every wooden surface in this room
    spent a while looking like bare plastic.
    """
    import grain_maps

    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]

    # The carpet is a design, not a surface treatment: one full-colour image
    # spanning the object exactly once, wired straight to Base Colour with no
    # tint multiplied over it. Everything else here is a greyscale multiplier
    # that repeats every half metre, which is the opposite arrangement.
    if kind == "persian":
        weave = _texture_node(
            tree,
            _image("rug_persian", grain_maps.persian_rug(), data=False, lossy=True),
            (-520, 300),
        )
        tree.links.new(weave.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.96
        # The design is one image spanning the rug once; the *pile* is a
        # separate thing that repeats every half metre, and it is what stops a
        # carpet reading as a printed sheet of paper lying on the floor. Wool
        # catches light along the lie of the tuft, so this is the one surface in
        # the room where the normal map matters more than the colour.
        #
        # The rug is the one object that keeps the 0..1 UVs it was born with, so
        # that the design lands on it exactly once (`WHOLE_SURFACE`). That is
        # right for the pattern and wrong for the pile: sharing those UVs would
        # stretch a half-metre tile of wool across all 3.9 m of it, which is not
        # pile but a smear. So the pile gets its own mapping, tiled at the same
        # physical scale `texture_uvs` gives every other surface in the room.
        tiles = tree.nodes.new("ShaderNodeMapping")
        tiles.location = (-1080, -120)
        tiles.inputs["Scale"].default_value = (
            RUG_SPAN[0] / grain_maps.TILE_METRES,
            RUG_SPAN[1] / grain_maps.TILE_METRES,
            1.0,
        )
        uv = tree.nodes.new("ShaderNodeUVMap")
        uv.location = (-1280, -120)
        tree.links.new(uv.outputs["UV"], tiles.inputs["Vector"])

        rough = _texture_node(
            tree,
            _image("grain_pile_rough_10", grain_maps.roughness("pile", 0.96), data=True),
            (-520, 20),
        )
        tree.links.new(tiles.outputs["Vector"], rough.inputs["Vector"])
        tree.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

        pile = _texture_node(tree, _image("grain_pile_normal", grain_maps.normal("pile"), data=True), (-520, -260))
        tree.links.new(tiles.outputs["Vector"], pile.inputs["Vector"])
        pile_normal = tree.nodes.new("ShaderNodeNormalMap")
        pile_normal.location = (-240, -260)
        tree.links.new(pile.outputs["Color"], pile_normal.inputs["Color"])
        tree.links.new(pile_normal.outputs["Normal"], bsdf.inputs["Normal"])
        return

    # A micro-finish describes how a surface reflects, not what colour it is, so
    # it leaves base colour alone and contributes roughness and normal only.
    if kind not in grain_maps.MICRO:
        albedo = _texture_node(tree, _image(f"grain_{kind}_albedo", grain_maps.albedo(kind), data=False), (-820, 300))
        tint = tree.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs["Factor"].default_value = 1.0
        tint.inputs[7].default_value = tuple(colour[:3]) + (1.0,)
        tint.location = (-520, 300)
        tree.links.new(albedo.outputs["Color"], tint.inputs[6])
        tree.links.new(tint.outputs[2], bsdf.inputs["Base Color"])

    # Roughness is baked per material rather than shared, because it is keyed to
    # the material's own base roughness — a rough fabric and a polished lacquer
    # can share a weave and cannot share a roughness map.
    # Bucketed to a tenth, and named without a dot. Two materials a hundredth
    # of a roughness apart are indistinguishable and were shipping two copies of
    # the same 25 KB noise; and the glTF exporter treats everything after a dot
    # in an image name as a file extension, so `rough_0.45` and `rough_0.85`
    # both arrived called `rough_0`.
    bucket = round(min(1.0, max(0.0, base_rough)) * 10)
    rough = _texture_node(
        tree,
        _image(f"grain_{kind}_rough_{bucket:02d}", grain_maps.roughness(kind, bucket / 10), data=True),
        (-520, 20),
    )
    tree.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    normal_map = _texture_node(tree, _image(f"grain_{kind}_normal", grain_maps.normal(kind), data=True), (-520, -260))
    normal_node = tree.nodes.new("ShaderNodeNormalMap")
    normal_node.location = (-240, -260)
    tree.links.new(normal_map.outputs["Color"], normal_node.inputs["Color"])
    tree.links.new(normal_node.outputs["Normal"], bsdf.inputs["Normal"])


def apply_grain() -> int:
    """
    Wire procedural grain into every material tagged with a `grain` property.

    This is deliberately not part of building the room. The glTF exporter can
    only carry a *flat* base colour or an image texture; hand it a procedural
    node graph and it gives up and writes white, which turned every wooden and
    upholstered surface in the room into bare plastic. So the unbaked export
    keeps its flat colours, and the bake — which resolves the whole node tree
    down into one atlas anyway — calls this first and gets the texture.

    The tag is a custom property on the material rather than a list built while
    the room is constructed, so it survives into the .blend. The room is
    hand-modelled now: a bake that only knew about grain requested by
    `build_room` would texture nothing a modeller had touched. Setting
    `grain` to one of the keys in `_GRAIN` on any material is enough.
    """
    applied = 0
    for mat in bpy.data.materials:
        kind = mat.get("grain")
        if not kind or not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        # Already wired, or hand-authored into something this would trample.
        #
        # Roughness is checked as well as base colour. A micro-finish never
        # links base colour, so testing that alone declared the image-mapped
        # micro materials untouched and wired the procedural version straight
        # over their roughness and normal — quietly discarding the maps the GLB
        # had just been given.
        if bsdf is None:
            continue
        if bsdf.inputs["Base Color"].is_linked or bsdf.inputs["Roughness"].is_linked:
            continue
        _add_grain(mat, tuple(bsdf.inputs["Base Color"].default_value), str(kind))
        applied += 1
    return applied


# How each grain type is shaped: its mapping scale (which is the frequency, in
# cycles per metre of object space), the noise distortion, how far the colour
# swings either side of the base, and how much the roughness varies with it. A
# single flat albedo is the thing that most reliably makes a rendered room look
# rendered — real surfaces vary across a few centimetres, and the eye reads the
# absence of that as plastic.
#
# Frequencies are held under ~110 cycles/m. The bake writes into a 4096 px atlas
# shared by every object in the room, which works out around 200 texels/m on the
# larger surfaces; anything finer than half of that aliases into a shimmer
# instead of resolving as texture.
_GRAIN = {
    # Long stretched noise along one axis, which is what wood grain is.
    "wood": ((0.6, 34.0, 34.0), 3.0, 0.055, 0.12),
    # Fine isotropic weave.
    "fabric": ((90.0, 90.0, 90.0), 0.0, 0.035, 0.06),
    # Broad soft mottling, for painted plaster.
    "plaster": ((5.5, 5.5, 5.5), 0.4, 0.022, 0.05),
    # Tight pile with a visible direction.
    "pile": ((70.0, 18.0, 70.0), 1.4, 0.05, 0.09),
    # Brushed metal: fine scratches running one way.
    "brushed": ((150.0, 5.0, 150.0), 0.0, 0.03, 0.14),
    # Paper tooth, barely there.
    "paper": ((110.0, 110.0, 110.0), 0.0, 0.018, 0.04),
    # The micro-finishes. Colour spread is 0.0 for all four: they vary how a
    # surface reflects, never what colour it is. See `grain_maps.MICRO`.
    "plastic": ((95.0, 95.0, 95.0), 0.2, 0.0, 0.06),
    "metal": ((100.0, 26.0, 100.0), 0.0, 0.0, 0.13),
    "lacquer": ((14.0, 14.0, 14.0), 0.3, 0.0, 0.04),
    "rubber": ((80.0, 80.0, 80.0), 0.0, 0.0, 0.10),
}


def _add_grain(mat: bpy.types.Material, colour: tuple[float, ...], kind: str) -> None:
    """Wire a noise texture into base colour and roughness."""
    spec = _GRAIN.get(kind)
    if spec is None:
        return
    scale, distortion, spread, rough_spread = spec

    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]

    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = scale

    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.0
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.55
    noise.inputs["Distortion"].default_value = distortion

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.65

    rough = tree.nodes.new("ShaderNodeMapRange")
    base_rough = bsdf.inputs["Roughness"].default_value
    rough.inputs["To Min"].default_value = max(0.0, base_rough - rough_spread)
    rough.inputs["To Max"].default_value = min(1.0, base_rough + rough_spread)

    # Bump, so the grain catches light rather than only tinting. A micro-finish
    # is a hundredth of a millimetre of orange peel or tooling, not a wood
    # grain you could feel, so it gets a tenth of the relief.
    micro = spread == 0.0
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06 if micro else 0.12
    bump.inputs["Distance"].default_value = 0.0004 if micro else 0.004

    links = tree.links
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    # A micro-finish never touches base colour — it says how the surface
    # reflects, not what colour it is.
    if not micro:
        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = tuple(max(0.0, c - spread) for c in colour[:3]) + (1.0,)
        mix.inputs[7].default_value = tuple(min(1.0, c + spread) for c in colour[:3]) + (1.0,)
        links.new(ramp.outputs["Color"], mix.inputs["Factor"])
        links.new(mix.outputs[2], bsdf.inputs["Base Color"])

    links.new(ramp.outputs["Color"], rough.inputs["Value"])
    links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


def shade(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def cube(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    rotation_z: float = 0.0,
    bevel: float = 0.006,
) -> bpy.types.Object:
    """
    A bevelled box. The chamfer is the whole reason a procedural room reads as
    designed rather than as primitives: without it every edge is a perfectly
    sharp line that catches no highlight and no ambient occlusion.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.scale = (size[0], size[1], size[2])
    obj.rotation_euler = (0, 0, rotation_z)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    smallest = min(size)
    if bevel > 0 and smallest > 0.02:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = min(bevel, smallest * 0.2)
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(50)

    return shade(obj, mat)


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    vertices: int = 24,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=vertices, location=location
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.rotation_euler = rotation
    # `use_auto_smooth` was removed in Blender 4.1; smooth-by-angle is now a
    # modifier, and for parts this small flat shading reads the same anyway.
    bpy.ops.object.shade_smooth()
    return shade(obj, mat)


def cone(
    name: str,
    radius_bottom: float,
    radius_top: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    vertices: int = 12,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    """A tapered tube. `cylinder` with two radii, for things that are not tubes."""
    bpy.ops.mesh.primitive_cone_add(
        radius1=radius_bottom, radius2=radius_top, depth=depth,
        vertices=vertices, location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.rotation_euler = rotation
    bpy.ops.object.shade_smooth()
    return shade(obj, mat)


def plane(
    name: str,
    size: tuple[float, float],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    rotation: tuple[float, float, float] = (0, 0, 0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    obj.scale = (size[0], size[1], 1)
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return shade(obj, mat)


def aim(direction: tuple[float, float, float]) -> tuple[float, float, float]:
    """
    The euler rotation that points a cylinder's +Z axis along `direction`.

    Worth being a function rather than three hand-derived approximations,
    because it has now been got wrong three times in three places and each
    failure looked like something else entirely. The plant's stems leaned the
    opposite way to the leaves they carried and read as foliage floating in
    mid-air; the guitar's neck hung on the wrong side of the corner from its
    body; the lamp's arm missed its own post.

    Blender composes euler XYZ as Rz·Ry·Rx, which sends +Z to
    `(sin b·cos a, −sin a, cos b·cos a)`. Solving that for a unit direction
    gives the two angles below exactly. There is no small-angle approximation
    here to drift, and no sign to get backwards by inspection.
    """
    x, y, z = direction
    length = math.sqrt(x * x + y * y + z * z)
    if length == 0:
        return (0.0, 0.0, 0.0)
    x, y, z = x / length, y / length, z / length

    rot_x = -math.asin(max(-1.0, min(1.0, y)))
    rot_y = math.atan2(x, z)
    return (rot_x, rot_y, 0.0)


def strut(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 12,
) -> bpy.types.Object:
    """
    A cylinder that spans two points.

    Placing a strut by its centre and a guessed angle is how the lamp ended up
    with an arm that met neither the post it grew from nor the shade it
    carried. Given both ends there is nothing left to get wrong.
    """
    delta = tuple(e - s for s, e in zip(start, end))
    middle = tuple((s + e) / 2 for s, e in zip(start, end))
    length = math.sqrt(sum(d * d for d in delta))
    return cylinder(name, radius, length, middle, mat, vertices=vertices, rotation=aim(delta))


def smooth(
    obj: bpy.types.Object,
    levels: int = 2,
    *,
    crease: float = 0.0,
    boundary: bool = False,
) -> bpy.types.Object:
    """
    Round an object off with a subdivision surface.

    This is the difference between a room made of boxes and a room made of
    things. A bevel softens an edge; subdivision changes the shape — it is what
    turns a box into a cushion and a stack of slabs into a moulded chair shell,
    and it is the single technique this room was missing.

    `crease` between 0 and 1 holds the original edges: 0 lets the cage relax
    into something pillowy, 1 pins it back to the box it started as. Cushions
    want a low crease, panels want a high one.
    """
    if crease > 0:
        # Blender 4.x moved edge crease out of `MeshEdge.crease` and into a
        # generic attribute layer. Try the layer first and fall back, so this
        # runs on both the 4.2 `bpy` module and whatever the machine doing the
        # bake happens to have.
        mesh = obj.data
        try:
            layer = mesh.attributes.get("crease_edge") or mesh.attributes.new(
                "crease_edge", "FLOAT", "EDGE"
            )
            for item in layer.data:
                item.value = crease
        except (AttributeError, RuntimeError):
            for edge in mesh.edges:
                edge.crease = crease

    modifier = obj.modifiers.new("Subsurf", "SUBSURF")
    modifier.levels = levels
    modifier.render_levels = levels
    modifier.use_limit_surface = False
    if boundary:
        modifier.boundary_smooth = "PRESERVE_CORNERS"

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def poly(
    name: str,
    verts: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
) -> bpy.types.Object:
    """
    A mesh built from explicit vertices and faces.

    The primitive helpers above can only make what a box or a cylinder can be
    stretched into. Anything with a real silhouette — a seat that curves in two
    directions, a guitar's waist — needs its control points placed, and this is
    how they get placed from code.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(list(verts), [], list(faces))
    mesh.validate()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    return shade(obj, mat)


def lathe(
    name: str,
    profile: list[tuple[float, float]],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    segments: int = 24,
) -> bpy.types.Object:
    """
    Spin a 2D profile of (radius, height) pairs around the Z axis.

    Everything turned on a wheel — a mug, a pot, a lampshade, a plant pot with
    a rolled rim — is one profile and a spin. Approximating those with stacked
    cylinders is what made the room's round objects read as tin cans.
    """
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    rings = len(profile)

    for step in range(segments):
        angle = step / segments * math.tau
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        for radius, height in profile:
            verts.append((radius * cos_a, radius * sin_a, height))

    for step in range(segments):
        nxt = (step + 1) % segments
        for ring in range(rings - 1):
            a = step * rings + ring
            b = step * rings + ring + 1
            c = nxt * rings + ring + 1
            d = nxt * rings + ring
            faces.append((a, b, c, d))

    obj = poly(name, verts, faces, location, mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def cable(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    mat: bpy.types.Material,
) -> bpy.types.Object:
    """
    A cable, as a bevelled bezier through the given points.

    Cables are worth the curve rather than a chain of cylinders. A cable is
    read almost entirely by its sag — the shape a hanging cable takes is
    something everyone has seen ten thousand times, and a straight segment
    between two points reads as a rod instantly. Auto handles give a smooth
    catenary-ish curve through the control points for free.
    """
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 1
    curve.resolution_u = 5

    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, location in zip(spline.bezier_points, points):
        point.co = location
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"

    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")

    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    return shade(obj, mat)


def join(name: str, objects: list[bpy.types.Object]) -> bpy.types.Object:
    """
    Merges parts into one object.

    Draw calls, not triangles, are what a scene like this runs out of first — a
    bookshelf modelled as forty separate objects is forty draw calls for
    something the visitor reads as one thing.
    """
    objects = [o for o in objects if o is not None]

    # Flush pending transforms before joining.
    #
    # Assigning `obj.location` from Python does not update `matrix_world` — the
    # depsgraph does that, lazily. `object.join()` reads `matrix_world`, so any
    # part positioned by assignment rather than by the operator that created it
    # gets merged as though it were still at the origin. That is what threw the
    # plant's leaves across the floor: the leaves were the only parts placed by
    # assignment, and they were the only parts that ended up in the wrong place.
    bpy.context.view_layer.update()

    # Bake every part's own modifiers into it before merging.
    #
    # A join keeps the *active* object's modifier stack and throws away
    # everyone else's. Both halves of that are wrong here. The chair's seat
    # carries a Solidify and a Subsurf, so joining the chair into it applied
    # both to the gas lift, the castors and the five-star base — 303 vertices
    # became 7716 and the hardware turned to blobs. The sofa went the other
    # way: its cushions were joined into a base with no modifiers, so they lost
    # their subdivision and went back to being the boxes they started as.
    #
    # Applying first means each part keeps the shape it was given.
    for obj in objects:
        if not obj.modifiers:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = name
    # glTF splits a multi-material mesh into one node per material and names the
    # results after the *mesh data*, not the object. Without this the runtime
    # would be looking up `ix_keyboard` and finding `Cube037`.
    merged.data.name = name
    return merged


def set_origin(obj: bpy.types.Object, location: tuple[float, float, float]) -> bpy.types.Object:
    """
    Move an object's origin without moving the object.

    A join leaves the origin wherever the first part happened to sit, which is
    fine until something rotates: the runtime spins a chair about its own Y
    axis, and an origin half a metre off the gas lift turns that into the chair
    sliding across the floor.
    """
    previous = tuple(bpy.context.scene.cursor.location)
    bpy.context.scene.cursor.location = location
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = previous
    return obj


# --------------------------------------------------------------------------
# The room
# --------------------------------------------------------------------------


def _wall_with_opening(wall_mat: bpy.types.Material) -> bpy.types.Object:
    """
    The back wall, with the window aperture cut out by a boolean rather than
    faked with a lit panel. A painted-on view cannot be looked *through*: the
    parallax between the frame and the skyline as the camera moves is the whole
    reason the window reads as an opening and not as a poster.
    """
    # Wider and taller than the room needs, because it is also the occluder that
    # keeps the night sky where it belongs.
    #
    # The skyline has to be big enough to fill the window from the window's own
    # camera stop — about 24 m across at 34 m out — but the establishing camera
    # sits high on the +X side and can see past this wall's edge, so anything
    # that wide shows up floating in the void beside the room. It went unnoticed
    # for as long as the sky was near-black: an unlit slab against an unlit
    # background is not visible. The moment the sky had a gradient worth looking
    # at, it was.
    #
    # Everything added here is outside the room and lit by nothing, so it reads
    # as the same black the background already is.
    wall = cube("wall_back", (11.0, 0.12, WALL_TOP), (0, -2.6, WALL_TOP / 2), wall_mat, bevel=0)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(2.05, -2.6, 1.7))
    cutter = bpy.context.object
    cutter.name = "window_cutter"
    cutter.scale = (1.42, 0.4, 1.24)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    mod = wall.modifiers.new("Opening", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier="Opening")
    bpy.data.objects.remove(cutter, do_unlink=True)

    bpy.context.view_layer.objects.active = wall
    return wall


def build_toronto() -> list[bpy.types.Object]:
    """
    The view through the window: Toronto at night, from high up.

    Built at real distance rather than as a backdrop card, so it parallaxes as
    the camera moves. The whole thing sits inside the window's view cone, which
    is the only reason a few dozen boxes can stand in for a skyline.

    **The geometry has to be laid out against that cone**, and getting it wrong
    is what made the first version read as an upside-down skyline. The window
    aperture spans z 1.08 to 2.32, so a viewer inside the room sees, at depth
    `d` behind it, a vertical band roughly `1.7 ± 0.62 · (d + 0.5) / 2.1` —
    about 17 m tall at 30 m out. The towers used to stand on bases at z = -1.2
    with tops as high as 14.8, which put their *bases* inside that band and
    their tops far above it. You saw the bottom of the city, the tops were cut
    off by the frame, and the stepped edge along the bottom was bases at
    different distances. Every cue was inverted.

    So the bases go well below the band and the tops land inside it. You see
    what a skyline is actually recognised by: a varied silhouette against sky.
    """
    random_state = [20240726]

    def rand() -> float:
        random_state[0] = (random_state[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return random_state[0] / 0x7FFFFFFF

    # Everything stands on this, far below the window's view cone, so no ground
    # line ever crosses the frame.
    GROUND = -16.0

    tower_mat = material("sky_tower", "plastic", roughness=0.8)
    # A second, paler body for the far layer. Distance washes contrast out of a
    # night skyline long before it washes out the lights, and that difference is
    # most of what makes a city read as deep rather than as one flat cut-out.
    far_mat = material("sky_tower_far", "sky_haze", roughness=0.85, metallic=0.0)
    # The city has to compete with a lit room now. Seen from inside a bright
    # interior a night skyline is mostly a black rectangle — which is true, and
    # useless, since the view is one of the things the room is for. Raised until
    # the windows still read against the new interior level.
    lit_mat = material("sky_lit", "warm", roughness=0.4, emission=6.5)
    cool_lit = material("sky_lit_cool", "cyan", roughness=0.4, emission=5.5)

    parts: list[bpy.types.Object] = []

    # The sky, as a stack of bands rather than one flat plane.
    #
    # It was a single emissive slab at 0.35 on a near-black colour, which is
    # indistinguishable from no sky at all — and with nothing behind the towers,
    # a skyline has no silhouette to be read against. A night sky over a city is
    # not uniform: it is bright and warm just above the rooftops, where the
    # city's own light bounces off the air, and falls to deep blue overhead.
    # Seven bands is enough to read as a gradient at this distance.
    sky_bands = []
    for i in range(7):
        t = i / 6.0
        z0 = GROUND + t * 46.0
        glow = (1.0 - t) ** 2.2
        sky_bands.append(
            cube(
                f"sky_band_{i}",
                (110, 0.2, 46.0 / 6.0 + 0.4),
                (2.05, -70, z0),
                material(
                    f"sky_{i}",
                    "sky_glow" if glow > 0.5 else "night_sky",
                    roughness=1.0,
                    emission=0.22 + glow * 1.5,
                ),
                bevel=0,
            )
        )

    # Lake Ontario, well below the skyline and almost black — it carries the
    # city's light rather than making its own.
    lake = cube(
        "lake",
        (90, 60, 0.3),
        (2.05, -46, GROUND - 0.4),
        material("lake", "night_sky", roughness=0.9, metallic=0.0, emission=0.30),
        bevel=0,
    )

    # The CN Tower. Unmistakable, and the one object that fixes the city.
    # Scaled and placed so the pod lands inside the visible band rather than
    # above it — a landmark whose recognisable part is cropped out is not a
    # landmark.
    tx, ty = 3.4, -30.0
    cn: list[bpy.types.Object] = [
        cylinder("cn_shaft", 0.62, 22.0, (tx, ty, GROUND + 11.0), tower_mat, vertices=12),
        cylinder("cn_pod", 1.9, 1.7, (tx, ty, GROUND + 21.4), tower_mat, vertices=16),
        cylinder("cn_pod_lit", 1.96, 0.5, (tx, ty, GROUND + 21.7), lit_mat, vertices=16),
        cylinder("cn_upper", 1.05, 1.9, (tx, ty, GROUND + 23.6), tower_mat, vertices=14),
        cylinder("cn_mast", 0.2, 9.0, (tx, ty, GROUND + 29.0), tower_mat, vertices=8),
    ]
    beacon = cylinder(
        "cn_beacon", 0.24, 0.24, (tx, ty, GROUND + 33.7),
        material("beacon", "red", roughness=0.3, emission=18.0), vertices=8,
    )
    parts.append(join("cn_tower", cn + [beacon]))

    # The towers, in three depth layers. Layering is what the plan asks for and
    # what stops a backdrop giving itself away the moment the camera moves.
    blocks: list[bpy.types.Object] = []
    lights: list[bpy.types.Object] = []
    layers = (
        # (count, near y, far y, min height, max height, material, window odds)
        (16, -25.0, -33.0, 15.0, 25.0, tower_mat, 0.30),
        (18, -34.0, -44.0, 13.0, 22.0, tower_mat, 0.24),
        (16, -45.0, -58.0, 11.0, 18.0, far_mat, 0.16),
    )
    index = 0
    for count, near, far, low, high, body, odds in layers:
        for _ in range(count):
            x = -14 + rand() * 34
            y = near + rand() * (far - near)
            w = 2.0 + rand() * 4.5
            d = 2.0 + rand() * 4.5
            # Squared, so most towers are middling and a few are tall — which is
            # the shape of a real skyline's height distribution.
            h = low + (high - low) * (rand() * rand())
            blocks.append(
                cube(f"sky_block_{index}", (w, d, h), (x, y, GROUND + h / 2), body, bevel=0)
            )

            columns = max(2, int(w / 0.62))
            rows = max(3, int(h / 1.05))
            for col in range(columns):
                for row in range(rows):
                    # Most windows are dark. Lighting them all turns a tower
                    # back into a glowing slab.
                    if rand() > odds:
                        continue
                    lights.append(
                        cube(
                            f"sky_window_{index}_{col}_{row}",
                            (w / columns * 0.46, 0.06, h / rows * 0.34),
                            (
                                x - w / 2 + (col + 0.5) * (w / columns),
                                y + d / 2 + 0.03,
                                GROUND + (row + 0.5) * (h / rows),
                            ),
                            lit_mat if rand() > 0.38 else cool_lit,
                            bevel=0,
                        )
                    )
            index += 1

    parts.append(join("ix_window", sky_bands + [lake] + blocks + lights))
    return parts


def _sky_occluder() -> list[bpy.types.Object]:
    """
    The black card that keeps the night sky inside the window — with a hole for
    the window.

    The skyline has to be wide enough to fill the window from the window's own
    camera stop, but the establishing camera sits high on the +X side and sees
    straight past the back wall's edge, so a city that wide appears floating in
    the void beside the room. It also stands on ground at z = -16, so its tower
    bases show under the wall's bottom edge.

    The first version was a single slab at y = -2.75. That is behind the wall
    and *in front of the city*, so it did stop the leak and it also blocked the
    view — the window went black, which is precisely the thing the occluder
    exists to protect. Solving an occlusion problem with an occluder that
    occludes the subject is the kind of mistake that looks obviously right in
    the source and obviously wrong on screen.

    Four panels instead, leaving the window's cone open. The gap is generous:
    the card sits 15 cm behind the wall, so the cone has barely widened, and a
    few centimetres of slack costs nothing while a few too few would clip the
    view.
    """
    mat = material("occluder", "void", roughness=1.0)
    y = -2.75
    # The aperture, with slack.
    left, right = 1.10, 3.00
    low, high = 0.80, 2.60
    far = 30.0

    panels = [
        # (name, x centre, z centre, width, height)
        ("sky_occluder", (left - far) / 2, 0.0, far + left, far * 2),
        ("sky_occluder_r", (right + far) / 2, 0.0, far - right, far * 2),
        ("sky_occluder_b", (left + right) / 2, (low - far) / 2, right - left, far + low),
        ("sky_occluder_t", (left + right) / 2, (high + far) / 2, right - left, far - high),
    ]
    return [
        cube(name, (w, 0.1, h), (cx, y, cz), mat, bevel=0)
        for name, cx, cz, w, h in panels
    ]


def _ceiling() -> bpy.types.Object:
    """
    The ceiling: a light source in everything but name.

    Bake-only — `EXPORT_EXCLUDE` drops it before the GLB is written, so the
    browser still gets an open box it can look down into. It exists entirely
    for the light. Without one, everything a lamp throws upward leaves the room
    and never comes back, so nothing gets a second bounce and the room reads as
    evenly lit in some places and abruptly black in others.

    Hidden from camera rays but not from everything else. That distinction is
    the whole trick: `visible_camera = False` means Cycles will not draw it when
    something looks at it, while diffuse and glossy rays still hit it and still
    carry its bounce. Without it the ceiling sits between the establishing
    camera and the room, and both the preview render and any bake done from a
    camera angle show a black band across the top of the frame instead of a
    room.

    White, and slightly warm — ceilings are painted white precisely because of
    this, and the warmth keeps the bounce from reading as moonlight.
    """
    obj = plane(
        "ceiling",
        (6.4, 5.2),
        (0, 0, CEILING_HEIGHT),
        material("ceiling", "ceiling", roughness=0.95, grain="plaster"),
        rotation=(math.radians(180), 0, 0),
    )
    obj.visible_camera = False
    return obj


def build_shell() -> list[bpy.types.Object]:
    """Floor, two walls and skirting. An open box, so the camera can see in."""
    wall = material("wall", "wall", roughness=0.95, grain="plaster")
    accent = material("wall_accent", "wall_accent", roughness=0.95, grain="plaster")
    floor_mat = material("floor", "floor", roughness=0.6, grain="wood")

    parts = [
        # The floor stops where the walls do. It used to run 0.6 m past them at
        # both ends, which left a bare strip of board in the foreground of every
        # shot and made the room read as a set with the flats pulled in.
        plane("floor", (6.4, 5.2), (0, 0, 0), floor_mat),
        # Floorboards, as shallow insets rather than a texture: they survive a
        # bake and cost a handful of triangles each.
        _wall_with_opening(wall),
        cube("wall_left", (0.12, 5.2, WALL_TOP), (-3.2, 0, WALL_TOP / 2), accent, bevel=0),
        # The back skirting stops at the door's architrave instead of running
        # through it. Both stand on the same wall plane, so the full-length
        # board crossed the jambs at exactly their own depth — coplanar faces,
        # and the bottom corners of the door shimmered with white z-fighting
        # from every camera that could see them. The architrave spans
        # x = -3.12 to -2.08; the skirting keeps the 8 cm stub in the corner
        # and everything from the far jamb to the window wall.
        cube("skirting_back_l", (0.08, 0.05, 0.11), (-3.16, -2.52, 0.055), material("skirt", "dark_metal")),
        cube("skirting_back_r", (5.28, 0.05, 0.11), (0.56, -2.52, 0.055), material("skirt", "dark_metal")),
        cube("skirting_left", (0.05, 5.2, 0.11), (-3.12, 0, 0.055), material("skirt", "dark_metal")),
        *_sky_occluder(),
        # The ceiling. Bake-only — `EXPORT_EXCLUDE` drops it before the GLB is
        # written, so the browser still gets an open box it can look down into.
        #
        # It exists entirely for the light. Without one, everything a lamp
        # throws upward leaves the room and never comes back, which is why the
        # room read as evenly lit in some places and abruptly black in others:
        # there was no second bounce anywhere. A ceiling is the largest soft
        # reflector in any room and the cheapest possible source of the fill
        # that makes a space read as enclosed.
        #
        # White, and slightly warm. Ceilings are painted white precisely because
        # of this, and the warmth is what stops the bounce reading as moonlight.
        _ceiling(),
        # The carpet's body, and then its face.
        #
        # The face has to clear the floorboards, and by more than it looks. The
        # board lines below are 4 mm-tall cubes *centred* on z = 0.004, so they
        # occupy 0.002 to 0.006 — and the carpet used to be a flat plane at
        # exactly 0.004, which put it halfway through them. That is not z-fighting
        # that better precision would fix: the boards were genuinely standing
        # proud of the carpet, so the floor's plank grid was drawn across the
        # middle of an Isfahan medallion.
        #
        # A hand-knotted wool carpet is 10-14 mm thick, so it gets that as real
        # geometry rather than being lifted a hair. It reads as a rug lying on a
        # floor — with a visible edge you could catch a toe on — instead of as a
        # decal printed onto the boards.
        cube("rug_body", (3.9, 3.5, RUG_THICKNESS), (0.2, 0.8, 0.006 + RUG_THICKNESS / 2),
             material("rug_pile", "rug", roughness=1.0, grain="pile"), bevel=0.004),
        # Inset half a millimetre so it never shares a plane with the body's top
        # face, and a shade smaller so the body shows as the carpet's own edge.
        plane("rug", RUG_SPAN, (0.2, 0.8, 0.006 + RUG_THICKNESS + 0.0005),
              material("rug", "paper", roughness=0.96, grain="persian")),
    ]

    # Floorboards. At 0.34 m apart these read as decking, not as a floor — real
    # boards are 12–18 cm wide, and getting that wrong is one of the loudest
    # scale cues in the room because everyone has a floor to compare it to. The
    # short cross-cuts break the run into planks of varying length so the eye
    # does not read one 6 m board.
    #
    # And the planks themselves, as geometry with graded colour. The lines
    # alone drew a plank grid over one continuous surface, which is exactly
    # what laminate is: a photograph of boards under a single finish. Real
    # boards come off different trees, so each plank between the cuts is a thin
    # face carrying one of four wood tones a shade apart. The variation has to
    # be *per plank* and not per texel — a tint noise inside one material just
    # dirties the floor, because tone changes at plank boundaries are the
    # signal that boards are separate things.
    #
    # The segments reuse the exact cut positions of the end-lines, so every
    # tone change happens at a drawn joint and never in the middle of a board.
    boards = []
    planks = []
    line = material("board_line", "seam", roughness=0.92)
    grades = [
        material("floor_a", "floor", roughness=0.58, grain="wood"),
        material("floor_b", "floor_light", roughness=0.63, grain="wood"),
        material("floor_c", "floor_dark", roughness=0.55, grain="wood"),
        material("floor_d", "floor_warm", roughness=0.60, grain="wood"),
    ]
    rng = random.Random(20260730)
    for i in range(31):
        y = -2.55 + i * 0.17
        boards.append(cube(f"board_{i}", (6.4, 0.01, 0.004), (0, y, 0.004), line, bevel=0))
        cuts = []
        for j in range(3):
            # Staggered plank ends. Clamped inside the floor: an end-cut that
            # runs past the edge is a floating white dash in the void.
            cut = -2.9 + (j * 2.1 + (i % 4) * 0.55) % 5.8
            cuts.append(cut)
            boards.append(cube(f"board_end_{i}_{j}", (0.01, 0.17, 0.004), (cut, y + 0.085, 0.004), line, bevel=0))
        # The plank faces for this row: 1.5 mm above the substrate so neither
        # fights it, below the 2–6 mm the lines occupy so the joints still draw
        # over them. The top row is clamped to the floor's edge like the cuts.
        row_top = min(y + 0.17, 2.6)
        edges = [-3.2, *sorted(cuts), 3.2]
        last = grades[0]
        for j in range(len(edges) - 1):
            x0, x1 = edges[j], edges[j + 1]
            # Never the same grade twice in a row, which a blind pick produced
            # often enough that two adjacent planks merged into one long board
            # and the whole point of the cut was lost.
            grade = rng.choice([g for g in grades if g is not last])
            last = grade
            planks.append(
                plane(
                    f"plank_{i}_{j}",
                    (x1 - x0, row_top - y),
                    ((x0 + x1) / 2, (y + row_top) / 2, 0.0015),
                    grade,
                )
            )
    parts.append(join("floorboards", boards))
    parts.append(join("floor_planks", planks))
    return parts


def build_desk() -> list[bpy.types.Object]:
    """
    A 2.2 x 0.75 m desk. Large, and a size you can buy.

    It was 3.5 x 1.3 m — over twice the depth of any desk made, and it took
    everything on it with it: the keyboard was 106 cm wide, the laptop 86 cm,
    the monitors 109 cm. Meanwhile the chair, the mouse and the mug were all
    correct, so a correctly sized person sat at a desk built for a giant. That
    mismatch is exactly what makes a room feel wrong without anyone being able
    to name why, and it would have become unmissable the moment a 12 cm
    character could stand next to a keycap.

    The top stays at 0.79 m. That is a couple of centimetres above the standard
    0.75, well inside what an adjustable desk does, and holding it fixed means
    nothing standing on the desk had to move vertically.
    """
    top = material("desk", "desk", roughness=0.45, grain="wood")
    frame = material("desk_frame", "desk_frame", roughness=0.42, metallic=1.0, grain="brushed")

    parts = [
        cube("desk_top", (DESK_W, DESK_D, 0.045), (0, DESK_Y, 0.7675), top),
        cube("desk_lip", (DESK_W, 0.05, 0.06), (0, DESK_FRONT, 0.755), top),
        cube("desk_leg_l", (0.06, DESK_D - 0.14, 0.745), (-DESK_W / 2 + 0.06, DESK_Y, 0.3725), frame),
        cube("desk_leg_r", (0.06, DESK_D - 0.14, 0.745), (DESK_W / 2 - 0.06, DESK_Y, 0.3725), frame),
        cube("desk_brace", (DESK_W - 0.3, 0.05, 0.04), (0, DESK_Y - 0.24, 0.20), frame),
        # Drawer unit under the right of the desk, which also hides the join
        # between desk and floor.
        cube("drawers", (0.42, 0.58, 0.63), (0.70, DESK_Y - 0.03, 0.315),
             material("drawer", "plastic", roughness=0.5)),
    ]
    # The drawers.
    #
    # A drawer front reads as a drawer front because of the gap round it, and
    # for nothing else. These were three flat plates set into the carcass with
    # no reveal, which is why the unit read as a box with stripes painted on.
    #
    # 4 mm all round, and the faces stand proud rather than flush — an inset
    # front is a piece of cabinetry, and this is an office pedestal.
    # The faces open toward the room, not toward the wall.
    #
    # They were at DESK_Y - 0.325, which is the unit's *back* edge — the side
    # against the wall — so the drawers opened into the plaster and the room
    # only ever saw a blank box. It survived because a featureless dark box
    # under a desk is exactly what a closed drawer unit looks like from across
    # the room; you have to put the camera at desk height to see there was
    # nothing there.
    unit_front = DESK_Y - 0.03 + 0.29
    reveal = 0.004
    face_h = 0.165
    box_mat = material("drawer_box", "desk_frame", roughness=0.7)
    runner_mat = material("drawer_runner", "metal", roughness=0.3, metallic=1.0)
    for i in range(3):
        z = 0.155 + i * 0.20
        # One is left open a centimetre. Nobody closes all three, and a room
        # where everything is shut is a room nobody has used today.
        ajar = 0.012 if i == 1 else 0.0
        front = unit_front + 0.014 + ajar

        parts.append(
            cube(
                f"drawer_face_{i}",
                (0.39 - reveal * 2, 0.024, face_h - reveal * 2),
                (0.70, front, z),
                material("drawer_face", "dark_metal", roughness=0.45),
                bevel=0.003,
            )
        )
        parts.append(
            cube(
                f"drawer_pull_{i}",
                (0.15, 0.018, 0.012),
                (0.70, front + 0.015, z),
                material("pull", "metal", roughness=0.3, metallic=1.0),
            )
        )
        # Handle fixings, which is where the pull bolts through the face.
        for side in (-1, 1):
            parts.append(
                cube(
                    f"drawer_bolt_{i}_{side}",
                    (0.012, 0.006, 0.012),
                    (0.70 + side * 0.062, front + 0.004, z),
                    runner_mat,
                    bevel=0.001,
                )
            )

        if ajar:
            # An open drawer has to show a box, and the box is a different
            # material from the face — cheaper, unfinished, and lighter. An open
            # drawer with nothing in it is worse than a closed one, so this one
            # has the cables and oddments everybody's second drawer has.
            parts.append(
                cube(f"drawer_box_{i}", (0.36, 0.50, face_h - 0.03),
                     (0.70, front - 0.28, z - 0.004), box_mat, bevel=0.002)
            )
            parts.append(
                cube(f"drawer_inner_{i}", (0.33, 0.46, face_h - 0.055),
                     (0.70, front - 0.28, z + 0.004),
                     material("drawer_void", "void", roughness=1.0), bevel=0)
            )
            for j, (dx, dy, w, l) in enumerate((
                (-0.09, 0.10, 0.055, 0.11),
                (0.04, 0.06, 0.075, 0.05),
                (0.10, 0.14, 0.035, 0.09),
            )):
                parts.append(
                    cube(f"drawer_thing_{i}_{j}", (w, l, 0.016),
                         (0.70 + dx, front - 0.14 - dy, z - 0.052),
                         material(f"drawer_thing_{j}", ("plastic", "book_a", "metal")[j], roughness=0.6),
                         bevel=0.002, rotation_z=math.radians(6 - j * 7))
                )
            # Ball-bearing runners, visible the moment one opens.
            for side in (-1, 1):
                parts.append(
                    cube(f"drawer_runner_{i}_{side}", (0.010, 0.44, 0.026),
                         (0.70 + side * 0.185, front - 0.30, z), runner_mat, bevel=0.001)
                )
    return parts


def build_monitors() -> list[bpy.types.Object]:
    """
    Two 27-inch monitors on a dual arm. `ix_monitor_health` and
    `ix_monitor_code` are looked up by name at runtime, so they stay separate.

    A 27-inch panel is 61 x 37 cm. These were 109 cm wide — a size no monitor
    has ever been — which is most of why the desk read as furniture for a
    giant.
    """
    shell = material("monitor_shell", "plastic", roughness=0.4, metallic=0.0)
    screen_mat = material("screen", "screen", roughness=0.18)
    arm_mat = material("arm", "dark_metal", roughness=0.38, metallic=1.0, grain="brushed")

    out: list[bpy.types.Object] = []
    panel_w, panel_h = 0.615, 0.375
    back = DESK_BACK + 0.20
    centre_z = 1.09

    for name, x, tilt in (("ix_monitor_health", -0.325, 0.13), ("ix_monitor_code", 0.325, -0.13)):
        # A panel and a chin, not one slab. The bezel is 1 cm at the sides and
        # top and 3 cm along the bottom, which is how every monitor made in the
        # last decade is proportioned.
        panel = cube(f"{name}_body", (panel_w, 0.019, panel_h), (x, back, centre_z), shell, rotation_z=tilt)
        parts = [panel]

        # Glass over the panel, with the display set behind it.
        #
        # An emissive plane flush with the bezel is the single thing that most
        # reliably makes a monitor read as a screenshot of a monitor. A real one
        # has a sheet of glass in front, the panel recessed behind it, and a
        # black mask between the two — and at night, when most of the screen is
        # dark, that glass is mostly reflecting the room.
        # Behind the display plane, not in front of it.
        #
        # "Glass over the panel" is right about a real monitor and wrong about
        # this one: the display is an opaque quad the runtime paints a canvas
        # onto, so anything in front of it hides the content — and the content
        # is the entire reason the monitors exist. Both screens shipped black.
        # The glass reads as glass from its edge and from the reflection baked
        # into the surround; it does not have to be the frontmost surface.
        glass = cube(f"{name}_glass", (panel_w - 0.008, 0.003, panel_h - 0.008),
                     (x + math.sin(tilt) * 0.009, back + 0.0090, centre_z), 
                     material("screen_glass", "screen", roughness=0.05),
                     rotation_z=tilt, bevel=0.001)
        parts.append(glass)
        # The mask around the panel, which is what the bezel lips over.
        parts.append(
            cube(f"{name}_mask", (panel_w - 0.004, 0.004, panel_h - 0.004),
                 (x + math.sin(tilt) * 0.006, back + 0.0060, centre_z),
                 material("screen_mask", "void", roughness=0.9), rotation_z=tilt, bevel=0)
        )
        # The OSD joystick nub under the right of the chin, and a brand mark on
        # it. Every monitor has both and neither is ever modelled.
        parts.append(
            cylinder(f"{name}_osd", 0.005, 0.010,
                     (x + math.cos(tilt) * 0.20, back - 0.014, centre_z - panel_h / 2 + 0.010),
                     material("osd_nub", "dark_metal", roughness=0.4), vertices=8,
                     rotation=(math.radians(90), 0, 0))
        )
        parts.append(
            cube(f"{name}_brand", (0.038, 0.004, 0.007),
                 (x, back + 0.011, centre_z - panel_h / 2 + 0.011),
                 material("brand_mark", "metal", roughness=0.3, metallic=1.0),
                 rotation_z=tilt, bevel=0)
        )
        # Ventilation slots across the back, and the VESA plate with its four
        # screws. A monitor's back is a moulding, not a slab.
        for slot in range(7):
            parts.append(
                cube(f"{name}_vent_{slot}", (0.20, 0.004, 0.005),
                     (x + math.sin(tilt) * 0.04, back - 0.045, centre_z + 0.055 + slot * 0.011),
                     material("vent", "void", roughness=0.9), rotation_z=tilt, bevel=0)
            )
        parts.append(
            cube(f"{name}_vesa", (0.10, 0.006, 0.10),
                 (x + math.sin(tilt) * 0.045, back - 0.047, centre_z - 0.010),
                 material("vesa", "dark_metal", roughness=0.5), rotation_z=tilt, bevel=0.002)
        )
        for sx in (-0.04, 0.04):
            for sz in (-0.04, 0.04):
                parts.append(
                    cylinder(f"{name}_vesa_screw_{sx}_{sz}", 0.0035, 0.004,
                             (x + sx + math.sin(tilt) * 0.05, back - 0.050, centre_z - 0.010 + sz),
                             material("vesa_screw", "metal", roughness=0.3, metallic=1.0),
                             vertices=6, rotation=(math.radians(90), 0, 0))
                )
        parts.append(
            cube(f"{name}_housing", (0.34, 0.036, 0.20), (x + math.sin(tilt) * 0.03, back - 0.026, centre_z - 0.005),
                 shell, rotation_z=tilt)
        )
        parts.append(
            cube(f"{name}_led", (0.012, 0.006, 0.006),
                 (x + math.cos(tilt) * 0.235, back + 0.012, centre_z - panel_h / 2 + 0.012),
                 material("monitor_led", "cyan", roughness=0.3, emission=1.0), bevel=0)
        )
        # A single quad, not a thin box: a cube's UVs give every face its own
        # patch of the image, so a canvas texture applied to one tiles across
        # all six.
        screen = plane(f"{name}_display", (panel_w - 0.02, panel_h - 0.04), (x, back + 0.0115, centre_z + 0.008),
                       screen_mat, rotation=(math.radians(-90), 0, tilt))
        out.append(join(name, parts))
        out.append(screen)

    hub = (0.0, DESK_BACK + 0.09, 1.10)
    out += [
        cube("arm_base", (0.19, 0.13, 0.016), (0.0, DESK_BACK + 0.09, DESK_TOP + 0.008), arm_mat, bevel=0.004),
        cylinder("arm_post", 0.016, 0.40, (0.0, DESK_BACK + 0.09, DESK_TOP + 0.20), arm_mat, vertices=16),
        cylinder("arm_hub", 0.024, 0.036, hub, arm_mat, vertices=16),
    ]
    for name, x, tilt in (("health", -0.325, 0.13), ("code", 0.325, -0.13)):
        out.append(strut(f"arm_reach_{name}", hub, (x, back - 0.05, centre_z), 0.012, arm_mat))
        out.append(
            cube(f"arm_plate_{name}", (0.07, 0.022, 0.07), (x, back - 0.036, centre_z), arm_mat,
                 rotation_z=tilt, bevel=0.003)
        )
    return out


def build_laptop() -> list[bpy.types.Object]:
    """
    Modelled open, with the lid as its own object pivoting on the hinge so the
    runtime can animate it shut. Origin sits on the hinge line, not the lid
    centre, or it swings through the desk.
    """
    body = material("laptop_body", "metal", roughness=0.3, metallic=1.0)
    screen_mat = material("laptop_screen", "screen", roughness=0.15)

    # The desk's surface is at z = 0.79. The base used to sit at 0.774 with a
    # half-thickness of 0.009, which put its *top* at 0.783 — the whole laptop
    # body was buried inside the desk, and the screen stood on the desktop with
    # nothing under it. Everything here is lifted to rest on the surface rather
    # than inside it.
    # Forward and turned, because the chair sits between it and the camera.
    #
    # The two do not collide — the laptop runs x -0.97..-0.61 and the chair
    # -0.43..0.33 — but the chair is nearer the viewer with a tall back, so from
    # the one angle the site actually opens on, the laptop was behind it. Two
    # objects can be clear of each other in the room and on top of each other in
    # the frame, and only the frame is ever seen.
    #
    # Angled as well as moved: a laptop set down beside a monitor is turned
    # toward whoever is sitting there, and the turn also puts its lid across the
    # sightline rather than edge-on to it.
    lx, ly = -0.56, DESK_FRONT - 0.33
    deck_top = DESK_TOP + 0.022

    base = cube("laptop_base", (0.35, 0.245, 0.012), (lx, ly, DESK_TOP + 0.006), body)

    # The deck is a recessed well with real keys in it, not a painted-on
    # rectangle. A laptop is seen from above more than from any other angle, so
    # the deck is most of what there is to look at — a flat panel there is the
    # single biggest thing between this and a real machine.
    parts_base = [base]
    parts_base.append(
        cube("laptop_well", (0.28, 0.105, 0.003), (lx, ly - 0.052, deck_top - 0.0015),
             material("deck", "keycap"), bevel=0)
    )

    key_mat = material("laptop_key", "plastic", roughness=0.68)
    for row in range(5):
        # The bottom row is the space bar and its neighbours, so it is drawn as
        # three wide keys rather than fourteen narrow ones.
        if row == 4:
            for name, width, offset in (("lkey_ctl", 0.055, -0.093), ("lkey_space", 0.11, 0.0), ("lkey_alt", 0.055, 0.093)):
                parts_base.append(
                    cube(f"{name}", (width, 0.0135, 0.0025), (lx + offset, ly - 0.024, deck_top + 0.0015), key_mat, bevel=0.0004)
                )
            continue
        for col in range(14):
            parts_base.append(
                cube(
                    f"lkey_{row}_{col}",
                    (0.0152, 0.0135, 0.0025),
                    (lx - 0.1215 + col * 0.0187, ly - 0.0985 + row * 0.0178, deck_top + 0.0015),
                    key_mat,
                    bevel=0.0004,
                )
            )

    # --- the parts that say "machined aluminium" -------------------------
    #
    # A laptop is a milled shell, and everything that says so lives on its
    # edges: a polished chamfer catching a line of light, ports cut into the
    # side with a visible wall thickness, a seam where lid meets base. Without
    # them it is a box with keys on it.

    chamfer_mat = material("laptop_chamfer", "metal", roughness=0.18, metallic=1.0)
    for side in (-1, 1):
        parts_base.append(
            cube(f"laptop_chamfer_x_{side}", (0.0022, 0.245, 0.0022),
                 (lx + side * 0.175, ly, DESK_TOP + 0.0118), chamfer_mat, bevel=0)
        )
    for edge, dy in (("front", -0.1225), ("back", 0.1225)):
        parts_base.append(
            cube(f"laptop_chamfer_y_{edge}", (0.35, 0.0022, 0.0022),
                 (lx, ly + dy, DESK_TOP + 0.0118), chamfer_mat, bevel=0)
        )

    # Ports, cut into the sides with a wall thickness rather than painted on.
    port_mat = material("laptop_port", "void", roughness=0.9)
    for side, offsets in ((-1, (-0.05, 0.0, 0.05)), (1, (-0.03, 0.03))):
        for index, dy in enumerate(offsets):
            parts_base.append(
                cube(f"laptop_port_{side}_{index}", (0.006, 0.0092, 0.0034),
                     (lx + side * 0.1735, ly + dy, DESK_TOP + 0.0062), port_mat, bevel=0)
            )

    # Speaker grilles flanking the keyboard, perforated rather than painted.
    grille_mat = material("laptop_grille", "void", roughness=0.85)
    for side in (-1, 1):
        for hole in range(14):
            parts_base.append(
                cube(f"laptop_grille_{side}_{hole}", (0.0034, 0.0034, 0.001),
                     (lx + side * 0.152, ly - 0.098 + hole * 0.0092, deck_top - 0.0005),
                     grille_mat, bevel=0)
            )

    # The seam where lid meets base, consistent all the way round.
    parts_base.append(
        cube("laptop_seam", (0.35, 0.245, 0.0012), (lx, ly, DESK_TOP + 0.0122),
             material("laptop_seam", "bezel", roughness=0.5), bevel=0)
    )

    # Underside: rubber strips rather than four dots, and a regulatory panel.
    foot_mat = material("laptop_foot", "bezel", roughness=0.9)
    for dy in (-0.10, 0.10):
        parts_base.append(
            cube(f"laptop_foot_{dy}", (0.30, 0.010, 0.0016), (lx, ly + dy, DESK_TOP + 0.0008),
                 foot_mat, bevel=0)
        )

    # A charger, plugged in and running off the desk edge.
    parts_base.append(
        cube("laptop_charger_plug", (0.010, 0.016, 0.008), (lx - 0.178, ly + 0.08, DESK_TOP + 0.008),
             material("charger", "dark_metal", roughness=0.5), bevel=0.002)
    )

    # Trackpad, palm rest side.
    parts_base.append(
        cube("laptop_trackpad", (0.10, 0.062, 0.0015), (lx, ly + 0.064, deck_top + 0.0005),
             material("trackpad", "chair_light", roughness=0.35), bevel=0.001)
    )
    # Hinge barrel and four rubber feet.
    parts_base.append(
        cylinder("laptop_hinge", 0.005, 0.20, (lx, ly - 0.121, DESK_TOP + 0.008), material("hinge", "dark_metal", roughness=0.45),
                 vertices=12, rotation=(0, math.radians(90), 0))
    )
    for fx in (-0.145, 0.145):
        for fy in (-0.098, 0.098):
            parts_base.append(
                cylinder(f"laptop_foot_{fx}_{fy}", 0.006, 0.003, (lx + fx, ly + fy, DESK_TOP + 0.0015),
                         material("foot", "plastic", roughness=0.9), vertices=8)
            )

    # 6 mm, not 8, and the recline opened from 14 degrees to 19.
    #
    # Two small numbers that decide whether this reads as a laptop or as a
    # slab stood on edge. A lid seen from the desk is mostly its *edge*, and
    # 8 mm of aluminium at that scale is a plank; the recline matters for the
    # same reason, because a screen sitting nearly vertical has no visible
    # top face and loses the wedge silhouette that says "open laptop".
    lid = cube("ix_laptop_lid_body", (0.35, 0.006, 0.235), (lx, DESK_FRONT - 0.42, DESK_TOP + 0.13), body)
    # A 1.5 cm bezel rather than 3 cm. Screens have got to the edge of their
    # lids since about 2018 and a fat border is the first thing that dates one.
    lid_screen = plane(
        "ix_laptop_display", (0.335, 0.215), (lx, DESK_FRONT - 0.415, DESK_TOP + 0.13), screen_mat,
        rotation=(math.radians(-90), 0, 0)
    )
    # Bake the screen's facing rotation into its vertices before re-origining.
    # Left as an object rotation it also rotates the screen's offset from the
    # hinge, so the two halves swing on different arcs and the screen ends up
    # sitting proud of the panel instead of flush in it. Once baked, both parts
    # carry the same object rotation and stay coplanar through the whole swing.
    bpy.context.view_layer.objects.active = lid_screen
    bpy.ops.object.select_all(action="DESELECT")
    lid_screen.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    # A bezel around the glass, in the dark plastic every laptop uses rather
    # than the shell's metal. Without it the screen was a bright rectangle
    # butted straight against brushed aluminium, and from close up that reads
    # as a picture stuck to a panel — the black surround is what makes the
    # display sit *inside* the lid.
    bezel = cube("laptop_bezel", (0.344, 0.004, 0.229),
                 (lx, DESK_FRONT - 0.4175, DESK_TOP + 0.13),
                 material("laptop_bezel", "bezel", roughness=0.62), bevel=0)
    # The camera above the screen, which is 3 mm of geometry and the single
    # most recognisable mark on the top bezel.
    lens = cylinder("laptop_camera", 0.0016, 0.0016,
                    (lx, DESK_FRONT - 0.4195, DESK_TOP + 0.2385),
                    material("laptop_lens", "void", roughness=0.25), vertices=8,
                    rotation=(math.radians(90), 0, 0))

    hinge = Vector((lx, DESK_FRONT - 0.42, DESK_TOP + 0.012))
    for obj in (lid, bezel, lens, lid_screen):
        # Re-origin onto the hinge line so the lid rotates about it rather than
        # about its own centre, which would swing it through the desk.
        obj.data.transform(Matrix.Translation(obj.location - hinge))
        obj.location = hinge

    # Deliberately not joined. Joining the screen into the lid gives one mesh
    # with two materials, and glTF splits that into ix_laptop_lid_1 and _2 — so
    # the mesh named ix_laptop_display never reaches the export, and the runtime
    # paints a terminal onto something that does not exist. Both share the hinge
    # as their origin, so the animation turns them together without a parent.
    for obj in (lid, bezel, lens, lid_screen):
        obj.rotation_euler = (math.radians(-19), 0, 0)
    # The bezel and the camera are part of the lid's shell, so they join it —
    # only the display stays separate, because the runtime paints it.
    lid = join("ix_laptop_lid_body", [lid, bezel, lens])

    # And the display is *parented* to the lid rather than merely given the
    # same transform.
    #
    # Sharing an origin and an angle is not the same as being attached. Both
    # halves were being posed independently — by this file at build time and
    # by the animation at run time — so the screen stayed flush with its
    # panel only for as long as two separate pieces of code agreed about a
    # number. A screen that has drifted off its lid is the most broken-
    # looking thing a desk can have.
    #
    # Parenting makes the relationship structural: the lid is the only thing
    # that moves, the screen goes wherever the lid goes, and no later edit
    # can separate them by forgetting to update a second place.
    lid_screen.parent = lid
    lid_screen.matrix_parent_inverse = lid.matrix_world.inverted()

    return [lid, lid_screen, join("laptop_base", parts_base)]


def _cell_uvs(obj: bpy.types.Object, column: int, row: int, columns: int, rows: int) -> None:
    """
    Point a quad's UVs at one cell of a grid atlas.

    Derived from each vertex's own position in the quad rather than from loop
    order, because loop order is an implementation detail of whatever built the
    mesh and silently differs between a primitive and a hand-assembled cage.
    Reading the geometry cannot be wrong about which corner is which.

    V is inverted: row 0 is meant to be the *top* row of the image, and UV space
    counts up from the bottom. Getting this backwards prints the function row
    where the space bar should be — which is exactly how the sticky notes came
    out upside down.
    """
    mesh = obj.data
    layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    span_x = (max(xs) - min(xs)) or 1.0
    span_y = (max(ys) - min(ys)) or 1.0

    for polygon in mesh.polygons:
        for loop in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop].vertex_index].co
            u = (co.x - min(xs)) / span_x
            v = (co.y - min(ys)) / span_y
            layer.data[loop].uv = (
                (column + u) / columns,
                ((rows - 1 - row) + v) / rows,
            )


def build_keyboard_and_props() -> list[bpy.types.Object]:
    """
    A tenkeyless keyboard at real size, and the loose things around it.

    The keyboard was 106 cm wide with 75 identical 4.2 cm keycaps on a uniform
    grid. It is now 32 cm across a 19.5 mm key pitch, and the rows carry the
    widths a keyboard actually has — a 2u backspace, a 1.5u tab, a 6.25u space
    bar. A grid of identical squares is the single most recognisable sign of a
    modelled keyboard, and it is visible from across the room.
    """
    key_mat = material("keycap", "keycap", roughness=0.7)
    body_mat = material("kb_body", "plastic", roughness=0.5)

    # One key unit. Every width below is a multiple of it, as on a real board.
    U = 0.0195
    # Far enough back to leave room for wrists.
    #
    # At DESK_FRONT - 0.13 the block's near edge was 2.5 cm from the desk edge,
    # which is not a place anybody puts a keyboard and left the wrist rest
    # hanging off the desk and inside the chair. `check_swallowed` caught that.
    KX, KY = KEY_X, DESK_FRONT - 0.235
    deck = DESK_TOP + 0.014

    # Widths per row, in units. They sum to 15u on every row, which is what
    # makes the block rectangular despite none of the rows matching.
    rows = (
        (1,) * 14 + (1,),
        (1,) * 13 + (2,),
        (1.5,) + (1,) * 12 + (1.5,),
        (1.75,) + (1,) * 11 + (2.25,),
        (2.25,) + (1,) * 10 + (2.75,),
        (1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25),
    )

    # The function row stands off the main block. Every keyboard has that gap
    # and a continuous grid of six rows does not read as one — the cluster gap
    # is what the eye uses to tell a keyboard from a calculator.
    cluster_gap = U * 0.42

    keys = []
    # One quad per keycap, addressing its own cell of a 15x6 legend atlas the
    # runtime paints. Six rows, and fifteen because that is the widest row —
    # every row sums to 15u, and the row with the most keys has fifteen of them.
    #
    # Quads rather than lettering the cap tops directly: the caps are boxes that
    # get smart-unwrapped with everything else, so their UVs are packed wherever
    # the atlas had room. A quad is a surface whose UVs can mean something.
    legends = []
    LEGEND_COLS, LEGEND_ROWS = 15, 6
    legend_mat = material("keycap_legend", "keycap", roughness=0.62)
    stems = []
    stem_mat = material("kb_stem", "book_b", roughness=0.5)
    for row_index, widths in enumerate(rows):
        # Rows are sculpted: the far row sits higher and the near row lower, so
        # the block dishes toward the fingers instead of being a flat plane.
        lift = (0.0016, 0.0008, 0.0, 0.0, 0.0004, 0.0011)[row_index]
        # Each row is also angled, not just raised. A keycap's top is tilted
        # toward the typist, and the run of those angles down the block is what
        # makes the profile recognisable from the side.
        #
        # Halved, twice over. The original spread was 13 degrees across the
        # block — true of a sculpted board, and fine in every shot taken from
        # standing height, where the caps are four pixels each and the run of
        # angles reads as a profile. From the desk it reads as damage: a
        # 12 cm robot stands almost level with the caps and sees them nearly
        # edge-on, and at that angle 13 degrees of difference between
        # neighbouring rows looks like keys that have been knocked askew
        # rather than keys that were moulded that way.
        #
        # This is the general lesson of putting a camera on the desk: detail
        # authored to read at three metres has to survive being read at ten
        # centimetres, and sculpting is the first thing that does not.
        tilt = (0.05, 0.035, 0.012, -0.012, -0.035, -0.062)[row_index]
        # Row 0 is the function row and belongs *furthest* from the typist.
        #
        # It was laid out at the largest y — the room side, which is where a
        # person sits — so the whole block ran backwards: function keys under
        # your palms and the space bar against the monitors. The cluster gap
        # went with it, so the one gap that tells a keyboard from a calculator
        # was at the near edge too.
        y = KY + row_index * U + (0.0 if row_index == 0 else cluster_gap)
        # Columns run toward -X, and that is not arbitrary.
        #
        # The typist sits at +Y and looks down -Y, which puts world +X on their
        # left — the same fact that makes every monitor in this room need
        # `mirror-u`. Laying column 0 out at the smallest X therefore put the
        # escape key at the typist's right hand and the 2u backspace at their
        # left, with the whole board reflected about its centre line.
        #
        # It survived a long time because it is invisible from every angle the
        # room is normally seen from, and because a keyboard is symmetrical
        # enough at a glance that only the legends give it away — which there
        # were none of until now.
        x = KX + 15 * U / 2
        for col, width in enumerate(widths):
            span = width * U
            x -= span
            cap = cube(
                f"key_{row_index}_{col}",
                (span - 0.0025, U - 0.0025, 0.0075),
                (x + span / 2, y, deck + lift),
                key_mat,
                bevel=0.0008,
            )
            cap.rotation_euler = (tilt, 0, 0)
            keys.append(cap)

            # The legend, on the cap's top face rather than above its centre.
            # The cap turns about its own middle, so its top corner travels —
            # placing the quad at the untilted height leaves it hanging off the
            # back edge of every key in the two steepest rows.
            # A quarter of a millimetre above the cap's top face.
            #
            # It was 0.05 mm, chosen so the print would have no visible gap,
            # and measured from the room's own camera that was right. From
            # the robot's camera it was not: at 10 cm from a keycap with the
            # depth range this scene carries, 0.05 mm is inside the depth
            # buffer's noise, and the legends z-fought their own keys —
            # letters flickering in and out of the plastic they are printed
            # on. Probing the geometry is what settled it, because the marks
            # were not floating above the caps as they appeared to be; they
            # were sunk 0.3 mm into them.
            #
            # A quarter of a millimetre is still nothing from across the room
            # and is well clear of the buffer's precision up close.
            lift_h = 0.00400
            legend = plane(
                f"legend_{row_index}_{col}",
                (min(span, U) * 0.58, U * 0.50),
                (
                    x + span / 2,
                    y - lift_h * math.sin(tilt),
                    deck + lift + lift_h * math.cos(tilt),
                ),
                legend_mat,
            )
            legend.rotation_euler = (tilt, 0, 0)
            _cell_uvs(legend, col, row_index, LEGEND_COLS, LEGEND_ROWS)
            legends.append(legend)
            # The switch stem under each cap, visible in the gaps from a low
            # angle — which is exactly the angle anything standing on the desk
            # would see the keyboard from.
            stems.append(
                cube(
                    f"kb_stem_{row_index}_{col}",
                    (0.0042, 0.0042, 0.006),
                    (x + span / 2, y, deck + lift - 0.005),
                    stem_mat,
                    bevel=0,
                )
            )

    legend_block = join("ix_keycap_legends", legends)

    depth = len(rows) * U + 0.014 + cluster_gap
    body = cube("kb_body", (15 * U + 0.016, depth, 0.016),
                (KX, KY + (len(rows) - 1) * U / 2 + cluster_gap / 2, DESK_TOP + 0.008),
                body_mat, bevel=0.003)

    # A caps-lock indicator, above the left of the block.
    caps_led = cube("kb_caps_led", (0.0032, 0.0032, 0.001),
                    (KX - 15 * U / 2 + 0.012, KY - U * 0.62, deck + 0.0012),
                    material("kb_led", "green", roughness=0.3, emission=3.0), bevel=0)

    # Flip-out feet at the back, which is what produces the slope. Modelled
    # rather than faked by tilting the case alone, because the gap under the
    # back edge is visible from desk height and is half of what says the feet
    # are down.
    feet = [
        cube(f"kb_foot_{side}", (0.016, 0.010, 0.010),
             (KX + side * (15 * U / 2 - 0.03), KY - U * 0.35, DESK_TOP + 0.005),
             body_mat, bevel=0.002)
        for side in (-1, 1)
    ]

    # A wrist rest, compressed where forearms sit.
    wrist = cube("kb_wrist_rest", (15 * U + 0.016, 0.062, 0.011),
                 (KX, KY + (len(rows) - 1) * U + cluster_gap + 0.048, DESK_TOP + 0.0075),
                 material("wrist_rest", "chair_dark", roughness=0.9, grain="fabric"), bevel=0)
    smooth(wrist, 2, crease=0.55)

    # The cable, off the back edge and away toward the desk's grommet.
    kb_cable = cable(
        "kb_cable",
        [
            (KX, KY - U * 0.6, DESK_TOP + 0.010),
            (KX + 0.10, KY - 0.16, DESK_TOP + 0.006),
            (KX + 0.28, KY - 0.24, DESK_TOP + 0.004),
        ],
        0.0026,
        material("kb_cable", "bezel", roughness=0.6),
    )
    # A desk mat under the keyboard and mouse.
    #
    # Almost universal on a desk like this, and it changes the read of the whole
    # surface: it gives the keyboard and the mouse something to sit on other
    # than bare wood, and it puts a soft dark rectangle under the brightest part
    # of the room, which is what stops the desktop reading as one flat plank.
    #
    # Very thin, and sunk a hair into the desk so its underside never z-fights
    # the wood.
    mat_pad = cube(
        "desk_mat",
        (0.90, 0.40, 0.003),
        (KEY_X + 0.06, DESK_FRONT - 0.18, DESK_TOP + 0.0012),
        material("desk_mat", "rug", roughness=0.92, grain="fabric"),
        bevel=0.002,
        rotation_z=math.radians(-1.2),
    )

    keyboard = join("ix_keyboard", [body] + keys + stems + feet + [caps_led])
    # Six degrees of slope, pivoted about the front edge so the near edge stays
    # on the desk and the back lifts onto the feet.
    # Six degrees, pivoting at the edge nearest the typist so the far edge is
    # the one that lifts onto the feet. A keyboard slopes up and away; sloping
    # up toward the person is the one orientation that makes it unusable, and it
    # is invisible from above — which is the only angle the room is normally
    # seen from.
    # The pivot, named once, because two objects have to turn about it and the
    # legends are not in the join above.
    #
    # They cannot be: they carry a grid atlas addressed through per-cell UVs and
    # the runtime paints them as one surface, so they are a separate mesh by
    # design. That made them the one part of the keyboard the slope did not
    # reach — the caps rose by up to 12 mm at the back and the legends stayed
    # flat on the deck, which buried every one of them inside the key it was
    # meant to be printed on.
    #
    # It looked exactly like a texture that had failed to apply, and it was
    # chased as one: the atlas was regenerated, the UVs were dumped and checked
    # cell by cell, the material assignment was traced through the render, and
    # every one of those came back correct. What finally showed it was measuring
    # the geometry — cap tops at z 0.823, legends at 0.812 — because a thing
    # that is 11 mm inside another thing is not a shading problem.
    slope = (KX, KY + (len(rows) - 1) * U + cluster_gap + U * 0.5, DESK_TOP)
    for part in (keyboard, legend_block):
        set_origin(part, slope)
        part.rotation_euler = (math.radians(-6), 0, 0)
    # A legend is printed on the cap, not resting above it. The quad clears the
    # cap by a quarter of a millimetre, which is nothing to look at and plenty
    # to cast with — at the grazing angle the desk lamp makes, that gap threw a
    # crisp offset rectangle onto every key and the caps read as having stickers
    # on them.
    legend_block.visible_shadow = False

    # A mouse is a shape, not a lozenge.
    #
    # It was a subdivided box: the same width and the same height from end to
    # end. From across the room that reads as a mouse, because a mouse is
    # roughly mouse-sized and dark. From the desk — where something standing
    # on the mat looks along it — it read as a bar of soap. Every real mouse
    # narrows and drops toward the front and swells under the palm, and that
    # taper down its length is the whole silhouette.
    #
    # The taper is put into the cage before it is subdivided, rather than
    # lofted from rows or carved with a solidify. Both of those were tried:
    # the solidify follows the domed top with a domed bottom, so the shell
    # sank 22 mm through the desk to keep its thickness — invisible, but the
    # mouse is a physics prop and its collision hull is built from the mesh,
    # so it would have come to rest hovering above the surface it is meant to
    # be sliding on. Moving four corners of a box costs nothing and leaves
    # the base dead flat.
    mx, my = 0.15, DESK_FRONT - 0.13
    shell = cube("ix_mouse", (0.062, 0.105, 0.032), (mx, my, DESK_TOP + 0.016), body_mat, bevel=0)
    for vertex in shell.data.vertices:
        # -y is the far end, where the cable leaves and the hand does not
        # rest: narrower across, and dropped to about a third of the height.
        if vertex.co.y < 0:
            vertex.co.x *= 0.56
            if vertex.co.z > 0:
                vertex.co.z *= 0.30
    smooth(shell, 2, crease=0.22)

    # The split between the buttons, and the wheel in it.
    #
    # Without them a mouse is an anonymous lozenge — those two features are the
    # whole of what makes the shape readable, and they sit on the face that is
    # always pointing at the camera. The split is a groove rather than a drawn
    # line, so it catches its own shadow.
    split = cube("mouse_split", (0.0016, 0.052, 0.004),
                 (mx, my - 0.022, DESK_TOP + 0.0272),
                 material("mouse_seam", "void", roughness=0.9), bevel=0)
    wheel = cylinder("mouse_wheel", 0.0075, 0.0055, (mx, my - 0.028, DESK_TOP + 0.0268),
                     material("mouse_wheel", "chair_dark", roughness=0.45),
                     vertices=14, rotation=(0, math.radians(90), 0))
    mouse = join("ix_mouse", [shell, split, wheel])

    mug_mat = material("mug", "mug", roughness=0.35)
    mug_x, mug_y = 0.40, DESK_FRONT - 0.14
    mug_body = cylinder("mug_body", 0.043, 0.095, (mug_x, mug_y, DESK_TOP + 0.055), mug_mat)
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.030, minor_radius=0.007, location=(mug_x + 0.062, mug_y, DESK_TOP + 0.058)
    )
    handle = bpy.context.object
    handle.name = "mug_handle"
    handle.data.name = "mug_handle"
    # Spun about X, not Y. A torus is born in the XY plane with its axis on Z;
    # turning it about Y leaves the ring facing the way it sticks out, so the
    # handle stood edge-on to the mug like a wheel rather than a loop.
    handle.rotation_euler = (math.radians(90), 0, 0)
    shade(handle, mug_mat)

    # A mug that is solid to the brim is a peg with a handle. The well is what
    # makes it a vessel, and it costs one cylinder — the shelf mug beside it has
    # had one all along, which is why that one reads and this one did not.
    well = cylinder("mug_well", 0.036, 0.082, (mug_x, mug_y, DESK_TOP + 0.062),
                    material("mug_void", "void", roughness=0.95))
    # And coffee in it, a centimetre down from the rim. An empty mug on a desk
    # at night is a detail nobody puts there on purpose.
    brew = cylinder("mug_brew", 0.0355, 0.002, (mug_x, mug_y, DESK_TOP + 0.078),
                    material("brew", "brew", roughness=0.18))
    mug = join("ix_mug", [mug_body, handle, well, brew])

    # A5 rather than the 34 x 46 cm slab it was — no notebook is that size.
    notebook = cube(
        "ix_notebook",
        (0.155, 0.215, 0.016),
        (0.26, DESK_FRONT - 0.40, DESK_TOP + 0.008),
        material("notebook", "book_a", roughness=0.6),
        rotation_z=math.radians(-9),
    )
    pencil = cylinder(
        "ix_pencil",
        0.0045,
        0.16,
        (0.26, DESK_FRONT - 0.37, DESK_TOP + 0.020),
        material("pencil", "sticky", roughness=0.6),
        vertices=6,
        rotation=(0, math.radians(90), math.radians(14)),
    )

    return [mat_pad, keyboard, wrist, kb_cable, mouse, mug, pencil, notebook,
            # Right of the mug rather than left of the laptop. Moving the laptop
            # forward to clear the chair put it straight through where these
            # were resting — `check_clearance` measured the overlap at 19 cm —
            # and the desk's right front is the one pocket nothing else wants.
            build_headphones(0.66, DESK_FRONT - 0.10, DESK_TOP)]


def build_headphones(hx: float, hy: float, deck: float) -> bpy.types.Object:
    """
    Over-ear headphones lying on the desk, cups down, band arcing over them.

    They were a single flat disc — a 20 cm coaster standing in for the one
    object on the desk with a shape everyone can draw from memory. Nothing
    about a disc says headphones, and at this size the silhouette is all there
    is to go on.
    """
    shell = material("headphone_shell", "plastic", roughness=0.42)
    pad = material("headphone_pad", "dark_metal", roughness=0.95, grain="fabric")
    metal = material("headphone_band", "metal", roughness=0.4, metallic=1.0, grain="brushed")

    span = 0.075
    parts: list[bpy.types.Object] = []

    for side in (-1, 1):
        cx = hx + side * span
        # Cup and ear pad as one lathed profile each, so the pad rolls over
        # rather than sitting on as a separate ring.
        parts.append(
            lathe(
                f"cup_{side}",
                [(0.0, 0.055), (0.044, 0.055), (0.05, 0.048), (0.05, 0.03), (0.043, 0.026)],
                (cx, hy, deck),
                shell,
                segments=22,
            )
        )
        parts.append(
            lathe(
                f"pad_{side}",
                [(0.048, 0.026), (0.052, 0.018), (0.048, 0.004), (0.032, 0.0)],
                (cx, hy, deck),
                pad,
                segments=22,
            )
        )
        # The yoke the cup pivots in.
        yoke = cube(f"yoke_{side}", (0.012, 0.09, 0.05), (cx + side * 0.052, hy, deck + 0.035), metal, bevel=0.004)
        parts.append(yoke)

    # The band: a ribbon swept over a semicircle, given thickness and rounded.
    # An arc is the whole read of a pair of headphones and there is no
    # primitive for one.
    steps = 14
    radius = span + 0.052
    verts: list[tuple[float, float, float]] = []
    for step in range(steps + 1):
        angle = math.pi * step / steps
        x = -math.cos(angle) * radius
        z = math.sin(angle) * radius * 0.62
        for edge in (-1, 1):
            verts.append((x, edge * 0.017, z + 0.035))
    faces = [(n, n + 1, n + 3, n + 2) for n in range(0, steps * 2, 2)]

    band = poly("band", verts, faces, (hx, hy, deck), metal)
    band.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.009
    parts.append(smooth(band, 1, crease=0.4))

    return join("ix_headphones", parts)


def build_cv() -> list[bpy.types.Object]:
    """
    The CV, printed and standing in a document holder at the right of the desk.

    The room already said everything the CV says, spread across a dozen objects
    — but it never showed the document itself, which is the one artefact a
    recruiter actually asks for. It stands rather than lying flat because a page
    face-up on a desk is unreadable from every angle the camera can reach, and
    an unreadable page is a grey rectangle.

    `ix_cv_face` is the printed side and is painted at runtime from `src/data`,
    the same way the monitors and the whiteboard are. The holder around it is
    `ix_cv`, so the whole thing answers to one click.
    """
    # Leaning back from vertical. A page perpendicular to the desk is a slab
    # seen edge-on from the establishing shot; twenty degrees is enough to catch
    # the key light across it and still read as standing rather than propped.
    lean = math.radians(20)
    # A plane is born in XY facing +Z. Turning it -90° about X faces it +Y, into
    # the room; easing off that angle by the lean tips the top away.
    tilt = -(math.radians(90) - lean)

    # Real A4, 210 × 297 mm. The room is metric and to scale everywhere else,
    # and a CV that is not the size of a CV is the kind of thing nobody can name
    # but everybody notices.
    page_w, page_h = 0.21, 0.297
    # The right-hand end of the desk, in front of the lamp. Chosen by measuring
    # the free space rather than by eye: at this footprint the desk has no gap
    # at all until the notebook moves left, and the first version of this stood
    # inside the lamp — the two bounding boxes overlapped by 24 cm and nothing
    # said so, because nothing was checking. `check_clearance` in the export now
    # does. Everything below is expressed relative to this point so the whole
    # holder moves together.
    cx, cy, cz = 0.92, DESK_FRONT - 0.15, DESK_TOP + 0.156

    holder = material("cv_holder", "dark_metal", roughness=0.38, metallic=1.0, grain="brushed")
    board = material("cv_board", "chair_dark", roughness=0.5)

    # The unit normal the page faces, used to seat everything behind it without
    # a second set of hand-worked coordinates that would drift from the lean.
    ny, nz = math.cos(lean), math.sin(lean)

    face = plane("ix_cv_face", (page_w, page_h), (cx, cy, cz),
                 material("cv_paper", "paper", roughness=0.9, grain="paper"),
                 rotation=(tilt, 0, 0))

    # The board takes `lean`, not `tilt`. A plane is born flat and has to be
    # stood up before it is leaned; a box is born standing and only needs the
    # lean. Giving the box the plane's angle laid it down on the desk behind the
    # page — 29 cm deep and 11 cm tall instead of the other way round — which
    # from the front looked like a slightly odd base rather than like a mistake.
    backing = cube("cv_backing", (page_w + 0.028, 0.008, page_h + 0.024),
                   (cx, cy - ny * 0.007, cz - nz * 0.007), board, bevel=0.003)
    backing.rotation_euler = (lean, 0, 0)

    parts = [
        backing,
        # The ledge the page stands on. No base plate under the whole thing: the
        # board's own foot reaches the desk, and a tray beneath it would have to
        # be thinner than the board's bevel to avoid intersecting it.
        cube("cv_lip", (page_w + 0.034, 0.016, 0.026), (cx, cy + 0.062, 0.8035), holder, bevel=0.004),
        strut("cv_strut", (cx, cy - 0.055, 0.98), (cx, cy - 0.145, 0.80), 0.008, holder),
        # A foot on the back leg, so it stands on something rather than ending
        # in a cut cylinder resting on its rim.
        cylinder("cv_foot", 0.018, 0.008, (cx, cy - 0.145, 0.7945), holder, vertices=12),
    ]

    return [join("ix_cv", parts), face]


def build_lamp() -> list[bpy.types.Object]:
    metal = material("lamp_metal", "metal", roughness=0.3, metallic=1.0)
    bulb_mat = material("bulb", "warm", roughness=0.4, emission=6.0)

    # Every joint is a point, and every tube spans two of them, so the parts
    # cannot fail to meet. The previous lamp placed each piece by its centre
    # with an angle chosen by eye, and its three parts sat at three different
    # depths — post at y = -2.06, arm at -2.02, shade at -2.00 — so the arm
    # grew out of nothing and stopped short of what it was holding.
    # The desk's back-right corner, leaning out over it. The lamp used to stand
    # at the left end, which is where the laptop now lives — and the
    # establishing camera looks along +X, so the open lid stood squarely
    # between the viewer and the lamp. Nothing was wrong with the lamp; it was
    # simply never visible.
    # Anchored to the desk rather than to absolute coordinates, so it follows
    # when the desk is resized. `check_furniture` is what confirms the shade
    # still clears the window frame after a move like that.
    foot = (1.00, DESK_BACK + 0.08, DESK_TOP)
    elbow = (1.00, DESK_BACK + 0.08, 1.30)
    head = (0.80, DESK_BACK + 0.28, 1.16)

    parts = [
        cylinder("lamp_base", 0.095, 0.02, (foot[0], foot[1], foot[2] + 0.01), metal),
        strut("lamp_post", (foot[0], foot[1], foot[2] + 0.01), elbow, 0.013, metal),
        strut("lamp_arm", elbow, head, 0.011, metal),
        cylinder("lamp_elbow", 0.02, 0.03, elbow, metal, vertices=12),
        # The switch, on the base where the hand actually finds one. The room
        # treats this lamp as a working control — the overlay has a button for
        # it and clicking the fixture toggles it — and a lamp with no switch
        # anywhere on it is a lamp that cannot be doing what the site says
        # it does.
        cylinder("lamp_switch", 0.011, 0.014,
                 (foot[0] - 0.045, foot[1] + 0.055, foot[2] + 0.024),
                 material("lamp_switch", "dark_metal", roughness=0.45), vertices=10),
    ]

    # The shade hangs off the head, opening down at the desk. A cone's wide end
    # is at its -Z, so aiming its axis straight down puts the opening beneath
    # the bulb where the light is wanted.
    #
    # The axis leans the way the arm already leans: -X toward the desk centre
    # and +Y away from the wall, which is where the mug and the headphones are
    # and where every light aimed at this shade throws its pool. It used to be
    # aim((-0.3, -0.42, 1.0)), which tips the *opening* toward +X — the head
    # visibly faced the window while its pool sat on the other side of the
    # lamp, and no light tuning could reconcile them because the disagreement
    # was between two pieces of geometry.
    # `end_fill_type="NOTHING"`, and this is the whole lamp.
    #
    # `primitive_cone_add` caps both ends by default, which makes a shade that
    # is a closed metal vessel with the bulb sealed inside it. That is not a
    # subtle inaccuracy — it is the difference between a lamp and a paperweight,
    # and it is why this room has never had a warm pool on the desk no matter
    # what the light was set to. A shade is open at the wide end. That opening
    # is the entire function of the object.
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.105, radius2=0.032, depth=0.15, end_fill_type="NOTHING",
        location=(head[0], head[1], head[2] - 0.05),
    )
    shade_obj = bpy.context.object
    shade_obj.name = "lamp_shade"
    shade_obj.data.name = "lamp_shade"
    shade_obj.rotation_euler = aim((0.3, -0.42, 1.0))
    shade(shade_obj, metal)
    parts.append(shade_obj)

    bulb = cylinder("lamp_bulb", 0.03, 0.03, (head[0] - 0.012, head[1] + 0.016, head[2] - 0.042), bulb_mat, vertices=12)

    # The lit inside of the shade, and the reason the lamp reads as switched on.
    #
    # The shade is opaque metal and the bulb is up inside it, so from anywhere
    # in the room the lamp was a grey cone with a bright patch of desk beneath
    # it and no visible connection between the two. What sells a task lamp is
    # the glowing mouth — the cone's open end is the brightest thing on it, and
    # it is the part every camera can see.
    #
    # A disc across the opening rather than a brighter bulb: the bulb is
    # occluded by the shade from every angle that matters, so turning it up lit
    # nothing except the desk.
    mouth = cylinder(
        "lamp_mouth",
        0.098,
        0.004,
        (head[0], head[1], head[2] - 0.05),
        material("lamp_mouth", "warm", roughness=0.55, emission=2.5),
        vertices=24,
    )
    mouth.rotation_euler = aim((0.3, -0.42, 1.0))
    # Down inside the cone's wide end, not flush with it — a shade seen from
    # below shows a ring of metal around the light, not a flat glowing lid.
    # On the shade's own axis: shade centre plus 0.055 along the opening
    # direction. It used to sit on the *opposite* side of that axis, poking out
    # through the metal, so the glowing disc read as a head facing one way
    # while the shade faced the other.
    mouth.location = (head[0] - 0.015, head[1] + 0.021, head[2] - 0.099)
    # And it must not block the lamp, which for two builds it did completely.
    #
    # This disc spans the full opening of the shade and sits *below* the point
    # light inside it, so as an opaque object it was a lid: every photon the
    # lamp emitted hit it and stopped. The desk had no warm pool, the room came
    # out one flat blue, and raising the lamp from 190 W to 450 W changed
    # nothing at all — which is the tell, because a light whose output does not
    # respond to its own power is not dim, it is enclosed.
    #
    # It is an aperture, not a surface. What it represents is the light leaving,
    # so light passing through it is the entire point.
    mouth.visible_shadow = False

    # There is no beam cone any more, and it went through three sizes on the
    # way out. It was a translucent emissive standing in for light scattering
    # in the air — and against geometry that fake has a failure real scattering
    # cannot have: wherever the cone's surface crossed a prop or the desk, the
    # renderer drew a bright line along the intersection. Shrinking it moved
    # the artefact; only removing it ends it. The runtime spot plus bloom does
    # the glow honestly, and the bake gets its atmosphere from Cycles.

    # The *fixture* is what answers to a click, not the bulb.
    #
    # `ix_lamp` used to be the 3 cm bulb up inside the shade, which is exactly
    # where a bulb belongs and exactly where nothing can be clicked: the new
    # occlusion check measured it at 100% hidden from the home camera. The
    # overlay's "Desk lamp" button still worked, so the fault only showed up as
    # the one object in the room you could not click on in the room.
    return [join("ix_lamp", parts), bulb, mouth]


# How a book is built, and why a box is not one.
#
# `square` is the overhang of the covers past the page block at the head, tail
# and fore-edge; `cover` is the board thickness at each side. Both are real
# millimetre figures off a hardback, and together they are most of what a
# bookshelf looks like: a row of coloured spines with a cream stripe of paper
# recessed behind each one. Solid boxes give a row of coloured rectangles, which
# is what a shelf of books looks like to somebody who has not looked at one.
BOOK_SQUARE = 0.004
BOOK_COVER = 0.0025


def book_pages(name: str, size: tuple[float, float, float], location: tuple[float, float, float]):
    """The page block for a book whose covers occupy `size` at `location`."""
    depth, width, height = size
    x, y, z = location
    # Inset on all four sides, and the spine side matters most.
    #
    # A first attempt made the page block flush with the spine, on the reasoning
    # that pages meet the spine — they do, but the *cover board* is between them
    # and the outside. Flush put two faces in exactly the same plane, and a
    # shelf of z-fighting books renders as a shelf of black rectangles with
    # coloured edges.
    #
    # So: back off the spine by a board thickness, and off the head, tail and
    # fore-edge by the square.
    return cube(
        name,
        (
            depth - BOOK_SQUARE - BOOK_COVER,
            max(width - 2 * BOOK_COVER, 0.004),
            height - 2 * BOOK_SQUARE,
        ),
        (x + (BOOK_SQUARE - BOOK_COVER) / 2, y, z),
        material("book_pages", "pages", roughness=0.92, grain="paper"),
        bevel=0.0008,
    )


def build_shelf_and_books() -> list[bpy.types.Object]:
    """The bookshelf on the left wall. Each book is a project."""
    wood = material("shelf_wood", "desk", roughness=0.6, grain="wood")
    # The sides run past the top row of books to a capping board, so the case
    # has a real top surface. Without it the sides stopped level with the books
    # and anything "put on top" was standing inside them.
    parts = [
        cube("shelf_side_l", (0.05, 0.3, 2.2), (-3.05, 0.05, 1.1), wood),
        cube("shelf_side_r", (0.05, 0.3, 2.2), (-3.05, 1.85, 1.1), wood),
        cube("shelf_top", (0.3, 1.9, 0.04), (-3.05, 0.95, 2.16), wood),
    ]
    for i in range(4):
        parts.append(cube(f"shelf_{i}", (0.28, 1.85, 0.04), (-3.05, 0.95, 0.3 + i * 0.5), wood))
    shelf = join("bookshelf", parts)

    books = []
    spines = []
    # Stepped by a stride coprime with the count, so the run visits all eight
    # before repeating and no two neighbours match.
    colours = ["book_a", "book_b", "book_c", "book_d", "book_e", "book_f", "book_g", "book_h"]
    # Per-colour finish. Every cover at 0.8 gave the whole shelf one chalky
    # matte, and a row of identical highlights is half of why a shelf reads
    # as extruded blocks: real shelves mix laminated jackets, cloth boards and
    # matte paperbacks, and the difference is visible entirely as sheen.
    # Cloth is matte; leather is the only thing on an old shelf with a real
    # sheen. b, d and f are the leather bindings.
    sheen = {
        "book_a": 0.85, "book_b": 0.66, "book_c": 0.86, "book_d": 0.60,
        "book_e": 0.82, "book_f": 0.64, "book_g": 0.88, "book_h": 0.80,
    }

    # Level 2 sits at eye height, so that shelf carries the project books: one
    # per project, each with its own spine quad the runtime paints the title
    # onto. A quad per book rather than one texture stretched across the row —
    # the books are separate solids with separate UVs, so a shared image would
    # tile across every one of them instead of spanning them.
    TITLED_LEVEL = 2
    TITLED_COUNT = 6
    TITLED_WIDTH = 0.075

    for level in range(4):
        if level == TITLED_LEVEL:
            y = 0.2
            for index in range(TITLED_COUNT):
                h = 0.27 + (index % 3) * 0.014
                z = 0.32 + level * 0.5 + h / 2
                zc = 0.32 + level * 0.5
                yc = y + TITLED_WIDTH / 2
                colour = colours[index % 4]
                cover_mat = material(f"book_{colour}_case", colour, roughness=0.86, grain="fabric")
                pages_mat = material("book_pages", "pages", roughness=0.92, grain="paper")
                # Boards, pages and a flat spine slab — the same construction
                # as the rest of the shelf, minus the round: these carry the
                # painted project titles, and a flat quad cannot lie on a
                # barrel. That is not a cheat; it is what a modern cased
                # hardcover looks like. What made them read as boxes was the
                # solid cube: no page block above, no board lip, one face of
                # colour wrapped around all six sides.
                pieces = [
                    cube(
                        f"book_titled_pages_{index}",
                        (0.194, TITLED_WIDTH - 0.005, h - 0.005),
                        (-3.051, yc, zc + (h - 0.005) / 2 + 0.001),
                        pages_mat,
                        bevel=0.0008,
                    ),
                    cube(
                        f"book_titled_spine_{index}",
                        (0.008, TITLED_WIDTH, h),
                        (-2.954, yc, zc + h / 2),
                        cover_mat,
                        bevel=0.001,
                    ),
                ]
                for board_side in (-1, 1):
                    pieces.append(
                        cube(
                            f"book_titled_board_{index}_{board_side}",
                            (0.197, 0.003, h),
                            (-3.0515, yc + board_side * (TITLED_WIDTH - 0.003) / 2, zc + h / 2),
                            cover_mat,
                            bevel=0.0006,
                        )
                    )
                books.append(join(f"book_titled_{index}", pieces))
                # Proud of the spine face by 3mm so it never z-fights the book.
                spines.append(
                    plane(
                        f"ix_book_spine_{index}",
                        (TITLED_WIDTH * 0.86, h * 0.9),
                        (-2.947, yc, z),
                        material(f"spine_{index}", colour, roughness=0.88),
                        rotation=(math.radians(90), 0, math.radians(90)),
                    )
                )
                # A ribbon marker in two of the project books: emerging from
                # the page block at the head and lying a short way down the
                # spine. It was 5 cm of flat maroon slab pasted across the
                # painted title, and it read as a browser rendering glitch
                # rather than as silk.
                if index in (1, 4):
                    books.append(
                        cube(
                            f"bookmark_{index}",
                            (0.0018, 0.008, 0.032),
                            (-2.9455, yc + TITLED_WIDTH * 0.22, zc + h - 0.020),
                            material("bookmark", "red", roughness=0.55),
                            bevel=0,
                        )
                    )
                y += TITLED_WIDTH + 0.008
            continue

        # No shelf on earth is a row of identical books at even spacing, and
        # even spacing is the single strongest sign of a generated one. Four
        # things break it up, all deterministic so the room rebuilds the same
        # way every time:
        #
        #   · gaps vary rather than sitting at a constant 6 mm
        #   · depth varies, so the fronts do not form a flat plane
        #   · a book here and there leans, and the next one leans against it
        #   · one is pulled half out, because somebody was reading it
        y = 0.18
        slot = 0
        while y < 1.62:
            noise = hash((level, slot))
            h = 0.24 + (noise % 5) * 0.012
            w = 0.036 + ((noise >> 3) % 4) * 0.008
            depth = 0.18 + ((noise >> 6) % 5) * 0.012
            colour = colours[(level * 5 + slot * 3) % len(colours)]

            # Books are pushed to the back of a shelf, so their spines line up
            # at the front and the variation shows there.
            back = -3.15
            x = back + depth / 2
            # One book on the room's eye-level shelf is half out. Exactly one:
            # a tidy shelf reads as staged and a chaotic one reads as
            # art-directed, but one thing out of place reads as real.
            if level == 1 and slot == 4:
                x += 0.055

            lean = 0.0
            if (noise >> 9) % 7 == 0 and y + w < 1.5:
                # Degrees, alternating direction so a pair leans together the
                # way books do when the row is not full.
                lean = math.radians(5.5 if (noise >> 12) % 2 else -4.5)

            zc = 0.32 + level * 0.5
            cover_mat = material(f"book_{colour}", colour, roughness=sheen[colour], grain="fabric")
            pages_mat = material("book_pages", "pages", roughness=0.92, grain="paper")

            # Boards, pages, round — not a painted block. The old book was a
            # solid cube with a page block modelled *inside* it, which is why
            # no shelf ever showed a sheet of paper: the pages were built,
            # joined and exported into a volume no camera can see. The
            # reference photographs are mostly pages — the warm tan block
            # sitting a lip below the boards is half of what "old book" means
            # — so the book is now assembled the way a binder assembles one:
            # two cloth boards standing 3 mm proud, the page block exposed
            # between them, and the spine rolled round across the front.
            pieces = [
                cube(
                    f"book_pages_{level}_{slot}",
                    (depth - 0.006, max(w - 0.005, 0.004), h - 0.005),
                    (x - 0.001, y, zc + (h - 0.005) / 2 + 0.001),
                    pages_mat,
                    bevel=0.0008,
                ),
            ]
            for board_side in (-1, 1):
                pieces.append(
                    cube(
                        f"book_board_{level}_{slot}_{board_side}",
                        (depth - 0.003, 0.003, h),
                        (x - 0.0015, y + board_side * (w - 0.003) / 2, zc + h / 2),
                        cover_mat,
                        bevel=0.0006,
                    )
                )

            # The rounded spine, which is the single strongest cue in the
            # reference photographs: an old book's spine is a convex barrel,
            # not a plane, and one highlight rolling across that curve does
            # more than any amount of colour work. A vertical cylinder of the
            # book's own width, sunk into the cover so only ~6 mm of crest
            # stands past the boards.
            pieces.append(
                cylinder(
                    f"book_round_{level}_{slot}",
                    w / 2 - 0.0005,
                    h * 0.985,
                    (back + depth - w / 2 + 0.006, y, zc + h / 2),
                    cover_mat,
                    vertices=12,
                )
            )

            # Raised bands across the spine of roughly every third book — the
            # sewn cords a leather binding shows. Only some: a shelf where
            # every book is bound the same way is a shelf bought by the metre.
            if (noise >> 4) % 3 == 0:
                for band_i in range(3):
                    pieces.append(
                        cube(
                            f"book_ridge_{level}_{slot}_{band_i}",
                            (0.005, max(w * 0.8, 0.004), 0.005),
                            (back + depth + 0.007, y,
                             zc + h * (0.30 + band_i * 0.22)),
                            cover_mat,
                            bevel=0,
                        )
                    )

            # A headband: the dark stitched cap at the top of the spine. On
            # the crest of the round, where the reference books show it.
            pieces.append(
                cube(
                    f"book_band_{level}_{slot}",
                    (0.008, max(w * 0.86, 0.004), 0.0065),
                    (back + depth + 0.003, y, zc + h - 0.009),
                    material("book_band", "bezel", roughness=0.72),
                    bevel=0,
                )
            )
            book = join(f"book_{level}_{slot}", pieces)
            if lean:
                # Pivot about the foot, not the middle. A box rotated about its
                # own centre drives its bottom corner through the shelf, and at
                # five degrees that is a couple of millimetres — small enough to
                # look like a rendering error rather than a modelling one.
                set_origin(book, (x, y, 0.32 + level * 0.5))
                book.rotation_euler = (lean, 0, 0)
            books.append(book)

            y += w + 0.004 + ((noise >> 15) % 4) * 0.004
            slot += 1

        # A short stack lying flat on top of the upright row, which is where
        # books go when the shelf is full and nobody wants to reshuffle it.
        if level in (0, 2):
            stack_y = 1.30 if level == 0 else 1.24
            for tier in range(2 if level == 0 else 3):
                thickness = 0.030 + (tier % 2) * 0.008
                flat_c = colours[(level + tier) % len(colours)]
                flat_mat = material(f"book_{flat_c}", flat_c, roughness=sheen[flat_c], grain="fabric")
                flat_z = 0.34 + level * 0.5 + 0.30 + tier * 0.036
                turn = math.radians(2.4 - tier * 1.9)
                # A lying book is two boards with the page block showing all
                # round its rim — in the reference stack the pages are the
                # most visible surface there is. A solid coloured slab hides
                # exactly that.
                flat = [
                    cube(f"book_flat_pages_{level}_{tier}", (0.183, 0.252, thickness - 0.005),
                         (-3.055 + tier * 0.004, stack_y, flat_z),
                         material("book_pages", "pages", roughness=0.92, grain="paper"),
                         rotation_z=turn, bevel=0.0008),
                    cube(f"book_flat_top_{level}_{tier}", (0.19, 0.26, 0.003),
                         (-3.055 + tier * 0.004, stack_y, flat_z + (thickness - 0.003) / 2),
                         flat_mat, rotation_z=turn, bevel=0.0006),
                    cube(f"book_flat_bot_{level}_{tier}", (0.19, 0.26, 0.003),
                         (-3.055 + tier * 0.004, stack_y, flat_z - (thickness - 0.003) / 2),
                         flat_mat, rotation_z=turn, bevel=0.0006),
                    # The spine wraps the edge facing the room; the other
                    # three edges stay paper.
                    cube(f"book_flat_spine_{level}_{tier}", (0.008, 0.26, thickness),
                         (-3.055 + tier * 0.004 + 0.091, stack_y, flat_z),
                         flat_mat, rotation_z=turn, bevel=0.001),
                ]
                books.append(join(f"book_flat_{level}_{tier}", flat))

    return [shelf, join("ix_bookshelf", books)] + spines


def build_whiteboard() -> list[bpy.types.Object]:
    board = cube("board_face", (0.04, 1.5, 1.05), (-3.12, -1.35, 1.72), material("board", "board", roughness=0.35))
    frame = cube("board_frame", (0.05, 1.6, 1.15), (-3.14, -1.35, 1.72), material("board_frame", "metal", roughness=0.34, metallic=1.0, grain="brushed"))

    # The writing surface is its own quad named `ix_whiteboard_face`, so the
    # runtime can paint a real drawn diagram onto it. The previous version was
    # six grey boxes standing in for one — an unlabelled rectangle is not a
    # diagram, it is a note saying a diagram goes here.
    face = plane(
        "ix_whiteboard_face",
        (1.42, 0.98),
        (-3.088, -1.35, 1.72),
        material("board_face_mat", "board", roughness=0.4),
        rotation=(math.radians(90), 0, math.radians(90)),
    )

    # Sticky notes, likewise one quad rather than six coloured chips.
    return [join("ix_whiteboard", [board, frame]), face, build_sticky_notes()]


def build_sticky_notes() -> bpy.types.Object:
    """
    Six notes around the whiteboard, scattered the way notes actually end up.

    This was one flat 86 x 42 cm quad with all six painted onto it, tilt
    included. Three things were wrong with that and only one of them was the
    flatness.

    **They were flat.** Only the top strip of a sticky note is adhesive, so the
    bottom lifts away and catches light under its own edge. A note lying flat
    against the wall is the clearest possible sign it was drawn rather than
    stuck.

    **They were a grid.** Three by two at even spacing, all in a block under the
    board. Nobody has ever stuck notes up like that. Real ones go up one at a
    time as the thought arrives, so they cluster in twos and threes, sit at
    different heights, and leave gaps — and one always ends up off on its own.

    **They were one colour.** Six different pads in the canvas, one shared
    material in the model, so every render outside the browser showed a block of
    identical yellow squares.

    Placed by hand below. Six positions are few enough that authoring them is
    honest and a generator would only be a way of pretending the arrangement was
    not a decision.
    """
    # Proud of `ix_whiteboard_face`, which sits at x = -3.088.
    board_x = -3.079
    size = 0.116
    lift = 0.014
    span = 5

    # (y, z, tilt in degrees, canvas cell, colour).
    #
    # On the board, not on the wall beside it. Sticky notes go on things — a
    # board, a bezel, a monitor's edge — because that is what the adhesive strip
    # is for and because a note on bare plaster has nothing to do with anything
    # around it. They used to sit in a block below the board, which read as a
    # decal applied to the wall rather than as paper someone put there.
    #
    # The board face runs y -2.10..-0.60 and z 1.195..2.245. These sit across
    # its lower left, where the drawn diagram has its margin, so they overlap
    # the bullets a little — which is exactly what happens to a whiteboard
    # somebody actually uses.
    #
    # Two clusters and a stray: three crowded together, two paired further
    # along, and one on its own out to the right, put up at a different time
    # from the rest.
    placements = (
        (-1.97, 1.42, -5.5, 0, "note_yellow"),
        (-1.83, 1.31, 3.8, 1, "note_mint"),
        (-1.90, 1.58, 1.6, 2, "note_blue"),
        (-1.52, 1.36, -2.4, 3, "note_pink"),
        (-1.40, 1.26, 4.6, 4, "note_violet"),
        (-0.92, 1.53, -3.2, 5, "note_peach"),
    )

    columns, rows = 3, 2
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for centre_y, centre_z, degrees, _cell, _colour in placements:
        tilt = math.radians(degrees)
        base = len(verts)
        for r in range(span):
            # v runs 0 at the top edge, which is the adhesive one, to 1 at the
            # free bottom edge.
            v = r / (span - 1)
            for c in range(span):
                u = c / (span - 1)
                local_y = (u - 0.5) * size
                local_z = (0.5 - v) * size
                spun_y = local_y * math.cos(tilt) - local_z * math.sin(tilt)
                spun_z = local_y * math.sin(tilt) + local_z * math.cos(tilt)
                # Squared, so the top two thirds stay flat against the wall and
                # the last third does the curling — which is what a strip of
                # adhesive across the top actually produces. Corners lift a
                # little further than the middle of the edge.
                corner = 1.0 + 0.35 * abs(u - 0.5) * 2.0
                verts.append(
                    (
                        board_x + lift * (v**2) * corner,
                        centre_y + spun_y,
                        centre_z + spun_z,
                    )
                )
        for r in range(span - 1):
            for c in range(span - 1):
                a = base + r * span + c
                # Wound so the normal comes out along +x, into the room.
                #
                # It was the other way round, and the notes have therefore never
                # once been drawn: their faces pointed into the wall, so every
                # camera in the room saw only their back, and a back face is
                # culled. Nothing reported it — the objects existed, they were
                # visible, they had materials and correct UVs, they were in the
                # GLB, they were in the atlas, and `check_painted_uvs` measured
                # their UV directions happily against a face nobody could see.
                # They were also, on this evidence, being asked about repeatedly
                # and answered for three times.
                faces.append((a, a + span, a + span + 1, a + 1))

    notes = poly("ix_sticky_notes", verts, faces, (0, 0, 0),
                 material("note_yellow", "note_yellow", roughness=0.85))

    # One material slot per note, so each is its own colour. glTF splits the
    # object into a primitive per material — all still named `ix_sticky_notes`,
    # which is what the runtime looks up, and each keeps its own UVs, so the
    # canvas still lands on the right cells.
    for _, _, _, _, colour in placements[1:]:
        notes.data.materials.append(material(colour, colour, roughness=0.85))

    per_note = (span - 1) * (span - 1)
    for polygon in notes.data.polygons:
        polygon.material_index = polygon.index // per_note

    # UVs by hand: each note addresses its own cell of the shared canvas.
    # `PAINTED` keeps the unwrap from touching these, so they survive to the GLB.
    layer = notes.data.uv_layers.new(name="UVMap")
    for polygon in notes.data.polygons:
        index = polygon.index // per_note
        cell = placements[index][3]
        column, row = cell % columns, cell // columns
        for loop in polygon.loop_indices:
            local = notes.data.loops[loop].vertex_index - index * span * span
            u = (local % span) / (span - 1)
            # `1 -`, because the vertex grid runs top-to-bottom and UV space
            # runs bottom-to-top. The grid is built with `local_z = (0.5 - v)`,
            # so row 0 is the note's *top* edge — and mapping that to V=0 puts
            # the top of the note at the bottom of its cell, printing every note
            # upside down. The whiteboard behind them is an ordinary quad whose
            # UVs come out the right way round, which is why it reads correctly
            # while the notes stuck to it do not.
            v = 1.0 - (local // span) / (span - 1)
            layer.data[loop].uv = ((column + u) / columns, (row + v) / rows)
    return notes

def build_server_rack() -> list[bpy.types.Object]:
    """
    The rack, in the back-right corner and clear of the window.

    It used to stand at x 2.37..2.87 and 1.2 m tall, which put its top 15 cm
    straight through the window frame — the sill starts at 1.05 — and stood it
    directly in front of the radiator, so the one detail that says the room is
    heated was hidden behind a box. Neither reads as a mistake from the
    establishing shot; a solid ends where another begins and the eye takes it
    for contact.

    Two changes fix both. It moves right, into the corner, which opens a gap
    beside the radiator so the two read as separate objects. And it loses 22 cm,
    which is what actually clears the sill — a short rack under a window is the
    normal way to fit one there anyway.
    """
    case = material("rack", "plastic", roughness=0.44, grain="brushed")
    rx, ry = 2.88, -2.14
    height = 0.98
    parts = [cube("rack_body", (0.5, 0.62, height), (rx, ry, height / 2), case)]
    leds = []
    front = ry + 0.31
    for i in range(5):
        z = 0.16 + i * 0.17
        colour = "green" if i % 3 else "cyan"
        parts.append(cube(f"unit_{i}", (0.48, 0.02, 0.15), (rx, front, z), material("unit", "dark_metal", roughness=0.5)))
        leds.append(
            cube(
                f"led_{i}",
                (0.05, 0.012, 0.018),
                (rx - 0.17, front + 0.01, z),
                material(f"led_{colour}", colour, roughness=0.3, emission=5.0),
                bevel=0,
            )
        )
    return [join("ix_server_rack", parts + leds)]


def build_window() -> list[bpy.types.Object]:
    """
    The window onto Toronto. The view itself is `build_toronto` — a separate
    object, so the runtime can cross-fade it between times of day.
    """
    frame_mat = material("win_frame", "paper", roughness=0.5)
    parts = [
        cube("win_top", (1.5, 0.1, 0.09), (2.05, -2.53, 2.3), frame_mat),
        cube("win_bottom", (1.5, 0.1, 0.09), (2.05, -2.53, 1.1), frame_mat),
        cube("win_left", (0.09, 0.1, 1.3), (1.35, -2.53, 1.7), frame_mat),
        cube("win_right", (0.09, 0.1, 1.3), (2.75, -2.53, 1.7), frame_mat),
        cube("win_mullion", (0.03, 0.06, 1.25), (2.05, -2.53, 1.7), frame_mat),
    ]
    parts.append(cube("win_sill", (1.6, 0.22, 0.06), (2.05, -2.46, 1.08), frame_mat))

    # Glass, on the second attempt — the first pane was removed with a note
    # explaining why: as a mirror it reflected the room back as a solid blue
    # panel, and as a low-alpha sheet it washed the skyline pale, because
    # normal alpha blending scales the *reflections* down with the same factor
    # that lets the background through. Transmission glass unties those two:
    # the skyline passes through at full strength while the fresnel
    # reflections of the room stay whole, brightening toward grazing angles
    # the way a night window actually does. The lacquer grain puts smudge into
    # the roughness, so the reflections streak instead of mirroring cleanly.
    glass_mat = material("window_glass", "paper", roughness=0.04, grain="lacquer")
    glass_bsdf = glass_mat.node_tree.nodes["Principled BSDF"]
    glass_bsdf.inputs["Transmission Weight"].default_value = 1.0
    glass_bsdf.inputs["IOR"].default_value = 1.45
    for pane_name, pane_x, pane_w in (("win_glass_l", 1.71, 0.63), ("win_glass_r", 2.39, 0.63)):
        pane = cube(pane_name, (pane_w, 0.006, 1.12), (pane_x, -2.51, 1.7), glass_mat, bevel=0)
        # The light through the window must not be stopped by its own glass:
        # Cycles would attenuate the city glow and the runtime would darken
        # the sill for nothing.
        pane.visible_shadow = False
        parts.append(pane)
    return [join("window_frame", parts)]


def build_curtains() -> list[bpy.types.Object]:
    """
    Two sheer panels on a rail, drawn to the window's sides.

    The wind system finally gets its witness at the window: dust drifts and
    leaves sway, but nothing at the opening explained the draught. The drape
    is procedural rather than cloth-simulated — layered folds whose amplitude
    grows toward the free hem, with the hem kicked a few centimetres into the
    room the way a curtain by a cracked window hangs. A headless cloth sim
    would buy marginally better folds at the cost of a nondeterministic build
    and collision tuning nobody can watch; the runtime supplies the motion by
    bending the mesh in the vertex shader, pinned at the rail exactly as a
    sim would pin it.

    Gathered to the sides on purpose: the window exists to show the skyline,
    and a panel across the glass would spend the best surface in the room on
    a rectangle of gauze.
    """
    rail_mat = material("curtain_rail", "dark_metal", roughness=0.4, metallic=1.0, grain="brushed")
    sheer = material("curtain", "paper", roughness=0.92, grain="fabric")
    sheer_bsdf = sheer.node_tree.nodes["Principled BSDF"]
    sheer_bsdf.inputs["Alpha"].default_value = 0.34
    sheer.blend_method = "BLEND"

    out = [
        cylinder("curtain_rail", 0.012, 1.64, (2.05, -2.395, 2.38), rail_mat,
                 vertices=12, rotation=(0, math.radians(90), 0)),
        cylinder("rail_finial_l", 0.022, 0.03, (1.22, -2.395, 2.38), rail_mat,
                 vertices=10, rotation=(0, math.radians(90), 0)),
        cylinder("rail_finial_r", 0.022, 0.03, (2.88, -2.395, 2.38), rail_mat,
                 vertices=10, rotation=(0, math.radians(90), 0)),
    ]
    for bracket_x in (1.35, 2.75):
        out.append(cube(f"rail_bracket_{bracket_x}", (0.02, 0.05, 0.016),
                        (bracket_x, -2.42, 2.39), rail_mat, bevel=0.002))

    drop = 1.34
    for name, cx, phase in (("curtain_l", 1.50, 0.0), ("curtain_r", 2.60, 2.2)):
        verts: list[tuple[float, float, float]] = []
        nx, nz = 21, 11
        width = 0.46
        for iz in range(nz):
            t = iz / (nz - 1)  # 0 at the rail, 1 at the hem.
            for ix in range(nx):
                u = ix / (nx - 1) - 0.5
                x = u * width
                # Folds: two incommensurate frequencies plus a slow drift, all
                # scaled up toward the hem — gathered fabric hangs nearly flat
                # at its rings and deepens as it falls.
                fold = (
                    math.sin(u * 19.0 + phase) * 0.020
                    + math.sin(u * 8.3 + phase * 2.0 + t * 1.5) * 0.014
                    + math.sin(u * 33.0 + t * 4.0 + phase) * 0.006
                ) * (0.25 + 0.75 * t)
                # The hem drifts into the room: the window is ajar and the
                # sheer spends its life leaning away from it.
                sweep = t * t * 0.055
                verts.append((x, fold + sweep, -t * drop))
        faces = [
            (iz * nx + ix, iz * nx + ix + 1, (iz + 1) * nx + ix + 1, (iz + 1) * nx + ix)
            for iz in range(nz - 1)
            for ix in range(nx - 1)
        ]
        # Origin at the rail, so the runtime's pinned-top bend has its pivot
        # where the rings are.
        panel = poly(name, verts, faces, (cx, -2.40, 2.36), sheer)
        out.append(panel)
    return out


def build_certificates() -> list[bpy.types.Object]:
    """
    Three framed awards, each with its own face for the runtime to print on.

    The papers used to be joined into the frames as one `ix_certificates` mesh,
    which made them unpaintable — so the room hung three blank coloured
    rectangles on the wall where the awards should be. They were modelled, lit
    and baked, and said nothing.

    Frames stay joined, because they are furniture. Each paper is now its own
    quad named `ix_certificates_N`, which keeps two things working at once: the
    runtime strips the `_N` to find `certificates` in the registry, so clicking
    any of the three still opens the panel, and `Screens.tsx` reads the index
    off the same name to print the right award on the right frame.
    """
    frame_mat = material("cert_frame", "dark_metal", roughness=0.4, metallic=1.0)
    mat_mat = material("cert_paper", "paper", roughness=0.8)
    frames = []
    faces = []
    # Above the monitors, which top out at z = 1.52, and right along the wall
    # to clear the doorway.
    for i, (x, z, w, h) in enumerate([(-1.55, 2.02, 0.42, 0.54), (-1.0, 2.17, 0.3, 0.24), (-1.0, 1.85, 0.3, 0.24)]):
        frames.append(cube(f"cert_frame_{i}", (w, 0.04, h), (x, -2.52, z), frame_mat))
        frames.append(cube(f"cert_mount_{i}", (w - 0.06, 0.012, h - 0.06), (x, -2.492, z), mat_mat, bevel=0))
        # The printed face, a shade proud of its mount so it never z-fights.
        faces.append(
            plane(
                f"ix_certificates_{i}",
                (w - 0.075, h - 0.075),
                (x, -2.484, z),
                material(f"cert_face_{i}", "paper", roughness=0.82),
                rotation=(math.radians(90), 0, 0),
            )
        )
    return [join("certificate_frames", frames), *faces]


def build_chair_and_plant() -> list[bpy.types.Object]:
    """
    A task chair with a shaped back, armrests and a five-star castor base.

    The previous version was a box on a stick, which is the single object that
    most gave the room away as placeholder geometry: a chair is the thing in an
    office everyone has looked at closely, so any shortcut in it reads instantly.
    """
    fabric = material("chair_fabric", "chair_dark", roughness=0.92, grain="fabric")
    trim = material("chair_trim", "chair_light", roughness=0.85, grain="fabric")
    metal = material("chair_metal", "metal", roughness=0.35, metallic=1.0, grain="brushed")

    # On the keyboard's centreline, pushed back from the desk edge and turned a
    # little — a chair someone has just got up from. It used to sit 29 cm to the
    # left of the working position for no reason anyone recorded, which put it
    # squarely between the establishing camera and the laptop.
    #
    # Derived from DESK_FRONT rather than written down, because the desk rescale
    # moved that edge back 55 cm and left the chair marooned in open floor — a
    # chair nobody could sit in without standing up first. Anything positioned
    # against the desk has to be expressed in terms of the desk.
    # Tucked in, not adrift. At +0.50 the chair's front edge stood 7 cm clear of
    # the desk with a 20 degree turn on it, which reads as a chair abandoned in
    # the middle of the floor rather than one somebody pushed back and stood up
    # from.
    # +0.40, not +0.46. At +0.46 the chair's back edge landed exactly on the
    # desk's front edge — touching it and tucked under it by nothing at all,
    # which is a chair parked in front of a desk rather than pulled up to one.
    #
    # 0.40 puts 6 cm of seat under the top. 0.30 was tried first and is too far:
    # `check_furniture` measured 16 cm of overlap and `check_swallowed` found
    # the keyboard's wrist rest entirely inside the chair. The armrest pads top
    # out at 0.745 against a 0.75 underside, so they pass beneath with 5 mm to
    # spare either way — it is the seat, not the arms, that sets the limit.
    # Pushed aside, not tucked in, and that is a composition decision as much
    # as a narrative one.
    #
    # A chair squared up to the desk presents its back to the camera as a
    # metre-wide silhouette across the middle of a 2.2 m desk, and everything
    # behind it is simply unreachable — the laptop, the notebook and the pencil
    # were all measured at 87-100% hidden, and no amount of moving them helped
    # because the only clear space left was already full.
    #
    # Off to one side it covers the end of the desk instead of the middle, and
    # it reads as a chair somebody got up from rather than a showroom.
    cx, cy = CHAIR_X + 0.16, DESK_FRONT + 0.94
    parts = []

    # Seat: a control cage dished in the middle and turned up at the sides, then
    # subdivided. The previous seat was a slab with a separate strip stuck on
    # the front for the waterfall edge and two more for the side bolsters, which
    # is four boxes pretending to be one moulded pan. A seat is a single surface
    # that curves in two directions, and that cannot be assembled out of boxes
    # at any level of detail — it has to be one cage.
    # Measured against a real task chair rather than composed by eye. Seat top
    # lands at 52 cm off the floor against a 79 cm desk, and the pan is 51 cm
    # deep — it was 58 cm, which is deeper than any chair made and read as a
    # bench with a back on it.
    seat_rows = (
        # (y offset, z at the centre, z at the edge, half width)
        (-0.26, 0.455, 0.470, 0.225),
        (-0.13, 0.435, 0.475, 0.255),
        (0.01, 0.430, 0.480, 0.262),
        (0.15, 0.440, 0.485, 0.255),
        (0.25, 0.460, 0.490, 0.235),
    )
    columns = (-1.0, -0.55, 0.0, 0.55, 1.0)
    verts: list[tuple[float, float, float]] = []
    for dy, mid_z, edge_z, half in seat_rows:
        for u in columns:
            # Quadratic in |u|, so the pan dishes smoothly rather than kinking.
            verts.append((u * half, dy, mid_z + (edge_z - mid_z) * u * u))
    faces: list[tuple[int, ...]] = []
    stride = len(columns)
    for row in range(len(seat_rows) - 1):
        for col in range(stride - 1):
            a = row * stride + col
            faces.append((a, a + 1, a + stride + 1, a + stride))

    seat = poly("seat_pan", verts, faces, (cx, cy, 0), fabric)
    seat.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.085
    parts.append(smooth(seat, 2, crease=0.2))

    # Backrest: one shell, with the lean built into the cage rather than into
    # four separately rotated boxes. Stacking tilted segments left a visible
    # seam at every joint no matter how far they overlapped, and four hard
    # horizontal lines is exactly how a stack of boxes looks.
    # A racing back: tall, with the shoulder wings a gaming chair is recognised
    # by. The `wrap` column is what makes them — it pulls the outer edge of each
    # row forward, so the shell curls around where a back would sit instead of
    # being a flat panel. It is strongest across the shoulders and eases off at
    # the waist and the top, which is the whole silhouette.
    #
    # The top of the shell is at 1.36 m, not 1.50. A gaming chair's backrest
    # stands about 85 cm above its seat; this one stood 98 cm above it, which
    # put the whole chair at 1.56 m — taller than any chair sold, and tall
    # enough that from the establishing shot it covered three quarters of the
    # laptop behind it. Both problems had the same cause.
    back_rows = (
        # (height, how far back, half width, how far the sides wrap forward)
        (0.50, -0.180, 0.215, 0.014),
        (0.64, -0.200, 0.243, 0.036),
        (0.78, -0.230, 0.255, 0.054),
        (0.91, -0.265, 0.258, 0.062),
        (1.05, -0.300, 0.246, 0.056),
        (1.19, -0.340, 0.218, 0.038),
        (1.29, -0.375, 0.176, 0.020),
        (1.36, -0.400, 0.126, 0.008),
    )
    verts = []
    for z, dy, half, wrap in back_rows:
        for u in columns:
            verts.append((u * half, dy - wrap * (1 - u * u), z))
    faces = []
    for row in range(len(back_rows) - 1):
        for col in range(stride - 1):
            a = row * stride + col
            faces.append((a, a + 1, a + stride + 1, a + stride))

    back = poly("back_shell", verts, faces, (cx, cy, 0), fabric)
    back.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.08
    parts.append(smooth(back, 2, crease=0.15))

    # Headrest and lumbar cushion, each slung on a strap. These are the two
    # details that say "gaming chair" rather than "office chair", and they are
    # also the only places the trim colour appears at any size.
    head = cube("headrest", (0.24, 0.11, 0.13), (cx, cy - 0.345, 1.31), trim, bevel=0)
    head.rotation_euler = (-0.34, 0, 0)
    parts.append(smooth(head, 2, crease=0.35))

    lumbar = cube("lumbar", (0.26, 0.12, 0.15), (cx, cy - 0.155, 0.69), trim, bevel=0)
    lumbar.rotation_euler = (-0.1, 0, 0)
    parts.append(smooth(lumbar, 2, crease=0.3))

    # Stitched piping along the seams between the centre panels and the
    # bolsters. This is the detail that separates upholstery from a moulded
    # shell: a real chair is cut from flat panels and sewn, and the seam stands
    # slightly proud of the surface catching a highlight down its whole length.
    # Without it the seat and back are two smooth blobs no amount of subdivision
    # will make convincing.
    piping = material("chair_piping", "chair_light", roughness=0.7)
    for u in (-0.55, 0.55):
        seam = [
            (cx + u * half, cy + dy - wrap * (1 - u * u) + 0.046, z)
            for z, dy, half, wrap in back_rows
        ]
        parts.append(cable(f"back_seam_{u}", seam, 0.006, piping))

        seam = [
            (cx + u * half, cy + dy, mid_z + (edge_z - mid_z) * u * u + 0.046)
            for dy, mid_z, edge_z, half in seat_rows
        ]
        parts.append(cable(f"seat_seam_{u}", seam, 0.006, piping))

    # Two more channel seams up the middle of the back. One pair of seams
    # divides the shell into three widths of fabric, which no upholsterer
    # would cut; four channels is the standard racing pattern, and the extra
    # pair is most of why the front of the shell reads as sewn panels rather
    # than as one moulded piece.
    for u in (-0.18, 0.18):
        seam = [
            (cx + u * half, cy + dy - wrap * (1 - u * u) + 0.046, z)
            for z, dy, half, wrap in back_rows
        ]
        parts.append(cable(f"back_channel_{u}", seam, 0.005, piping))

    # Trim bead down each outer edge of the shell, where the front fabric and
    # the rear cover meet. The rim is the one line of the chair every view
    # shares — from behind it is the only seam there is — and a bead there
    # catches the LED wash exactly the way the reference chairs' welts do.
    for side in (-1.0, 1.0):
        rim = [(cx + side * half, cy + dy, z) for z, dy, half, wrap in back_rows]
        parts.append(cable(f"back_rim_{side}", rim, 0.007, piping))

    # No separate contrast stripes. The shell's own wings already carry the
    # racing shape, and a rail laid over them read as something bolted on
    # rather than as part of the seat.

    # Armrests: a post rising off the seat frame and a rounded pad. The pads
    # used to be 8 cm wide slabs, which from the side is a blade rather than
    # something you would rest an arm on.
    for side in (-1, 1):
        # Pads at 20 cm above the seat, which is where an armrest goes. They sat
        # at 16 cm, low enough to read as part of the seat rather than as
        # something to rest an arm on.
        post = cube(f"arm_post_{side}", (0.042, 0.05, 0.22), (cx + side * 0.285, cy + 0.02, 0.60), metal)
        post.rotation_euler = (0, side * -0.12, 0)
        parts.append(post)
        pad = cube(f"arm_pad_{side}", (0.105, 0.32, 0.05), (cx + side * 0.3, cy + 0.0, 0.72), fabric, bevel=0)
        parts.append(smooth(pad, 2, crease=0.45))
        # The slide track the pad runs on, and the button that releases it.
        parts.append(
            cube(f"arm_track_{side}", (0.052, 0.20, 0.016), (cx + side * 0.3, cy + 0.0, 0.692),
                 material("arm_track", "dark_metal", roughness=0.4, metallic=1.0), bevel=0.003)
        )
        parts.append(
            cylinder(f"arm_button_{side}", 0.009, 0.012,
                     (cx + side * 0.334, cy - 0.05, 0.688),
                     material("arm_button", "plastic", roughness=0.35), vertices=10,
                     rotation=(0, math.radians(90), 0))
        )

    # The mechanism under the pan. Every chair has one and it is always visible
    # from a low angle — without it the seat floats on the gas lift with a gap
    # underneath, which is the single clearest tell in a modelled chair.
    parts.append(cube("seat_plate", (0.24, 0.30, 0.045), (cx, cy - 0.01, 0.395), metal, bevel=0.008))
    # The recline lever, sticking out under the right of the seat.
    parts.append(
        cylinder("tilt_lever", 0.011, 0.13, (cx + 0.20, cy + 0.05, 0.385), metal, vertices=10,
                 rotation=(0, math.radians(90), math.radians(12)))
    )

    # Gas lift and the five-star base with real castors.
    # A gas lift is two visible sections and a shroud, not one cylinder — the
    # step where the inner tube leaves the outer is what says it telescopes.
    parts.append(cylinder("gas_lift_inner", 0.028, 0.20, (cx, cy, 0.33), metal, vertices=14))
    parts.append(cylinder("gas_lift_outer", 0.038, 0.17, (cx, cy, 0.20), metal, vertices=14))
    parts.append(cylinder("lift_shroud", 0.055, 0.16, (cx, cy, 0.16), material("shroud", "plastic", roughness=0.5), vertices=14))
    castor_mat = material("castor", "plastic", roughness=0.45)
    for i in range(5):
        angle = i / 5 * math.tau
        dx, dy = math.cos(angle), math.sin(angle)
        spoke = cube(f"spoke_{i}", (0.055, 0.3, 0.035), (cx + dx * 0.15, cy + dy * 0.15, 0.075), metal, rotation_z=angle + math.pi / 2)
        parts.append(spoke)
        # A ridge down the spine of each spoke. A flat spoke reads as cardboard;
        # every real base is ribbed, because that is what stops it flexing.
        parts.append(
            cube(f"spoke_rib_{i}", (0.016, 0.27, 0.014), (cx + dx * 0.155, cy + dy * 0.155, 0.094),
                 metal, rotation_z=angle + math.pi / 2, bevel=0.003)
        )
        # A fork and twin wheels, not a single disc on the end of the spoke. A
        # castor is the one part of a chair seen from close to its own height,
        # and a bare cylinder there reads as a peg.
        parts.append(
            cube(f"castor_fork_{i}", (0.035, 0.05, 0.055), (cx + dx * 0.285, cy + dy * 0.285, 0.068),
                 material("castor_fork", "dark_metal", roughness=0.4, metallic=1.0),
                 rotation_z=angle + math.pi / 2, bevel=0.004)
        )
        # The axle the fork carries, visible between the two wheels.
        parts.append(
            cylinder(f"castor_axle_{i}", 0.006, 0.052,
                     (cx + dx * 0.29, cy + dy * 0.29, 0.030),
                     material("castor_axle", "metal", roughness=0.3, metallic=1.0),
                     vertices=8, rotation=(0, math.radians(90), angle))
        )
        for offset in (-0.019, 0.019):
            parts.append(
                cylinder(f"castor_{i}_{offset}", 0.030, 0.014,
                         (cx + dx * 0.29 - dy * offset, cy + dy * 0.29 + dx * offset, 0.030),
                         castor_mat, vertices=14, rotation=(0, math.radians(90), angle))
            )
            # A hub cap in a harder, shinier material than the tyre. The two are
            # never the same plastic on a real castor, and the difference is
            # visible from exactly the height a castor is seen from.
            parts.append(
                cylinder(f"castor_hub_{i}_{offset}", 0.013, 0.017,
                         (cx + dx * 0.29 - dy * offset, cy + dy * 0.29 + dx * offset, 0.030),
                         material("castor_hub", "metal", roughness=0.25, metallic=1.0),
                         vertices=10, rotation=(0, math.radians(90), angle))
            )

    # --- the hardware, and the sewing ------------------------------------
    #
    # Everything to here is the shape of the chair. What follows is what makes
    # it a manufactured object rather than a moulded one: the parts that are
    # assembled, adjusted and stitched. A chair is the thing in an office
    # everybody has looked at closely, so these are the details that are
    # actually checked.

    # Topstitching, running beside the piping.
    #
    # The piping is the cord; the stitching is what holds it on, and they are
    # not the same detail. A seam without stitching reads as a moulded ridge —
    # which is what the previous version had, a continuous cord with nothing
    # sewing it down. Real upholstery is double-needle: two dashed lines, one
    # each side of the seam.
    # Close to the trim colour, not a contrast thread. At full contrast and
    # 5.5 mm long these read as a string of beads laid across the seat rather
    # than as sewing — topstitching is visible because it dents the fabric, not
    # because it is a different colour.
    stitch_mat = material("chair_stitch", "chair_light", roughness=0.55)
    for u in (-0.55, 0.55):
        for path, name in (
            ([(cx + u * half, cy + dy - wrap * (1 - u * u) + 0.048, z)
              for z, dy, half, wrap in back_rows], "back"),
            ([(cx + u * half, cy + dy, mid_z + (edge_z - mid_z) * u * u + 0.048)
              for dy, mid_z, edge_z, half in seat_rows], "seat"),
        ):
            for step in range(len(path) - 1):
                a, b = path[step], path[step + 1]
                # Six stitches per span, each a short dash rather than a line.
                for k in range(9):
                    t = (k + 0.3) / 9.0
                    here = tuple(a[axis] + (b[axis] - a[axis]) * t for axis in range(3))
                    for side in (-0.009, 0.009):
                        parts.append(
                            cube(
                                f"stitch_{name}_{u}_{step}_{k}_{side}",
                                (0.0026, 0.0009, 0.0009),
                                (here[0] + side, here[1], here[2]),
                                stitch_mat,
                                bevel=0,
                            )
                        )

    # The hard shell on the back of the backrest. A task chair is upholstery on
    # the front and a moulded plastic shell behind, and the two never share a
    # material — without it the back reads as fabric all the way through.
    shell_mat = material("chair_shell", "plastic", roughness=0.36)
    # Built from the shell's own cage rather than as a box guessed to fit.
    # A guessed box stands proud wherever the shell narrows — and this shell
    # narrows a lot, from 26 cm half-width at the shoulders to 13 cm at the top
    # — so the plate showed as a slab sticking out past the backrest's edge.
    plate_verts: list[tuple[float, float, float]] = []
    for z, dy, half, wrap in back_rows:
        for u in columns:
            # Inset from the upholstery all round, and set behind it — *clear*
            # of it, which -0.055 was not. The fabric shell's solidify carries
            # its rear face to about -0.08 from the cage, so a plate at -0.055
            # with 22 mm of thickness ended 3 mm short of ever emerging: the
            # one detail that closes the back of a chair was built, joined,
            # exported and entirely inside the cushion. Every rear view showed
            # upholstery wrapped around to a surface no sitter touches.
            plate_verts.append((u * half * 0.88, dy - wrap * (1 - u * u) - 0.098, z))
    plate_faces = []
    for row in range(len(back_rows) - 1):
        for col in range(stride - 1):
            a = row * stride + col
            plate_faces.append((a, a + 1, a + stride + 1, a + stride))
    shell = poly("back_plate", plate_verts, plate_faces, (cx, cy, 0), shell_mat)
    shell.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.022
    parts.append(smooth(shell, 2, crease=0.4))

    # The moulded logo recess every one of them has, on the plate at shoulder
    # height where the cage puts it.
    badge_row = back_rows[3]
    parts.append(
        cube("back_badge", (0.06, 0.016, 0.030),
             (cx, cy + badge_row[1] - badge_row[3] - 0.126, badge_row[0]), metal, bevel=0.003)
    )

    # Elastic straps slinging the headrest and the lumbar cushion off the shell,
    # with their buckles. These cushions are hung, not glued, and the straps are
    # the reason they sit proud of the back instead of merging into it.
    strap_mat = material("chair_strap", "bezel", roughness=0.8, grain="fabric")
    for cushion_z, cushion_dy, span in ((1.31, -0.345, 0.075), (0.69, -0.155, 0.085)):
        for side in (-1, 1):
            parts.append(
                cube(f"strap_{cushion_z}_{side}", (0.022, 0.055, span * 2.4),
                     (cx + side * 0.085, cy + cushion_dy - 0.02, cushion_z), strap_mat, bevel=0.002)
            )
            parts.append(
                cube(f"buckle_{cushion_z}_{side}", (0.026, 0.012, 0.018),
                     (cx + side * 0.085, cy + cushion_dy - 0.05, cushion_z - span * 0.9),
                     metal, bevel=0.002)
            )

    # A certification tag sewn into the seam. Every chair has one, and it is the
    # kind of thing nobody notices until it is missing.
    tag = cube("chair_tag", (0.05, 0.002, 0.032), (cx + 0.19, cy + 0.20, 0.455),
               material("chair_tag", "paper", roughness=0.8), bevel=0)
    tag.rotation_euler = (0, 0, 0.3)
    parts.append(tag)

    # The second lever. A chair has two — tilt on one side, height on the other
    # — and one lever alone reads as a chair that cannot be raised.
    parts.append(
        cylinder("height_lever", 0.010, 0.11, (cx - 0.20, cy + 0.04, 0.378), metal, vertices=10,
                 rotation=(0, math.radians(90), math.radians(-10)))
    )
    # The recline bracket and its tension knob, under the pan where the
    # mechanism actually is.
    parts.append(cube("recline_bracket", (0.16, 0.09, 0.05), (cx, cy - 0.12, 0.372), metal, bevel=0.006))
    parts.append(
        cylinder("tension_knob", 0.028, 0.045, (cx, cy - 0.13, 0.325),
                 material("knob", "dark_metal", roughness=0.5), vertices=14)
    )

    chair = join("ix_chair", parts)
    set_origin(chair, (cx, cy, 0.0))
    # -31 degrees, not -11. Eleven is the worst angle a chair can have: too
    # much to read as pushed in, too little to read as pushed back, so it just
    # looks slightly crooked. And squared up in front of the desk its backrest
    # stands directly between the home camera and the monitors — the desk is the
    # most detailed thing in this room and the chair was hiding it.
    #
    # Out, across and turned: the desk opens up, and the chair reads as one
    # somebody has just got up from rather than one nobody has ever sat in.
    chair.rotation_euler = (0, 0, math.radians(-46))

    # The draught comes in under the door at (-2.6, -2.52) and crosses the
    # room to this corner, so the foliage sweeps along that line and the
    # spilled soil lies on the leeward side.
    return [chair, *build_plant(2.78, 0.35, sway=(0.31, 0.17), spill=True)]


_plants = 0


def build_plant(px: float, py: float, *, scale: float = 1.0, base_z: float = 0.0, sway: tuple[float, float] = (0.0, 0.0), spill: bool = False) -> list[bpy.types.Object]:
    """
    A potted plant: a pot with a rim, soil, and leaves sitting on real stems.

    Each stem leans out of the pot by an angle, and every other position is
    derived from that one angle. The first attempt placed the stem's centre and
    its leaf independently and let a rotation tilt the stem afterwards, so the
    two disagreed about where the stem actually pointed — the leaves ended up
    strewn across the floor a metre from the pot.

    `scale` and `base_z` let the same plant stand on the floor, on a shelf or on
    a windowsill. Sizes multiply rather than the object being scaled after the
    fact, so the pot walls and the stems stay in proportion to each other.
    """
    global _plants
    _plants += 1
    tag = f"plant_{_plants}"

    pot_mat = material("pot", "pot", roughness=0.9, grain="plaster")
    s = scale
    soil_top = base_z + 0.3 * s

    parts = [
        cylinder(f"{tag}_pot", 0.17 * s, 0.3 * s, (px, py, base_z + 0.15 * s), pot_mat),
        cylinder(f"{tag}_rim", 0.185 * s, 0.05 * s, (px, py, base_z + 0.28 * s), pot_mat),
    ]

    # Soil, as a mound with lumps in it rather than a flat disc.
    #
    # A perfectly level circle of brown at the top of a pot is one of those
    # details nobody names and everybody reads: soil settles unevenly, sits
    # lower at the rim where it has been watered down the side, and has pieces
    # of bark and grit standing proud of it.
    soil_mat = material("soil", "earth", roughness=1.0, grain="pile")
    mound = cylinder(f"{tag}_soil", 0.155 * s, 0.02 * s, (px, py, soil_top), soil_mat)
    smooth(mound, 1, crease=0.4)
    parts.append(mound)
    for clump in range(5):
        ca = clump / 5 * math.tau + 0.7
        cr = (0.05 + (clump % 3) * 0.032) * s
        parts.append(
            cube(
                f"{tag}_grit_{clump}",
                (0.022 * s, 0.017 * s, 0.010 * s),
                (px + math.cos(ca) * cr, py + math.sin(ca) * cr, soil_top + 0.008 * s),
                soil_mat,
                rotation_z=ca * 1.7,
                bevel=0.002 * s,
            )
        )

    if spill:
        spill_rng = random.Random(int(px * 1000) ^ int(py * 1000))
        spill_a = math.atan2(sway[1], sway[0] if sway[0] else 1e-6)
        for c in range(6):
            ca = spill_a + (spill_rng.random() - 0.5) * 1.8
            cr = (0.19 + spill_rng.random() * 0.09) * s
            parts.append(
                cube(
                    f"{tag}_spill_{c}",
                    ((0.014 + spill_rng.random() * 0.012) * s, (0.012 + spill_rng.random() * 0.008) * s, 0.006 * s),
                    (px + math.cos(ca) * cr, py + math.sin(ca) * cr, base_z + 0.003 * s),
                    soil_mat,
                    rotation_z=spill_rng.random() * 3.0,
                    bevel=0.001,
                )
            )

    # Three leaf tones, because a plant is not one colour. New growth at the
    # top is lighter and yellower, mature leaves are darker, and the oldest have
    # started to go. A single leaf colour is the second strongest sign of a
    # procedural plant after identical leaf shapes.
    leaf_mats = [
        material("leaf", "leaf", roughness=0.62),
        material("leaf_old", "leaf_dark", roughness=0.58),
        material("leaf_new", "green", roughness=0.66),
    ]
    # Leaves are thin and lit from behind, and that is most of why real foliage
    # glows at its edges. Without it a leaf shades like a painted chip of
    # plastic no matter how well it is modelled.
    for leaf_material in leaf_mats:
        bsdf = leaf_material.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Subsurface Weight"].default_value = 0.22
        bsdf.inputs["Subsurface Radius"].default_value = (0.010, 0.022, 0.006)
    stem_mat = material("stem", "leaf_dark", roughness=0.7)
    foliage: list[bpy.types.Object] = []

    # Deterministic per-leaf variation.
    #
    # The old plant varied length by `i % 5` and lean by `i % 4`, which gives
    # four or five distinct leaves repeating around the pot — and a repeat is
    # more obvious than no variation at all, because the eye finds the period.
    # Multiplying the index by an irrational and taking the fraction never
    # repeats and never needs a seed stored anywhere.
    def spread(index: int, root: float) -> float:
        return (index * root) % 1.0

    for i in range(12):
        angle = i / 12 * math.tau * 2.6
        v_len, v_wide, v_droop = (
            spread(i, 0.6180339887),
            spread(i, 0.4142135624),
            spread(i, 0.7320508076),
        )
        lean = 0.24 + v_droop * 0.62
        # Shorter stems and bigger leaves than before. The old ratio — a 24 cm
        # stem carrying a 13 cm blade — gave twelve lollipops: a long bare
        # stick with a shape on the end. On a real plant of this kind the leaf
        # is most of the length and the stem is the part you have to look for.
        length = (0.13 + v_len * 0.15) * s

        # Where the stem comes *out of the soil*, which is not one point.
        #
        # Every stem used to start at the pot's exact centre, so the plant was a
        # cone of sticks meeting at a vertex — the single clearest sign of a
        # procedurally generated plant, and visible from across the room. Real
        # growth comes up from a crown spread across the surface.
        root_r = (0.028 + spread(i, 0.5236067977) * 0.055) * s
        root_a = angle + (spread(i, 0.3027756377) - 0.5) * 1.4
        bx = px + math.cos(root_a) * root_r
        by = py + math.sin(root_a) * root_r

        # The direction the stem grows in, straight from the lean angle. The
        # centre sits at half its length along that direction and the leaf sits
        # at the end of it, so the three can never drift apart.
        dx = math.sin(lean) * math.cos(angle)
        dy = math.sin(lean) * math.sin(angle)
        dz = math.cos(lean)
        # Wind. A draught bends every stem the same way, and it bends the
        # tall ones furthest — leverage — so the bias scales with length.
        # Radial symmetry is the tell of a plant grown in software; a plant
        # by a door grows and leans the way the air moves past it.
        dx += sway[0] * (0.4 + 0.6 * v_len)
        dy += sway[1] * (0.4 + 0.6 * v_len)
        norm = math.sqrt(dx * dx + dy * dy + dz * dz)
        dx, dy, dz = dx / norm, dy / norm, dz / norm

        # `aim` points the stem along the direction its leaf is placed on, so
        # the two cannot disagree. They used to: the rotation was a small-angle
        # approximation with both signs inverted, every stem leaned the opposite
        # way to the leaf it carried, and the plant read as foliage hovering in
        # mid-air beside a bundle of sticks.
        # Tapered, and no two the same width. A stalk is thicker where it
        # leaves the soil than where it carries a leaf, and a bundle of
        # identical tubes is the other half of what made this read as generated.
        stem = cone(
            f"{tag}_stem_{i}",
            (0.0085 + v_wide * 0.0045) * s,
            (0.0040 + v_wide * 0.0020) * s,
            length,
            (bx + dx * length / 2, by + dy * length / 2, soil_top + dz * length / 2),
            stem_mat,
            vertices=6,
            rotation=aim((dx, dy, dz)),
        )
        foliage.append(stem)

        # A leaf with a midrib, a droop and a twist — three things a flat card
        # cannot do, and between them most of what separates foliage from paper.
        #
        # The old blade was two rows of vertices: an outline, extruded to a
        # thickness. An outline has one surface normal across its whole width,
        # so the leaf shaded as a single flat value from every angle and no
        # amount of light made it read as a leaf. A midrib gives the blade a
        # shallow V section, so the two halves catch the light differently and
        # a highlight runs down the centre — which is the thing the eye is
        # actually using to identify a leaf at a distance.
        leaf_len = (0.135 + v_len * 0.075) * s
        leaf_wide = (0.030 + v_wide * 0.020) * s
        # How far the tip falls, and how far the blade rolls about its own axis
        # on the way. Both vary per leaf: a plant where every leaf droops by the
        # same amount reads as a lampshade.
        droop = (0.45 + v_droop * 0.85) * leaf_wide
        twist = (v_wide - 0.5) * 0.9
        ridge = 0.30

        blade: list[tuple[float, float, float]] = []
        # (fraction along the leaf, fraction of full width)
        stations = ((-0.16, 0.20), (0.22, 0.92), (0.50, 1.0), (0.78, 0.70), (1.0, 0.0))
        for t, w in stations:
            # Droop accelerates toward the tip rather than running linearly —
            # a leaf is stiff at the base where it is thick and gives at the
            # end, so a straight taper down reads as a bent wire.
            fall = -droop * max(0.0, t) ** 1.8
            roll = twist * max(0.0, t)
            half = w * leaf_wide
            rise = ridge * leaf_wide * (1.0 - max(0.0, t)) * max(w, 0.05)
            for side in (-1, 0, 1):
                across = side * half
                # Rolling the cross-section about the leaf's own axis, so the
                # blade turns as it falls instead of staying face-up.
                blade.append((
                    t * leaf_len,
                    across * math.cos(roll) - (rise if side == 0 else 0.0) * math.sin(roll),
                    fall + across * math.sin(roll) + (rise if side == 0 else 0.0) * math.cos(roll),
                ))

        blade_faces = []
        for row in range(len(stations) - 1):
            base_index = row * 3
            for column in range(2):
                a = base_index + column
                blade_faces.append((a, a + 1, a + 4, a + 3))

        leaf = poly(f"{tag}_leaf_{i}", blade, blade_faces, (0, 0, 0),
                    leaf_mats[i % 3 if i % 7 else 1])
        leaf.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.0022 * s
        smooth(leaf, 1, crease=0.1)
        # Stand it up along the stem, then splay it out around the pot.
        leaf.rotation_euler = (0, -math.pi / 2 + lean, angle)
        leaf.location = (bx + dx * length, by + dy * length, soil_top + dz * length)
        foliage.append(leaf)

    base = join(tag, parts)
    # The foliage is its own object with its origin at the soil crown, so the
    # runtime can rock it a fraction of a degree about the point the stems
    # actually grow from — swaying the pot along with the leaves is how toy
    # plants move.
    crown = join(f"{tag}_leaves", foliage)
    set_origin(crown, (px, py, soil_top))
    return [base, crown]


def build_lounge() -> list[bpy.types.Object]:
    """
    The other half of the room: sofa, low table, TV on a unit.

    A workspace with nothing but a desk in it reads as a stage set. The point of
    these is not that a visitor inspects the sofa — it is that the room stops
    looking like it was built solely to hold one desk.
    """
    fabric = material("sofa_fabric", "sofa", roughness=0.95, grain="fabric")
    wood = material("lounge_wood", "desk", roughness=0.55, grain="wood")
    dark = material("lounge_dark", "bezel", roughness=0.42)
    metal = material("lounge_metal", "metal", roughness=0.35, metallic=1.0, grain="brushed")

    # Nothing here shares a face with anything else. Two coplanar surfaces of
    # different objects z-fight, and upholstery is where that bites hardest,
    # because a sofa is one shape assembled from six boxes that all want to end
    # in the same place. Every cushion sinks a centimetre into what carries it.
    parts = []
    sx, sy = 0.2, 1.6
    piping = material("sofa_piping", "chair_light", roughness=0.86, grain="fabric")
    parts.append(cube("sofa_base", (2.05, 0.86, 0.32), (sx, sy, 0.18), fabric, bevel=0.03))
    parts.append(cube("sofa_back", (2.0, 0.22, 0.56), (sx, sy + 0.38, 0.58), fabric, bevel=0.04))
    for side in (-1, 1):
        arm = cube(f"sofa_arm_{side}", (0.24, 0.92, 0.38), (sx + side * 0.95, sy, 0.47), fabric, bevel=0)
        # Creased hard: an arm is upholstered over a frame, so it should round
        # off without going soft the way a loose cushion does.
        parts.append(smooth(arm, 2, crease=0.62))
    # Cushions are subdivided rather than bevelled. A bevelled box is a box
    # with soft corners and still reads as a box; a cushion is a shape whose
    # faces bulge, which is what subdivision does to a cage and what a chamfer
    # cannot do at any radius.
    for i in range(3):
        cx_seat = sx - 0.62 + i * 0.62
        seat = cube(f"cushion_{i}", (0.6, 0.72, 0.17), (cx_seat, sy - 0.06, 0.4), fabric, bevel=0)
        parts.append(smooth(seat, 2, crease=0.28))

        # Piping: the welt seam run around the edge where the top panel meets
        # the side panel. It is the single feature that says a cushion was sewn
        # rather than extruded — a subdivided box gives the bulge, and without
        # the seam the bulge reads as a pillow-shaped solid.
        #
        # One flattened slab subdivided exactly as the cushion is, and a hair
        # wider in plan, so it emerges around the equator as a seam.
        #
        # Four straight bars at the cage extents was the obvious way and it does
        # not work: subdivision pulls a cage in hard, so the cushion's real
        # surface sits well inside the box it was built from, and bars placed on
        # the box hover in the air beside it. Anything meant to hug a subdivided
        # surface has to be subdivided from the same proportions — then it
        # shrinks by the same amount and lands where the surface actually is.
        welt = cube(
            f"cushion_welt_{i}",
            (0.612, 0.734, 0.030),
            (cx_seat, sy - 0.06, 0.402),
            piping,
            bevel=0,
        )
        parts.append(smooth(welt, 2, crease=0.28))
    for i, x in enumerate((-0.52, 0.52)):
        back = cube(f"back_cushion_{i}", (0.58, 0.2, 0.44), (sx + x, sy + 0.23, 0.63), fabric, bevel=0)
        back.rotation_euler = (0.14, 0, 0)
        parts.append(smooth(back, 2, crease=0.22))
        # The same welt the seat cushions carry, standing on edge. The backs
        # were the only cushions on the sofa without a seam, and the eye reads
        # the difference as two kinds of object rather than as one suite.
        back_welt = cube(f"back_welt_{i}", (0.592, 0.030, 0.454), (sx + x, sy + 0.23, 0.63), piping, bevel=0)
        back_welt.rotation_euler = (0.14, 0, 0)
        parts.append(smooth(back_welt, 2, crease=0.22))
    # A throw over one arm, and two scatter cushions. Perfect symmetry is what
    # makes furniture look modelled rather than used.
    throw = cube("throw", (0.5, 0.72, 0.05), (sx - 0.72, sy - 0.02, 0.5),
                 material("throw", "rug", roughness=1.0, grain="pile"), bevel=0.02)
    throw.rotation_euler = (0, 0.16, 0)
    parts.append(throw)
    for i, (x, tilt) in enumerate(((-0.34, 0.5), (0.72, -0.42))):
        scatter = cube(f"scatter_{i}", (0.32, 0.12, 0.32), (sx + x, sy + 0.16, 0.62),
                       material("scatter", "wall_accent", roughness=0.95, grain="fabric"), bevel=0.05)
        scatter.rotation_euler = (0.2, tilt, 0)
        parts.append(scatter)
    for i in range(4):
        dx = -0.88 if i % 2 == 0 else 0.88
        dy = -0.36 if i < 2 else 0.36
        parts.append(cube(f"sofa_foot_{i}", (0.06, 0.06, 0.07), (sx + dx, sy + dy, 0.035), wood))

    sofa = join("sofa", parts)

    # Coffee table, with a magazine stack and a tray on it.
    table = [cube("table_top", (1.15, 0.6, 0.055), (0.25, 0.5, 0.37), wood, bevel=0.012)]
    for i in range(4):
        dx = -0.5 if i % 2 == 0 else 0.5
        dy = -0.22 if i < 2 else 0.22
        table.append(cube(f"table_leg_{i}", (0.055, 0.055, 0.35), (0.25 + dx, 0.5 + dy, 0.175), wood))
    table.append(cube("table_shelf", (1.0, 0.5, 0.028), (0.25, 0.5, 0.15), wood, bevel=0.008))

    # An apron: the rail set back under the top that ties the legs together.
    # Every real table has one and it is most of why a table reads as joinery
    # rather than as a slab balanced on four posts — it also gives the underside
    # of the top a shadow line instead of a flat plane.
    for name, size, offset in (
        ("table_apron_front", (1.07, 0.045, 0.055), (0.0, -0.255)),
        ("table_apron_back", (1.07, 0.045, 0.055), (0.0, 0.255)),
        ("table_apron_left", (0.045, 0.52, 0.055), (-0.515, 0.0)),
        ("table_apron_right", (0.045, 0.52, 0.055), (0.515, 0.0)),
    ):
        table.append(cube(name, size, (0.25 + offset[0], 0.5 + offset[1], 0.315), wood, bevel=0.005))
    for i, key in enumerate(("book_a", "book_c", "book_d")):
        mag = cube(f"magazine_{i}", (0.3, 0.23, 0.022), (0.0, 0.5, 0.41 + i * 0.023),
                   material(f"magazine_{key}", key, roughness=0.5), bevel=0.004)
        mag.rotation_euler = (0, 0, 0.12 * (i - 1))
        table.append(mag)
    # A turned ceramic bowl with keys dropped in it — the chrome puck it
    # replaces was the one object on this table nobody could name.
    bowl_mat = material("bowl_ceramic", "pot", roughness=0.55, grain="plaster")
    table.append(
        lathe("table_bowl", [(0.0, 0.0), (0.055, 0.0), (0.10, 0.018), (0.11, 0.048), (0.105, 0.050),
                             (0.095, 0.046), (0.088, 0.020), (0.0, 0.014)],
              (0.62, 0.52, 0.398), bowl_mat)
    )
    # Empty. It held two keys and a ring, which at four centimetres and this
    # light read as cigarettes in an ashtray — an object nobody in this room
    # owns. An empty turned bowl needs no explanation.

    # A remote, dropped at an angle near the sofa edge of the table. The
    # magazines and the bowl are things a stylist would place; the remote is
    # the thing that says somebody watches things from this sofa. Buttons walk
    # the same rotation as the body, or they slide off it as it turns.
    remote_turn = math.radians(24)
    remote_mat = material("remote", "plastic", roughness=0.6)
    remote = cube("remote", (0.046, 0.138, 0.014), (0.55, 0.30, 0.405), remote_mat, bevel=0.005)
    remote.rotation_euler = (0, 0, remote_turn)
    table.append(remote)
    button_mat = material("remote_button", "dark_metal", roughness=0.5)
    for row in range(4):
        for col in (-0.011, 0.011):
            lx, ly = col, -0.048 + row * 0.026
            table.append(
                cylinder(
                    f"remote_btn_{row}_{col}", 0.0055, 0.004,
                    (0.55 + lx * math.cos(remote_turn) - ly * math.sin(remote_turn),
                     0.30 + lx * math.sin(remote_turn) + ly * math.cos(remote_turn),
                     0.413),
                    button_mat, vertices=8,
                )
            )
    table.append(
        cylinder("remote_power", 0.006, 0.004,
                 (0.55 - 0.055 * math.sin(remote_turn), 0.30 + 0.055 * math.cos(remote_turn), 0.413),
                 material("remote_power", "red", roughness=0.4), vertices=8)
    )

    # A floor lamp behind the far arm of the sofa. It stands where the TV used
    # to: this room has two walls and both are spoken for, so a screen on the
    # third had nothing behind it and read as furniture floating at the edge of
    # a stage.
    lx, ly = -1.22, 1.85
    lamp = [
        cylinder("floor_lamp_base", 0.14, 0.028, (lx, ly, 0.014), metal),
        cylinder("floor_lamp_pole", 0.016, 1.42, (lx, ly, 0.72),
                 # Dark brushed steel, not chrome: a polished pole 24 cm from
                 # its own light renders as a white stripe from every seat in
                 # the room.
                 material("lamp_pole", "dark_metal", roughness=0.5, metallic=1.0, grain="brushed"), vertices=12),
    ]
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.16, radius2=0.11, depth=0.22, vertices=20, location=(lx, ly, 1.51)
    )
    shade_obj = bpy.context.object
    shade_obj.name = "floor_lamp_shade"
    shade_obj.data.name = "floor_lamp_shade"
    # The shade emits, because a lit shade does. It is paper with a bulb inside
    # it, so most of what reaches the eye is light coming *through* the material
    # rather than bouncing off it — and treating it as an ordinary diffuse
    # surface gave the worst artefact in the room. The bake could only light its
    # outside, which faces away from the bulb, so it landed hard against a UV
    # island boundary: one half of the cone blew out to white, the other stayed
    # grey and blocky, with a seam straight down the middle where they met.
    #
    # Emission fixes the cause rather than the symptom. It is uniform across the
    # cone, so the seam has nothing left to reveal, and it is what the surface
    # is actually doing.
    lamp.append(
        shade(
            shade_obj,
            # Warm cream paper, not the blue-white "paper" the CV page uses.
            # The shade's own pigment is what the emission gets filtered
            # through in the eye's reading of it, and a cold base colour kept
            # dragging the glow back toward white however warm the emission
            # key was.
            material(
                "lamp_shade",
                "pages",
                roughness=0.88,
                emission=0.92,
                emission_key="lampglow",
                grain="fabric",
            ),
        )
    )
    # And it must not cast, for the same reason the desk lamp's mouth must not:
    # `primitive_cone_add` caps both ends, so this shade is a closed vessel with
    # the bulb sealed inside it, and every photon the floor lamp emitted was
    # stopped by the paper it was supposed to be shining through. The lounge end
    # of the room has been lit by nothing but a distant window for as long as
    # this lamp has existed.
    #
    # A paper shade transmits — that is the whole reason it is made of paper —
    # so passing light is what the object does, and the emission above is that
    # transmitted light seen from outside.
    shade_obj.visible_shadow = False

    # No beam geometry, after four attempts at a subtle one. Every
    # translucent surface, at any alpha, draws its own silhouette the moment
    # a darker background sits behind it — and from every angle this lamp has
    # a bookshelf or a rug behind it. The lit air under the shade is carried
    # by the dust particles in `Atmosphere.tsx`, which are points and have no
    # surface to outline.

    # A side table by the near arm of the sofa, with a smart speaker on it.
    #
    # It was a bevelled box with a grille on the face nobody sees, and from
    # the room it read as a black lump of nothing in particular. A smart
    # speaker is one of the few objects with a silhouette everyone recognises
    # from any angle — a fabric cylinder with a lit ring — so it gets that
    # shape, and the ring earns its keep as one more practical in a room lit
    # by practicals.
    tx, ty = 1.62, 0.55
    speaker_fabric = material("speaker_fabric", "dark_metal", roughness=0.92, grain="fabric")
    # Off-centre, because nobody parks one object in the middle of a table.
    sx_sp, sy_sp = tx + 0.06, ty - 0.04
    led_ring = cylinder("speaker_led", 0.050, 0.005, (sx_sp, sy_sp, 0.729),
                        material("speaker_led", "cyan", roughness=0.4, emission=1.5), vertices=24)
    led_ring.modifiers.new("Ring", "WIREFRAME").thickness = 0.004
    # A pedestal table built the way one is made: a turned top with a rolled
    # edge, a steel column with collars where it meets the top and the base,
    # and a weighted dome foot — three flat discs on a pipe was furniture
    # drawn from memory, and it read exactly that way from above.
    side = [
        lathe("side_top", [(0.0, 0.0), (0.205, 0.0), (0.22, 0.008), (0.22, 0.030), (0.205, 0.040), (0.0, 0.040)],
              (tx, ty, 0.50), wood),
        cylinder("side_collar_top", 0.040, 0.018, (tx, ty, 0.492), metal, vertices=14),
        cylinder("side_post", 0.026, 0.47, (tx, ty, 0.255), metal, vertices=14),
        cylinder("side_collar_mid", 0.032, 0.014, (tx, ty, 0.30), metal, vertices=14),
        lathe("side_foot", [(0.0, 0.0), (0.17, 0.0), (0.165, 0.012), (0.12, 0.030), (0.05, 0.042), (0.0, 0.045)],
              (tx, ty, 0.0), metal),
        cylinder("speaker_body", 0.055, 0.185, (sx_sp, sy_sp, 0.6325), speaker_fabric, vertices=24),
        cylinder("speaker_top", 0.049, 0.012, (sx_sp, sy_sp, 0.727), dark, vertices=24),
        led_ring,
        # And something somebody left there: an espresso cup on a cork
        # coaster, the lounge's answer to the desk's cold coffee.
        cylinder("side_coaster", 0.045, 0.006, (tx - 0.10, ty + 0.05, 0.543),
                 material("cork", "pot", roughness=0.95)),
        cylinder("side_cup", 0.026, 0.05, (tx - 0.10, ty + 0.05, 0.571),
                 material("cup_espresso", "chair_light", roughness=0.35), vertices=16),
        cylinder("side_cup_well", 0.021, 0.04, (tx - 0.10, ty + 0.05, 0.582),
                 material("mug_void", "void", roughness=0.9), vertices=16),
    ]

    # Framed prints on the accent wall. The wall runs to y = 2.6, and the
    # bookshelf occupies y = 0.05 to 1.85 — anything hung outside that band
    # either floats off the end of the wall or grows through a shelf.
    art = []
    # y = 2.30, not 2.15. The frames are 46 cm tall and the bookshelf ends at
    # y = 2.00, so at 2.15 the nearer 8 cm of both pictures was behind the case.
    for i, (y, z, h) in enumerate(((2.30, 1.62, 0.52), (2.30, 2.24, 0.46))):
        art.append(cube(f"frame_{i}", (0.04, 0.46, h), (-3.11, y, z),
                        material("art_frame", "desk_frame", roughness=0.5)))
        art.append(cube(f"print_{i}", (0.01, 0.4, h - 0.06), (-3.08, y, z),
                        material(f"print_{i}", ("cyan", "violet")[i], roughness=0.7), bevel=0))

    guitar = build_guitar(-2.86, 2.3, dark)

    return [
        sofa,
        join("coffee_table", table),
        join("floor_lamp", lamp),
        join("side_table", side),
        join("wall_art", art),
        join("guitar", guitar),
    ]


def build_guitar(gx: float, gy: float, stand_mat: bpy.types.Material) -> list[bpy.types.Object]:
    """
    An acoustic guitar leaning in the corner.

    The body is a real outline, given thickness and rounded off. Three stacked
    discs got the widths right and the shape wrong: a guitar is read entirely
    by the continuous curve in and out of its waist, and a stack of circles has
    a hard step at every join instead of a curve.
    """
    lean = math.radians(11)
    body_mat = material("guitar_body", "book_d", roughness=0.26, grain="lacquer")

    # Half the outline, bottom of the body to the neck joint, as (height along
    # the body, half width). Mirrored into a full silhouette below.
    outline = (
        (0.000, 0.030),
        (0.035, 0.125),
        (0.085, 0.178),
        (0.150, 0.190),
        (0.215, 0.168),
        (0.270, 0.126),
        (0.310, 0.121),
        (0.360, 0.140),
        (0.420, 0.152),
        (0.475, 0.130),
        (0.510, 0.082),
        (0.530, 0.038),
    )
    verts: list[tuple[float, float, float]] = []
    for height, half in outline:
        for side in (-1, 1):
            verts.append((0.0, side * half, height))
    faces = [(n, n + 1, n + 3, n + 2) for n in range(0, (len(outline) - 1) * 2, 2)]

    base_z = 0.09
    body = poly("guitar_body", verts, faces, (gx, gy, base_z), body_mat)
    body.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.088
    body.rotation_euler = (0, -lean, 0)
    smooth(body, 2, crease=0.55)

    def along(distance: float, offset: float = 0.0) -> tuple[float, float, float]:
        """
        A point `distance` up the guitar's own axis, `offset` toward the room.

        Derived from the rotation the body actually carries. Blender's Ry(−lean)
        sends the body's local +Z to (−sin, 0, cos), so everything mounted on it
        travels in −X as it rises; walking +X instead put the neck and the
        soundhole on the opposite side of the corner from the body they belong
        to. The front face normal is that same rotation applied to +X.
        """
        return (
            gx - distance * math.sin(lean) + offset * math.cos(lean),
            gy,
            base_z + distance * math.cos(lean) + offset * math.sin(lean),
        )

    parts = [body]

    parts.append(
        cylinder("guitar_soundhole", 0.048, 0.01, along(0.315, 0.056),
                 material("soundhole", "plastic", roughness=0.7), vertices=20,
                 rotation=(0, math.radians(90) - lean, 0))
    )
    bridge = cube("guitar_bridge", (0.022, 0.105, 0.032), along(0.16, 0.056),
                  material("guitar_bridge", "dark_metal", roughness=0.5), bevel=0.004)
    bridge.rotation_euler = (0, -lean, 0)
    parts.append(bridge)

    neck = cube("guitar_neck", (0.048, 0.052, 0.46), along(0.75), material("guitar_neck", "pot", roughness=0.5))
    neck.rotation_euler = (0, -lean, 0)
    parts.append(neck)

    fretboard = cube("guitar_fretboard", (0.012, 0.048, 0.44), along(0.75, 0.03),
                     material("fretboard", "dark_metal", roughness=0.55), bevel=0.003)
    fretboard.rotation_euler = (0, -lean, 0)
    parts.append(fretboard)

    head = cube("guitar_head", (0.05, 0.066, 0.15), along(1.03),
                material("guitar_head", "dark_metal", roughness=0.4))
    head.rotation_euler = (0, -lean, 0)
    parts.append(head)

    # Tuning pegs, three a side. Tiny, but a bare headstock reads as a plank
    # and this is the one place the eye expects detail.
    peg_mat = material("guitar_peg", "metal", roughness=0.35, metallic=1.0)
    for index in range(3):
        for side in (-1, 1):
            base = along(0.99 + index * 0.035)
            parts.append(
                cylinder(f"peg_{index}_{side}", 0.007, 0.05,
                         (base[0], gy + side * 0.052, base[2]), peg_mat, vertices=8,
                         rotation=(math.radians(90), 0, 0))
            )

    # --- the parts that make it an instrument rather than a guitar-shaped box
    #
    # Everything below is small, and all of it is what the eye checks. A body
    # with a neck reads as a prop; frets, a nut and six strings of visibly
    # different gauge read as something somebody plays.

    # Scale length: nut to saddle. Every fret position is derived from it rather
    # than spaced evenly, because even spacing is wrong in a way most people can
    # see without being able to say why — frets crowd together toward the body,
    # and the rule is that each one sits at 2^(-n/12) of the remaining length.
    saddle_at, nut_at = 0.165, 0.980
    scale_length = nut_at - saddle_at

    fret_mat = material("guitar_fret", "metal", roughness=0.25, metallic=1.0)
    bone_mat = material("guitar_bone", "paper", roughness=0.4)

    for n in range(1, 19):
        at = nut_at - scale_length * (1.0 - 2.0 ** (-n / 12.0))
        # Frets stop where the neck meets the body.
        if at < 0.560:
            break
        fret = cube(f"guitar_fret_{n}", (0.004, 0.049, 0.0022), along(at, 0.037), fret_mat, bevel=0)
        fret.rotation_euler = (0, -lean, 0)
        parts.append(fret)

        # Position markers, at the frets every guitarist looks for.
        if n in (3, 5, 7, 9, 12, 15):
            midpoint = nut_at - scale_length * (1.0 - 2.0 ** (-(n - 0.5) / 12.0))
            # Twelve gets two, which is how you know it is the octave.
            for dot_y in ((-0.012, 0.012) if n == 12 else (0.0,)):
                parts.append(
                    cylinder(
                        f"guitar_dot_{n}_{dot_y}", 0.005, 0.002,
                        (along(midpoint, 0.038)[0], gy + dot_y, along(midpoint, 0.038)[2]),
                        bone_mat, vertices=10, rotation=(0, math.radians(90) - lean, 0),
                    )
                )

    # Nut and saddle: the two pieces the strings actually bear on, and the
    # reason they stand clear of the fretboard instead of lying on it.
    nut = cube("guitar_nut", (0.008, 0.048, 0.006), along(nut_at, 0.038), bone_mat, bevel=0.001)
    nut.rotation_euler = (0, -lean, 0)
    parts.append(nut)

    saddle = cube("guitar_saddle", (0.005, 0.076, 0.008), along(saddle_at, 0.073), bone_mat, bevel=0.001)
    saddle.rotation_euler = (0, -lean, 0)
    parts.append(saddle)

    # Bridge pins, six of them, holding the ball ends.
    pin_mat = material("guitar_pin", "plastic", roughness=0.4)
    for index in range(6):
        pin_y = gy - 0.030 + index * 0.012
        seat = along(saddle_at - 0.018, 0.070)
        parts.append(
            cylinder(f"guitar_pin_{index}", 0.0032, 0.010, (seat[0], pin_y, seat[2]),
                     pin_mat, vertices=8, rotation=(0, math.radians(90) - lean, 0))
        )

    # The rosette. A ring of inlay round the soundhole — the one piece of
    # decoration an acoustic guitar always has, and the thing that stops the
    # soundhole reading as a drilled hole.
    for radius, thickness, mat_key in ((0.058, 0.0035, "guitar_bridge"), (0.053, 0.0018, "guitar_peg")):
        ring = cylinder(f"guitar_rosette_{radius}", radius, 0.002, along(0.315, 0.055),
                        _materials[mat_key], vertices=28,
                        rotation=(0, math.radians(90) - lean, 0))
        ring.modifiers.new("Ring", "WIREFRAME").thickness = thickness
        parts.append(ring)

    # Six strings, thick to thin. Uniform strings are wrong at a glance, and the
    # gauge run is the whole reason a guitar's neck reads as strung rather than
    # as striped. They rise from the saddle to the nut, standing clear of the
    # fretboard the whole way — the gap under them is what says they are under
    # tension.
    string_mat = material("guitar_string", "metal", roughness=0.2, metallic=1.0)
    for index in range(6):
        gauge = 0.00105 - index * 0.00014
        string_y = gy - 0.021 + index * 0.0084
        low = along(saddle_at, 0.079)
        high = along(nut_at, 0.045)
        parts.append(
            strut(
                f"guitar_string_{index}",
                (low[0], string_y, low[2]),
                (high[0], string_y, high[2]),
                gauge,
                string_mat,
                vertices=6,
            )
        )

    parts.append(cube("guitar_stand", (0.28, 0.32, 0.03), (gx + 0.06, gy, 0.055), stand_mat))
    return parts


def build_door() -> list[bpy.types.Object]:
    """
    A door on the back wall, left of the desk.

    A room with no way in reads as a set even when everything in it is right —
    it is the one thing every real room has that a modelled one usually skips.
    The door is closed and set into an architrave standing proud of the wall
    rather than cut through it: at this scale the shadow line around the frame
    is what sells the opening, and a boolean would buy nothing the architrave
    does not already give.
    """
    wood = material("door", "desk", roughness=0.4, grain="wood")
    trim = material("door_trim", "paper", roughness=0.55)
    metal = material("door_handle", "metal", roughness=0.25, metallic=1.0, grain="brushed")

    dx = -2.6
    width = 0.88
    height = 2.04
    face = -2.52

    parts = [
        cube("door_head", (width + 0.16, 0.05, 0.08), (dx, face, height + 0.04), trim),
        cube("door_jamb_l", (0.08, 0.05, height + 0.08), (dx - width / 2 - 0.04, face, (height + 0.08) / 2), trim),
        cube("door_jamb_r", (0.08, 0.05, height + 0.08), (dx + width / 2 + 0.04, face, (height + 0.08) / 2), trim),
        cube("door_panel", (width, 0.045, height), (dx, face + 0.01, height / 2), wood, bevel=0.01),
    ]

    # Two raised panels, which is what stops a door reading as a plank. They sit
    # proud of the panel face, not behind it — set back, they were inside the
    # door and then inside the wall, and the door came out a flat board.
    for i, (z, h) in enumerate(((0.62, 0.94), (1.66, 0.6))):
        parts.append(
            cube(f"door_inset_{i}", (width - 0.2, 0.018, h), (dx, face + 0.03, z), wood, bevel=0.012)
        )

    parts.append(cylinder("door_handle", 0.028, 0.09, (dx + 0.33, face - 0.05, 1.02), metal,
                          vertices=14, rotation=(math.radians(90), 0, 0)))
    parts.append(cylinder("door_rose", 0.045, 0.014, (dx + 0.33, face - 0.02, 1.02), metal,
                          vertices=16, rotation=(math.radians(90), 0, 0)))

    # The bottom of the door, which had nothing at all: the panel ran to the
    # boards and stopped, with no threshold and no shadow line — the one edge
    # of a door every eye passes on the way across a room. A threshold plate
    # under the leaf gives the dark line a closed door actually has.
    parts.append(
        cube("door_threshold", (width + 0.06, 0.085, 0.018), (dx, face + 0.015, 0.009),
             material("skirt", "dark_metal"), bevel=0.004)
    )
    # Hinges on the hanging side, opposite the handle. Two knuckle barrels,
    # proud of the frame line.
    for hz in (0.38, 1.66):
        parts.append(
            cylinder(f"door_hinge_{hz}", 0.009, 0.075, (dx - width / 2 + 0.005, face - 0.018, hz),
                     metal, vertices=10)
        )

    return [join("door", parts)]


def build_fittings() -> list[bpy.types.Object]:
    """
    The things a room is built with rather than furnished with.

    A room with no light switch, no sockets and nothing to heat it is a stage
    set: every one of these is invisible until it is missing, and then the space
    reads as somewhere nobody could actually live. The cables already run to a
    power strip on the floor — until now that strip was plugged into nothing.

    Wall faces: the back wall's inner surface is at y = -2.54 and the left
    wall's at x = -3.14, and the room lies on the *greater* side of both. So
    standing proud of a wall means adding to the coordinate, not subtracting —
    the first version of this subtracted, and every fin of the radiator ended up
    inside the plaster with 7 mm of back panel showing. It read as a blank white
    slab screwed to the wall, which is a thing that could plausibly exist, which
    is exactly why nothing looked wrong.
    """
    BACK, LEFT = -2.53, -3.13
    plate = material("fitting_plate", "paper", roughness=0.35)
    dark = material("fitting_dark", "plastic", roughness=0.4)
    metal = material("fitting_metal", "metal", roughness=0.3, metallic=1.0, grain="brushed")
    out: list[bpy.types.Object] = []

    # The light switch, beside the door at handle height rather than at the
    # 1.4 m people imagine — switches sit level with the door handle.
    switch = [
        cube("switch_plate", (0.086, 0.012, 0.086), (-2.00, BACK, 1.08), plate, bevel=0.004),
        cube("switch_rocker", (0.032, 0.010, 0.052), (-2.00, BACK + 0.010, 1.085), plate, bevel=0.003),
    ]
    out.append(join("light_switch", switch))

    # Sockets. One behind the desk where the power strip's lead goes, one on the
    # left wall for the floor lamp.
    #
    # The left-wall one sat at y = 0.92, which is squarely behind the bookshelf
    # — the case runs y -0.10 to 2.00 and stands 5 cm off the wall, so the
    # socket was sealed inside it and had never been visible from any camera in
    # the room. It moves to the clear stretch between the whiteboard and the
    # bookshelf, which is also where a lead to the floor lamp would actually
    # plug in.
    for index, (x, y, facing) in enumerate(((1.06, BACK, 0), (LEFT, -0.32, 1))):
        sockets = []
        size = (0.13, 0.012, 0.086) if facing == 0 else (0.012, 0.13, 0.086)
        here = (x, y, 0.22) if facing == 0 else (x, y, 0.22)
        sockets.append(cube(f"socket_plate_{index}", size, here, plate, bevel=0.004))
        for slot in (-0.031, 0.031):
            hole = (0.020, 0.008, 0.030) if facing == 0 else (0.008, 0.020, 0.030)
            spot = (x + slot, y + 0.009, 0.22) if facing == 0 else (x + 0.009, y + slot, 0.22)
            sockets.append(cube(f"socket_hole_{index}_{slot}", hole, spot, dark, bevel=0))
        out.append(join(f"socket_{index}", sockets))

    # A radiator under the window, in the one stretch of wall the desk and the
    # server rack leave free.
    rad = []
    rx, span = 2.06, 0.52
    rad.append(cube("rad_back", (span, 0.035, 0.54), (rx, BACK + 0.02, 0.44), plate, bevel=0.006))
    fins = 13
    for i in range(fins):
        x = rx - span / 2 + 0.022 + i * (span - 0.044) / (fins - 1)
        rad.append(cube(f"rad_fin_{i}", (0.016, 0.055, 0.50), (x, BACK + 0.048, 0.44), plate, bevel=0.003))
    rad.append(cube("rad_top", (span, 0.075, 0.016), (rx, BACK + 0.038, 0.705), plate, bevel=0.004))
    rad.append(cylinder("rad_valve", 0.020, 0.075, (rx - span / 2 - 0.01, BACK + 0.045, 0.20), metal,
                        vertices=12, rotation=(0, math.radians(90), 0)))
    rad.append(cylinder("rad_pipe", 0.012, 0.19, (rx - span / 2 + 0.01, BACK + 0.045, 0.10), metal, vertices=10))
    out.append(join("radiator", rad))

    # Door hinges, on the hanging stile, and a hook on the back of the door with
    # a bag on it — the cheapest way to say somebody arrives here and leaves.
    hinges = []
    for i, z in enumerate((0.42, 1.72)):
        hinges.append(cube(f"hinge_{i}", (0.016, 0.055, 0.088), (-3.02, -2.478, z), metal, bevel=0.003))
        hinges.append(cylinder(f"hinge_pin_{i}", 0.010, 0.098, (-3.02, -2.452, z), metal, vertices=10))
    out.append(join("door_hinges", hinges))

    bag = [
        cylinder("hook", 0.010, 0.055, (-2.34, -2.47, 1.58),
                 metal, vertices=10, rotation=(math.radians(90), 0, 0)),
        cube("hook_plate", (0.030, 0.010, 0.048), (-2.34, -2.482, 1.60), metal, bevel=0.003),
    ]
    tote = cube("tote", (0.26, 0.085, 0.32), (-2.34, -2.40, 1.28),
                material("tote", "chair_dark", roughness=0.9, grain="fabric"), bevel=0)
    smooth(tote, 2, crease=0.35)
    bag.append(tote)
    bag.append(cylinder("tote_strap", 0.010, 0.30, (-2.34, -2.43, 1.52),
                        material("strap", "chair_dark", roughness=0.9), vertices=8,
                        rotation=(0, math.radians(90), 0)))
    out.append(join("coat_hook", bag))

    # The window latch, on the frame where a hand would reach it.
    latch = [
        cube("latch_plate", (0.030, 0.014, 0.075), (2.05, -2.342, 1.34), metal, bevel=0.004),
        cube("latch_arm", (0.024, 0.055, 0.022), (2.05, -2.305, 1.34), metal, bevel=0.004),
    ]
    out.append(join("window_latch", latch))

    return out


def paper_wad(name: str, radius: float, location: tuple[float, float, float], mat: bpy.types.Material, seed: int) -> bpy.types.Object:
    """
    A crumpled ball of paper: an icosphere with every vertex thrown radially.

    The previous wads were bevelled cubes under one level of subdivision, and
    a cube rounded off is an egg however hard it is creased — six faces cannot
    make the dozens of random facets crumpling actually produces. An icosphere
    starts with eighty, and jittering each vertex in and out gives every wad
    its own set of ridges. Flat shading is the other half: crumpled paper is
    planes meeting at creases, and smooth normals average the creases away.
    """
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name
    rng = random.Random(seed)
    for vertex in obj.data.vertices:
        vertex.co *= 0.80 + rng.random() * 0.36
    obj.rotation_euler = (rng.random() * math.tau, rng.random() * math.tau, rng.random() * math.tau)
    return shade(obj, mat)


def build_details() -> list[bpy.types.Object]:
    """
    The layer of small stuff.

    Everything here is individually beneath notice, which is the point — the
    difference between a modelled room and a lived-in one is almost never a
    missing piece of furniture, it is the absence of the things nobody would
    think to put in: cables, a pen pot, a clock, a phone left face-down.
    """
    dark = material("detail_dark", "plastic", roughness=0.55)
    metal = material("detail_metal", "metal", roughness=0.3, metallic=1.0, grain="brushed")
    paper_mat = material("detail_paper", "paper", roughness=0.85, grain="paper")
    rubber = material("cable", "dark_metal", roughness=0.85)

    out: list[bpy.types.Object] = []

    # Cables. Down the back of each monitor, along the floor to a power strip
    # under the desk, and the kettle lead from the strip to the wall.
    strip = (0.30, DESK_BACK - 0.03, 0.04)
    cables = [
        cable("cable_monitor_l", [(-0.33, DESK_BACK + 0.16, 0.95), (-0.30, DESK_BACK + 0.02, 0.70), (-0.10, DESK_BACK - 0.02, 0.10), strip], 0.006, rubber),
        cable("cable_monitor_r", [(0.33, DESK_BACK + 0.16, 0.95), (0.36, DESK_BACK + 0.01, 0.72), (0.34, DESK_BACK - 0.04, 0.12), strip], 0.006, rubber),
        # From the lamp's foot at (1.58, -2.28), not from (-1.02, -2.02) where
        # the lamp used to stand. The lamp was moved to the back-right corner
        # and its cable was not, so the room had a flex running out of the
        # desktop on the left with nothing on the end of it, and a lamp on the
        # right plugged into nothing.
        cable("cable_lamp", [(0.98, DESK_BACK + 0.10, 0.79), (0.95, DESK_BACK - 0.03, 0.45), (0.60, DESK_BACK - 0.05, 0.10), strip], 0.005, rubber),
        cable("cable_wall", [strip, (0.75, DESK_BACK - 0.05, 0.10), (1.06, DESK_BACK - 0.03, 0.20)], 0.006, rubber),
    ]
    cables.append(cube("power_strip", (0.26, 0.07, 0.035), strip, dark, bevel=0.006))
    for i in range(4):
        cables.append(
            cube(f"strip_socket_{i}", (0.045, 0.038, 0.006), (0.21 + i * 0.058, DESK_BACK - 0.03, 0.056),
                 material("socket", "dark_metal", roughness=0.6), bevel=0.002)
        )
    # Two standby LEDs, sized to be *seen*: the power strip's red pilot and
    # the charger's amber one beside it. At 12 mm the pilot was authored and
    # then invisible from every camera in the room, and an indicator nobody
    # can see is dead geometry. They also get a real (runtime) glow — a
    # standby LED under a desk is exactly the kind of practical this room is
    # lit by, and the faint red pool on the boards is what says the strip is
    # live.
    cables.append(
        cube("strip_led", (0.018, 0.010, 0.010), (0.45, DESK_BACK - 0.008, 0.052),
             material("led_red", "red", roughness=0.3, emission=6.0), bevel=0)
    )
    cables.append(
        cube("strip_led_amber", (0.012, 0.009, 0.008), (0.33, DESK_BACK - 0.008, 0.052),
             material("led_amber", "warm", roughness=0.3, emission=4.0), bevel=0)
    )
    # The LED strip's controller, tucked under the desk's front lip at the end
    # of the magenta run, with its red standby eye facing the room. The power
    # strip's pilot exists but lives against the back wall where no camera in
    # the room has ever seen it — an indicator is only an indicator if there
    # is a line of sight to it, and this is the one spot under the desk every
    # view of the chair looks straight at.
    cables.append(
        cube("strip_controller", (0.052, 0.030, 0.020), (0.62, DESK_FRONT - 0.035, 0.715), dark, bevel=0.003)
    )
    cables.append(
        cube("controller_led", (0.011, 0.006, 0.008), (0.605, DESK_FRONT - 0.018, 0.712),
             material("led_red", "red", roughness=0.3, emission=6.0), bevel=0)
    )
    out.append(join("cables", cables))

    # An LED strip behind the monitors, bouncing off the wall. Every developer's
    # room has one and it is the cheapest possible source of coloured fill.
    #
    # Emission 1.0, not 4: glTF carries emission as a factor that saturates, so
    # anything much above unity ships as flat white and the strip stopped being
    # violet at all. It also sits low enough and short enough that the monitor
    # bodies occlude it — the strip itself is not the effect, the coloured wash
    # it throws on the wall behind them is, and a visible bright line across the
    # plaster reads as a fluorescent tube instead.
    # The backlight bar is a *fixture*, not a floating tube of light. It was a
    # bare emissive cube hanging on the wall with nothing holding it and
    # nothing housing it, and at emission 1.6 it still read as the source of
    # far more light than a diffuser this size emits. So: an aluminium channel
    # with end caps and two wall mounts, the diffuser recessed into it, and
    # the output down to a glow the wall wash can plausibly come from.
    bar_channel = material("led_channel", "dark_metal", roughness=0.42, metallic=1.0, grain="brushed")
    out.append(cube("light_bar_channel", (1.54, 0.026, 0.026), (0.0, DESK_BACK - 0.028, 1.26), bar_channel, bevel=0.003))
    for cap_x in (-0.782, 0.782):
        out.append(cube("light_bar_cap", (0.024, 0.03, 0.03), (cap_x, DESK_BACK - 0.028, 1.26), bar_channel, bevel=0.003))
    for mount_x in (-0.52, 0.52):
        out.append(cube("light_bar_mount", (0.034, 0.018, 0.014), (mount_x, DESK_BACK - 0.008, 1.247), bar_channel, bevel=0.002))
    out.append(
        # In FRONT of the channel, not inside it. The housing added for
        # realism recessed the diffuser 14 mm behind its own front face, so
        # the fixture blocked the fixture: the bar read as switched off from
        # everywhere in the room.
        cube("led_strip", (1.5, 0.014, 0.014), (0.0, DESK_BACK - 0.012, 1.262),
             # 1.9: visibly ON and still violet. 1.1 undershot — the bar read
             # as switched off — and everything above ~2.5 crosses the bloom
             # knee and ships as white. The runtime pairs it with a weak
             # violet wash spot, so the diffuser and the light it throws stay
             # in proportion.
             material("led_strip", "violet", roughness=0.4, emission=1.4), bevel=0)
    )

    # Desk clutter.
    desk_bits = []
    cup = (0.66, DESK_BACK + 0.14)
    desk_bits.append(cylinder("pen_cup", 0.037, 0.095, (cup[0], cup[1], DESK_TOP + 0.048), dark, vertices=16))
    for i, (lean, key) in enumerate(((0.1, "cyan"), (-0.14, "sticky"), (0.06, "paper"))):
        pen = cylinder(f"pen_{i}", 0.005, 0.15, (cup[0] + i * 0.010 - 0.010, cup[1], DESK_TOP + 0.125),
                       material(f"pen_{key}", key, roughness=0.5), vertices=6)
        pen.rotation_euler = (lean, lean * 0.7, 0)
        desk_bits.append(pen)

    # The phone, face down, as a manufactured object rather than a slab.
    #
    # It was one bevelled box: correct in size, correct in place, and
    # completely mute about what it was. Lying face down it shows the eye
    # exactly the surface that carries every mark a phone is recognised by —
    # the camera island, its lenses, the flash — and it had none of them.
    #
    # Every part is placed in the phone's own frame and then carried into the
    # room by one rotation, so the device turns as a unit and nothing can be
    # left behind facing the wrong way. That is the difference between parts
    # that are near each other and parts that are attached.
    phone_x, phone_y = 0.60, DESK_FRONT - 0.20
    phone_turn = math.radians(-14)
    phone_top = DESK_TOP + 0.0095

    def on_phone(dx: float, dy: float) -> tuple[float, float]:
        # A point in the phone's own frame, placed in the room.
        cos, sin = math.cos(phone_turn), math.sin(phone_turn)
        return (phone_x + dx * cos - dy * sin, phone_y + dx * sin + dy * cos)

    phone_parts: list[bpy.types.Object] = []
    phone_parts.append(
        cube("phone_body", (0.072, 0.148, 0.009), (phone_x, phone_y, DESK_TOP + 0.005), dark,
             bevel=0.004)
    )
    # The screen, underneath: a sliver of glass at the rim is all that shows
    # of it face down, and its absence is what made the box read as resin.
    phone_parts.append(
        cube("phone_screen", (0.066, 0.142, 0.0012), (phone_x, phone_y, DESK_TOP + 0.0009),
             material("phone_glass", "screen", roughness=0.08), bevel=0)
    )
    # The camera island, up-facing because the phone is not.
    island_x, island_y = on_phone(-0.019, 0.049)
    phone_parts.append(
        cube("phone_camera_module", (0.030, 0.030, 0.0022), (island_x, island_y, phone_top),
             material("phone_island", "dark_metal", roughness=0.35, metallic=1.0), bevel=0.002)
    )
    lens_mat = material("phone_lens", "void", roughness=0.08)
    ring_mat = material("phone_ring", "metal", roughness=0.25, metallic=1.0)
    for index, (lens_dx, lens_dy) in enumerate(((-0.0068, 0.0068), (0.0068, -0.0068))):
        cx, cy = on_phone(-0.019 + lens_dx, 0.049 + lens_dy)
        phone_parts.append(
            cylinder(f"phone_camera_lens_{index}", 0.0052, 0.0016, (cx, cy, phone_top + 0.0012),
                     ring_mat, vertices=12)
        )
        phone_parts.append(
            cylinder(f"phone_camera_glass_{index}", 0.0036, 0.0018, (cx, cy, phone_top + 0.0016),
                     lens_mat, vertices=12)
        )
    flash_x, flash_y = on_phone(-0.0055, 0.0405)
    phone_parts.append(
        cylinder("phone_flash", 0.0026, 0.0014, (flash_x, flash_y, phone_top + 0.0010),
                 material("phone_flash", "pages", roughness=0.3), vertices=10)
    )
    # Buttons on the long edge and the port on the short one, attached to the
    # body's faces rather than hovering beside them.
    for index, along in enumerate((0.030, 0.008, -0.008)):
        bx, by = on_phone(0.0365, along)
        phone_parts.append(
            cube(f"phone_button_{index}", (0.0022, 0.016 if index == 0 else 0.011, 0.0035),
                 (bx, by, DESK_TOP + 0.005),
                 material("phone_button", "metal", roughness=0.35, metallic=1.0),
                 rotation_z=phone_turn, bevel=0.0008)
        )
    port_x, port_y = on_phone(0.0, -0.0735)
    phone_parts.append(
        cube("phone_port", (0.0085, 0.0018, 0.0022), (port_x, port_y, DESK_TOP + 0.0048),
             material("phone_port", "void", roughness=0.9), rotation_z=phone_turn, bevel=0)
    )
    for part in phone_parts:
        part.rotation_euler = (0, 0, phone_turn)
    desk_bits.append(join("phone", phone_parts))

    # Splayed, not stacked. Three sheets at 4-5 degree steps about one centre
    # is a fan a magician spread; paper put down twice while working slides,
    # and each sheet lands with its own offset as well as its own turn.
    for i, (dx, dy, turn) in enumerate(((0.0, 0.0, 4), (0.024, -0.016, -9), (-0.028, 0.022, 14))):
        sheet = cube(
            f"paper_{i}", (0.21, 0.29, 0.003),
            (-0.95 + dx, DESK_BACK + 0.22 + dy, DESK_TOP + 0.003 + i * 0.004),
            paper_mat, bevel=0,
        )
        sheet.rotation_euler = (0, 0, math.radians(turn))
        desk_bits.append(sheet)

    desk_bits.append(cylinder("coaster", 0.055, 0.006, (0.40, DESK_FRONT - 0.14, DESK_TOP + 0.003), material("cork", "pot", roughness=0.95)))
    out.append(join("desk_clutter", desk_bits))

    # On the capping board of the bookshelf: a photo, a horizontal book stack,
    # an award and a small plant.
    deck = 2.18
    top = []
    photo = cube("photo_frame", (0.03, 0.2, 0.24), (-3.02, 0.32, deck + 0.12),
                 material("photo_frame", "desk_frame", roughness=0.5))
    photo.rotation_euler = (0, math.radians(-8), 0)
    top.append(photo)
    photo_face = cube("photo_face", (0.008, 0.16, 0.2), (-2.99, 0.32, deck + 0.12),
                      material("photo", "cyan", roughness=0.7), bevel=0)
    photo_face.rotation_euler = (0, math.radians(-8), 0)
    top.append(photo_face)

    for i, key in enumerate(("book_b", "book_c", "book_a")):
        top.append(
            cube(f"flat_book_{i}", (0.22, 0.16, 0.035), (-3.05, 0.78, deck + 0.018 + i * 0.037),
                 material(f"flat_{key}", key, roughness=0.55), bevel=0.005)
        )

    top.append(cylinder("award_base", 0.06, 0.04, (-3.05, 1.24, deck + 0.02),
                        material("award_base", "dark_metal", roughness=0.5)))
    bpy.ops.mesh.primitive_cone_add(radius1=0.05, radius2=0.018, depth=0.16, vertices=12,
                                    location=(-3.05, 1.24, deck + 0.12))
    award = bpy.context.object
    award.name = "award"
    award.data.name = "award"
    top.append(shade(award, material("award", "warm", roughness=0.2, metallic=1.0)))
    out.append(join("shelf_top", top))
    # Smaller, and further off the wall. At 0.42 its leaves spanned 29 cm on a
    # 22 cm capping board and reached 4 cm inside the wall itself.
    out.extend(build_plant(-3.00, 1.66, scale=0.32, base_z=deck))

    # A roller blind, mostly retracted, and a plant on the sill.
    #
    # It used to hang far enough to cover the top third of the glass. The window
    # is the one place in the room with something to look at through it, and a
    # blind that half closes it is spending the best surface in the room on a
    # rectangle of beige.
    blind = [
        cylinder("blind_roller", 0.035, 1.5, (2.05, -2.44, 2.33), dark, vertices=12,
                 rotation=(0, math.radians(90), 0)),
        cube("blind_sheet", (1.44, 0.012, 0.16), (2.05, -2.45, 2.24), paper_mat, bevel=0),
        cube("blind_bar", (1.46, 0.02, 0.028), (2.05, -2.45, 2.15), dark, bevel=0.004),
    ]
    out.append(join("blind", blind))
    # Centred on the sill rather than at its left end. It used to reach 2 cm
    # through the glass and overlap the desk lamp's shade by 20 cm.
    out.extend(build_plant(2.05, -2.40, scale=0.34, base_z=1.11))

    # A clock over the door. The room is at y > -2.54, so nearer the room means
    # a *larger* y — which the first version had backwards: the rim sat in front
    # of the face and the hands sat inside the wall, and the whole thing read as
    # a dark smudge on the plaster.
    hand_mat = material("clock_hand", "desk_frame", roughness=0.5)
    clock = [
        cylinder("clock_rim", 0.155, 0.035, (-2.6, -2.505, 2.42),
                 material("clock_rim", "dark_metal", roughness=0.4), vertices=28,
                 rotation=(math.radians(90), 0, 0)),
        cylinder("clock_face", 0.135, 0.03, (-2.6, -2.487, 2.42),
                 material("clock_face", "paper", roughness=0.5), vertices=28,
                 rotation=(math.radians(90), 0, 0)),
        cube("clock_hour", (0.014, 0.012, 0.075), (-2.6, -2.47, 2.452), hand_mat, bevel=0),
        cube("clock_minute", (0.085, 0.012, 0.012), (-2.558, -2.47, 2.42), hand_mat, bevel=0),
        cylinder("clock_pin", 0.012, 0.014, (-2.6, -2.468, 2.42), hand_mat, vertices=10,
                 rotation=(math.radians(90), 0, 0)),
    ]
    # Hour markers. A face with hands and no marks is a toy — the ring of
    # twelve ticks is what the eye checks a clock for before it ever reads the
    # time, and the quarters run heavier the way every real dial has them.
    for tick in range(12):
        angle = tick / 12 * math.tau
        heavy = tick % 3 == 0
        mark = cube(
            f"clock_tick_{tick}",
            (0.009 if heavy else 0.005, 0.004, 0.026 if heavy else 0.016),
            (-2.6 + math.sin(angle) * 0.112, -2.4715, 2.42 + math.cos(angle) * 0.112),
            hand_mat,
            bevel=0,
        )
        mark.rotation_euler = (0, angle, 0)
        clock.append(mark)
    # A second hand, thin and red, the one touch of colour on the dial. Set
    # off the quarters: hands frozen at a clean 12:15:00 read as a showroom
    # photograph, and 37 seconds past reads as a clock somebody glanced at.
    second = cube("clock_second", (0.0045, 0.005, 0.118),
                  (-2.6 - math.sin(math.radians(222)) * 0.038, -2.4635,
                   2.42 - math.cos(math.radians(222)) * 0.038),
                  material("clock_second", "red", roughness=0.4), bevel=0)
    second.rotation_euler = (0, math.radians(222), 0)
    clock.append(second)
    out.append(join("clock", clock))

    # --- signs that somebody lives here ---------------------------------
    #
    # None of this is furniture and none of it is expensive. The plan is right
    # that it is the cheapest realism per hour in the whole document: a room
    # reads as occupied because of the things nobody would think to model.

    # --- surface history -------------------------------------------------
    #
    # Clean surfaces are the strongest single signal that something was
    # generated rather than lived with. The grain maps cannot carry any of this:
    # they tile every half metre and are shared by every material of a kind, so
    # a coffee ring painted into the wood map would appear sixty times across
    # the floor. Marks that belong in one place have to be geometry.
    #
    # They are also nearly free. Each is a quad a fraction of a millimetre proud
    # of what it marks, and the bake resolves it into the lightmap along with
    # everything else.

    # A coffee ring on the desk, from the times the mug missed the coaster.
    ring = cylinder("desk_coffee_ring", 0.043, 0.0006, (0.40, DESK_BACK + 0.27, DESK_TOP + 0.0004),
                    material("coffee_ring", "earth", roughness=0.55), vertices=26)
    ring.modifiers.new("Ring", "WIREFRAME").thickness = 0.0035
    out.append(ring)

    # No floor scuffs.
    #
    # A first pass put flat tan discs on the boards — a wide one by the door and
    # an arc where the castors run. They read as unexplained stains rather than
    # as wear, and that is not a tuning problem: real wear on a floor is a
    # change in *sheen*, not in colour. A worn board is the same brown and
    # catches light differently, which needs a roughness mask in the object's
    # own UV space. This pipeline gives every material of a kind one shared
    # tiling texture, so there is nowhere to put that mask.
    #
    # Left out until the wear-mask pipeline exists. A missing detail costs less
    # than a detail that reads as a mistake.

    # A bin, with paper in it, and one piece that missed. Nothing says occupied
    # like a near miss on the floor.
    bin_mat = material("bin", "dark_metal", roughness=0.5, metallic=1.0, grain="brushed")
    bx, by = 1.34, -1.92
    out.append(
        cylinder("bin_body", 0.125, 0.30, (bx, by, 0.15), bin_mat, vertices=20)
    )
    out.append(
        cylinder("bin_rim", 0.131, 0.014, (bx, by, 0.297), bin_mat, vertices=20)
    )
    # The opening. A solid cylinder has a lid, and everything dropped in it is
    # buried — which is what the first pass produced: a bin with a dome on top
    # and three invisible paper balls inside.
    out.append(
        cylinder("bin_well", 0.113, 0.26, (bx, by, 0.168),
                 material("bin_void", "void", roughness=0.95), vertices=20)
    )
    # A bin liner, folded over the rim. A metal bin used straight is a bin
    # nobody empties; the centimetre of dark plastic above the metal line is
    # the difference between a prop and a chore somebody does.
    out.append(
        cylinder("bin_bag", 0.119, 0.022, (bx, by, 0.312),
                 material("bin_bag", "plastic", roughness=0.68), vertices=20)
    )
    paper_mat = material("waste_paper", "pages", roughness=0.94, grain="paper")
    # Poking above the rim, because a bin somebody uses is never empty enough
    # for its contents to sit below the line.
    for i, (dx, dy, dz) in enumerate((
        (-0.035, 0.02, 0.315), (0.042, -0.025, 0.330), (0.005, 0.055, 0.302),
    )):
        out.append(paper_wad(f"bin_paper_{i}", 0.036, (bx + dx, by + dy, dz), paper_mat, seed=31 + i))
    # The one that missed, on the floor short of the bin.
    out.append(paper_wad("paper_missed", 0.040, (bx + 0.26, by + 0.20, 0.032), paper_mat, seed=47))

    # A second mug, never taken to the kitchen. One mug is set dressing; two is
    # a habit.
    out.append(
        cylinder("mug_second", 0.041, 0.093, (0.66, DESK_BACK + 0.20, DESK_TOP + 0.047),
                 material("mug_second", "chair_light", roughness=0.32), vertices=22)
    )
    out.append(
        cylinder("mug_second_well", 0.034, 0.070, (0.66, DESK_BACK + 0.20, DESK_TOP + 0.064),
                 material("mug_void", "void", roughness=0.9), vertices=22)
    )

    # Shelf clutter. A shelf of upright books at even spacing is a shelf nobody
    # owns — the ring binders, the archive box and the award are what a shelf
    # accumulates around the books.
    binder_mat = material("binder", "book_f", roughness=0.7)
    for i in range(3):
        out.append(
            cube(f"shelf_binder_{i}", (0.20, 0.052, 0.29),
                 (-3.06, 1.66 - i * 0.058, 0.32 + 3 * 0.5 + 0.145),
                 binder_mat, bevel=0.004, rotation_z=math.radians(1.5 - i * 1.4))
        )
    out.append(
        cube("shelf_box", (0.22, 0.30, 0.16), (-3.05, 0.36, 0.32 + 0.5 + 0.08),
             material("archive_box", "desk", roughness=0.85, grain="paper"), bevel=0.006,
             rotation_z=math.radians(-2.2))
    )
    # The award, on the capping board where the career timeline ends.
    out.append(
        cube("award_base", (0.09, 0.09, 0.022), (-3.04, 0.62, 2.191),
             material("award_base", "dark_metal", roughness=0.4), bevel=0.004)
    )
    out.append(
        cube("award_plate", (0.062, 0.014, 0.115), (-3.04, 0.62, 2.26),
             material("award", "metal", roughness=0.22, metallic=1.0), bevel=0.006,
             rotation_z=math.radians(4))
    )

    # Guitar accessories. An instrument with no accessories reads as decoration
    # rather than as something played.
    pick_mat = material("guitar_pick", "sticky", roughness=0.4)
    for i, (dx, dy) in enumerate(((0.02, 0.03), (-0.03, -0.01))):
        pick = cube(f"guitar_pick_{i}", (0.026, 0.024, 0.001),
                    (-2.72 + dx, 2.28 + dy, 0.072), pick_mat, bevel=0.004)
        pick.rotation_euler = (0, 0, 0.7 + i)
        out.append(pick)
    out.append(
        cube("guitar_capo", (0.018, 0.062, 0.020), (-2.66, 2.34, 0.080),
             material("capo", "metal", roughness=0.3, metallic=1.0), bevel=0.004,
             rotation_z=math.radians(24))
    )

    return out


def build_led_strips() -> list[bpy.types.Object]:
    """
    Strip lighting, mounted on the furniture rather than run along the walls.

    The first attempt put two long coves high on both walls. They read as being
    on the outside of the building — the walls are 5.4 m tall so the camera
    never sees where they stop, and a bright line with a metre of empty wall
    above it and every object in the room well below has nothing to belong to.
    Dropping them to 1.95 m was worse: at that height they ran straight through
    the picture frames, across the door opening and behind the whiteboard, and a
    light fitting that passes through a door is not a fitting at all.

    The references do not light walls. Every one of them lights *furniture* —
    under a shelf, behind a monitor, beneath a desk — and the wall wash is what
    spills off it. That is also how anyone actually installs LED tape, because
    tape needs something to stick to and a mounting line that means something.

    So: three runs under the bookshelf's shelves, one behind the desk, and one
    under the desk's front edge throwing down at the floor. Each is a channel
    with the emitter recessed into it, because bare tape is a row of dots and
    nobody ships that; the extrusion is the heatsink and the diffuser is what
    makes it a line.
    """
    strips: list[bpy.types.Object] = []

    channel_mat = material("led_channel", "dark_metal", roughness=0.42, metallic=1.0,
                           grain="brushed")

    def run(name, colour, size, location, light_rgb, light_size, rotation, energy):
        """One channel, its emitter, and the light that makes the emitter mean something."""
        along = 0 if size[0] < size[1] else 1
        housing = list(size)
        housing[2] = 0.020
        housing[along] = size[along]
        housing[1 - along] = 0.026
        strips.append(
            cube(f"{name}_channel", tuple(housing),
                 (location[0], location[1], location[2] + 0.008), channel_mat, bevel=0.002)
        )
        strips.append(
            cube(name, size, location,
                 material(name, colour, roughness=0.35, emission=2.4), bevel=0.002)
        )
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = f"{name}_light"
        light.data.shape = "RECTANGLE"
        light.data.size, light.data.size_y = light_size
        light.data.energy = energy
        light.data.color = light_rgb
        # Tape in a channel throws down and forward, not backward into the
        # shelf it is screwed to.
        light.data.spread = math.radians(120)
        light.rotation_euler = rotation

    # Under every shelf and the capping board, lighting the books on the row
    # below — which is what under-shelf lighting is *for*, and why it reads as
    # installed rather than decorative. It was the lower three only, and the
    # top two rows sat in the dark above their own glowing case.
    for level in range(4):
        z = 0.3 + level * 0.5 - 0.028
        run(
            f"led_shelf_{level}", "cyan",
            (0.012, 1.78, 0.008), (-2.94, 0.95, z),
            (0.30, 0.86, 1.0), (0.06, 1.7), (0.0, 0.0, 0.0), 22,
        )
    run(
        "led_shelf_top", "cyan",
        (0.012, 1.78, 0.008), (-2.94, 0.95, 2.132),
        (0.30, 0.86, 1.0), (0.06, 1.7), (0.0, 0.0, 0.0), 22,
    )

    # Under the desk's front edge, washing the floor. This is the one that makes
    # the desk look like it is floating, which is the single most recognisable
    # thing in every reference photograph of a setup like this.
    run(
        "led_desk_under", "magenta",
        (2.05, 0.012, 0.008), (-0.05, DESK_FRONT - 0.02, DESK_TOP - 0.075),
        (1.0, 0.24, 0.72), (2.0, 0.06), (0.0, 0.0, 0.0), 14,
    )

    return strips


def build_water_glass() -> list[bpy.types.Object]:
    """
    A glass of water on the side table, and the room's only real transparent
    object.

    Everything else that could have been glass — the monitors, the window, the
    picture frames — is a flat panel where transmission would cost more than it
    returns. A tumbler is the one place it pays: it is small, it is round, and a
    curved transmissive surface is the single most convincing thing a renderer
    can put in a room, because nothing else bends the light behind it.

    Built as three parts, which is how a glass of water actually is: the vessel,
    the water inside it, and the meniscus where the water climbs the wall. Left
    as one solid it reads as a lump of acrylic.
    """
    # On the coffee table, not the side table. The side table has a speaker on
    # it, and `check_swallowed` measures bounding boxes — a glass standing on
    # that table sits inside the box the speaker stretches upward, so it reads
    # as buried whether it is or not. The coffee table's box stops at its own
    # top, which is both true and checkable.
    gx, gy = 0.48, 0.63
    top = 0.3975

    glass_mat = material("tumbler", "paper", roughness=0.06)
    bsdf = glass_mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.94, 0.97, 1.0, 1.0)
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.52
    bsdf.inputs["Alpha"].default_value = 0.22
    glass_mat.blend_method = "BLEND"

    water_mat = material("water", "cyan", roughness=0.04)
    wb = water_mat.node_tree.nodes["Principled BSDF"]
    wb.inputs["Base Color"].default_value = (0.82, 0.93, 0.98, 1.0)
    wb.inputs["Transmission Weight"].default_value = 1.0
    # Water, not glass. The difference between 1.33 and 1.52 is exactly the
    # difference between the two materials, and it is visible at this size.
    wb.inputs["IOR"].default_value = 1.333
    wb.inputs["Alpha"].default_value = 0.30
    water_mat.blend_method = "BLEND"

    parts = [
        cylinder("glass_wall", 0.036, 0.115, (gx, gy, top + 0.0575), glass_mat, vertices=28),
        # Water to two thirds, because a glass filled to the brim is a prop.
        cylinder("glass_water", 0.0335, 0.072, (gx, gy, top + 0.038), water_mat, vertices=28),
    ]
    # The meniscus: water climbs the wall it wets, and that bright ring at the
    # surface is what the eye actually reads as "there is liquid in this".
    parts.append(
        cylinder("glass_meniscus", 0.0352, 0.004, (gx, gy, top + 0.0745), water_mat, vertices=28)
    )
    # Condensation. Cold water in a warm room sweats: a frosted sleeve around
    # the lower half — sharp reflections above, scattered ones below — and
    # the ring of it that ran down onto the wood. The sleeve is the whole
    # difference between "glass object" and "cold drink".
    sweat_mat = material("glass_sweat", "paper", roughness=0.55)
    sweat_bsdf = sweat_mat.node_tree.nodes["Principled BSDF"]
    sweat_bsdf.inputs["Alpha"].default_value = 0.30
    sweat_mat.blend_method = "BLEND"
    parts.append(
        cylinder("glass_frost", 0.0368, 0.058, (gx, gy, top + 0.031), sweat_mat, vertices=28)
    )
    parts.append(
        cylinder("glass_wet_ring", 0.042, 0.0015, (gx, gy, top + 0.0008),
                 material("wet_ring", "screen", roughness=0.08), vertices=28)
    )
    return parts


def build_steam() -> list[bpy.types.Object]:
    """
    Steam off the mug, as three wisps.

    A hot drink with nothing coming off it is a cold drink, and the room is
    meant to read as one somebody is working in. Geometry rather than a sprite
    because it has to survive the bake and the glTF alike, and low enough in
    alpha that it never becomes a solid shape — steam is only ever a suggestion
    that something is warm.

    Not animated here. Adding drift is a runtime job, and the reference does
    exactly that; this is the shape it would drift.
    """
    vapour = material("steam", "paper", roughness=1.0)
    bsdf = vapour.node_tree.nodes["Principled BSDF"]
    # 0.04, not 0.085. Steam photographs as a suggestion that the air is moving,
    # and the moment it has a definite edge it stops being steam and becomes
    # smoke, or worse, a ribbon.
    bsdf.inputs["Alpha"].default_value = 0.04
    # Blender needs telling, and so does the glTF exporter, which reads this to
    # decide between OPAQUE and BLEND.
    vapour.blend_method = "BLEND"

    mug_x, mug_y = 0.40, DESK_FRONT - 0.14
    base = DESK_TOP + 0.082

    # Five thin wisps, not three thick ones.
    #
    # The first version used radius 5-7 mm against a 43 mm mug — a sixth of the
    # cup's width per strand, which is not steam but three pipes. Real vapour
    # off a cup is a couple of millimetres across, several strands at once, and
    # it wanders much further sideways than it climbs. Thin and many reads as
    # air; thick and few reads as geometry, at any opacity.
    #
    # The drift is also much smaller than it was. The wisps used to span 92 mm
    # across an 86 mm mug — the vapour was wider than the cup it came off — and
    # a plume that broad does not read as rising, it reads as spilling.
    wisps = []
    for index, (drift_x, drift_y, height, radius) in enumerate((
        (0.013, 0.009, 0.150, 0.0030),
        (-0.010, 0.012, 0.118, 0.0024),
        (0.005, -0.011, 0.172, 0.0022),
        (-0.007, -0.009, 0.134, 0.0026),
        (0.011, -0.004, 0.192, 0.0019),
    )):
        # Rising and curling: a wisp that goes straight up is a rod, and the
        # curl is the whole of what makes it read as air moving.
        wisps.append(
            cable(
                f"steam_{index}",
                # Five points rather than four, and the sideways travel grows
                # faster than the height does. A column that rises straight and
                # leans at the top is a rod with a bend in it; vapour is
                # unstable from the moment it leaves the surface and wanders
                # more the further it gets from the heat driving it.
                [
                    (mug_x + drift_x * 0.08, mug_y + drift_y * 0.08, base),
                    (mug_x - drift_x * 0.45, mug_y + drift_y * 0.55, base + height * 0.26),
                    (mug_x + drift_x * 1.05, mug_y - drift_y * 0.35, base + height * 0.52),
                    (mug_x - drift_x * 0.85, mug_y + drift_y * 1.30, base + height * 0.78),
                    (mug_x + drift_x * 2.10, mug_y + drift_y * 2.20, base + height),
                ],
                radius,
                vapour,
            )
        )
        # The origin, on the mug's centre line at the liquid surface — and this
        # is the whole reason the steam behaved the way it did.
        #
        # The runtime turns each wisp about Y and scales it in X and Z to make
        # it sway and thin as it climbs, and both of those happen about the
        # object's *origin*. A join leaves the origin wherever the first segment
        # happened to sit, which for a curve that wanders is several centimetres
        # off the mug's axis — so the sway was not a sway, it was the wisp being
        # swung around a point beside the cup, and the whole plume orbited.
        #
        # Every other animated object in this room already had this done to it:
        # the chair spins about its gas lift, the books tip about their spines,
        # the keyboard slopes about its front edge. The steam was the one that
        # was missed, and it is the one where the symptom looked like a shader
        # or a modelling fault rather than a pivot.
        set_origin(wisps[-1], (mug_x, mug_y, base))
    return wisps


def build_desk_detail() -> list[bpy.types.Object]:
    """
    The things that make a desk look worked at rather than furnished.

    Everything here sits in a gap the existing layout actually leaves — the
    monitors run x -0.63..0.63 along the back, the mat and keyboard hold the
    middle, the lamp owns the right rear corner and the CV stand the right
    front. What was left was two pockets: x 0.55..0.75 between the mug and the
    lamp, and the strip in front of the laptop on the left.

    Chosen for what a desk *has* rather than for what would fill space. A pen
    cup, a phone put down face-up, a plant small enough to live on a desk, and
    the cables that have to exist between three screens and a wall. Adding more
    would be clutter, and clutter reads as set dressing.
    """
    props: list[bpy.types.Object] = []
    deck = DESK_TOP

    plastic = material("desk_plastic", "bezel", roughness=0.42)
    dark = material("detail_dark", "chair_dark", roughness=0.55)
    metal = material("desk_metal", "dark_metal", roughness=0.38, metallic=1.0, grain="brushed")

    # --- pen cup ------------------------------------------------------------
    cup_x, cup_y = 0.62, -2.10
    props.append(cylinder("pen_cup", 0.042, 0.105, (cup_x, cup_y, deck + 0.052), metal, vertices=16))
    props.append(
        cylinder("pen_cup_well", 0.036, 0.09, (cup_x, cup_y, deck + 0.068), dark, vertices=16)
    )

    # Pens leaning at different angles, because a cup of parallel pens looks
    # like a diagram of a cup of pens.
    for index, (dx, dy, tilt_x, tilt_y, colour, length) in enumerate((
        (-0.012, 0.006, 0.10, -0.06, "note_blue", 0.155),
        (0.010, -0.004, -0.07, 0.09, "chair_dark", 0.145),
        (0.002, 0.014, 0.05, 0.12, "note_pink", 0.150),
        (0.014, 0.010, -0.11, -0.04, "note_mint", 0.138),
    )):
        pen = cylinder(
            f"pen_{index}",
            0.0042,
            length,
            (cup_x + dx, cup_y + dy, deck + 0.085 + length * 0.34),
            material(f"pen_{colour}", colour, roughness=0.45),
            vertices=8,
        )
        pen.rotation_euler = (tilt_x, tilt_y, 0.0)
        props.append(pen)

    # --- phone, face up and slightly askew ----------------------------------
    phone = cube("desk_phone", (0.072, 0.148, 0.009), (-0.86, -1.90, deck + 0.005), dark, bevel=0.004)
    phone.rotation_euler = (0.0, 0.0, math.radians(-14.0))
    props.append(phone)
    screen = cube(
        "desk_phone_screen",
        (0.064, 0.138, 0.001),
        (-0.86, -1.90, deck + 0.0102),
        material("phone_screen", "screen", roughness=0.16),
        bevel=0,
    )
    screen.rotation_euler = phone.rotation_euler
    props.append(screen)

    # The camera island. It is the one feature that identifies a black rectangle
    # as a phone rather than a coaster, and it is on the face pointing up.
    island = cube("desk_phone_camera", (0.026, 0.026, 0.0022),
                  (-0.886, -1.848, deck + 0.0102),
                  material("phone_island", "bezel", roughness=0.3), bevel=0.003)
    island.rotation_euler = phone.rotation_euler
    props.append(island)
    for index, (ox, oy) in enumerate(((-0.0055, 0.0055), (0.0055, -0.0055))):
        lens = cylinder(
            f"desk_phone_lens_{index}", 0.0048, 0.0016,
            (-0.886 + ox, -1.848 + oy, deck + 0.0118),
            material("phone_lens", "void", roughness=0.12), vertices=12,
        )
        props.append(lens)

    # --- a plant that could live on a desk ----------------------------------
    # `build_plant` is a floor plant; at desk scale it would be a tree. This is
    # a pot with a few short blades, which is all a desk plant ever is.
    pot_x, pot_y = 0.60, -2.36
    props.append(
        cylinder("desk_pot", 0.052, 0.072, (pot_x, pot_y, deck + 0.036),
                 material("desk_pot", "pot", roughness=0.85, grain="plaster"), vertices=16)
    )
    leaf_mat = material("leaf", "leaf", roughness=0.62)
    for index, (angle, lean, length) in enumerate((
        (0.4, 0.28, 0.115), (1.9, 0.20, 0.098), (3.1, 0.32, 0.124),
        (4.4, 0.18, 0.088), (5.6, 0.26, 0.106),
    )):
        blade = cube(
            f"desk_leaf_{index}",
            (0.013, 0.006, length),
            (pot_x + math.cos(angle) * 0.016, pot_y + math.sin(angle) * 0.016, deck + 0.07 + length / 2),
            leaf_mat,
            bevel=0.004,
        )
        blade.rotation_euler = (math.sin(angle) * lean, -math.cos(angle) * lean, angle)
        props.append(blade)

    # --- cables -------------------------------------------------------------
    # Three screens and a lamp on one desk means cables, and their absence is
    # felt long before it is noticed. They drop behind the desk to the wall,
    # which is where they go.
    cable_mat = material("kb_cable", "chair_dark", roughness=0.6)
    props.append(cable("cable_monitor_l", [
        (-0.34, DESK_BACK + 0.14, deck + 0.03),
        (-0.40, DESK_BACK + 0.05, deck - 0.02),
        (-0.44, DESK_BACK + 0.01, deck - 0.18),
    ], 0.0055, cable_mat))
    props.append(cable("cable_monitor_r", [
        (0.31, DESK_BACK + 0.14, deck + 0.03),
        (0.38, DESK_BACK + 0.06, deck - 0.03),
        (0.42, DESK_BACK + 0.01, deck - 0.22),
    ], 0.0055, cable_mat))
    return props


def add_lighting() -> None:
    """
    The rig the bake resolves. The runtime does not import these — it rigs its
    own — but keeping them here means both start from the same intent.

    This is a dark room, and every number here follows from that one decision.

    There is no overhead light. That is the whole difference between this rig
    and the two before it — not that the lamps are dimmer, but that the thing
    which was lighting the room has been switched off, and what remains is a
    handful of practicals: two LED coves, a desk lamp, a floor lamp, two
    monitors and a window. Each of them is *visible in the frame*, and that is
    what makes the darkness read as evening rather than as underexposure. Dim a
    fully-lit room and it looks like a fault; light a dark one from four small
    sources and it looks like somewhere at eleven at night.

    Contrast is the whole effect. Most of this room is nearly black and a few
    small areas are very bright, which is a range no even light can produce at
    any brightness. An earlier pass raised the world until nothing anywhere was
    dark and got a room that was bright and had no shape in it at all.

    The colour still comes from the lamps rather than the paint — cyan down the
    shelf wall, magenta along the window wall, warm at the desk — but now it
    comes from strips that are *in shot* rather than from area lights hidden
    outside the frame pretending to be them. That is what the previous rig was
    missing and no amount of retuning it would have found: the light was
    arriving with nothing to have come from.

    The world is very low but not zero. Zero means every surface facing away
    from all six sources is exactly black, and black has no material in it — no
    grain, no dust, no wear, none of the work in the rest of this file. 0.08 is
    about a stop below the darkest thing the tone curve will separate, so it
    reads as black and still carries a surface.
    """
    world = bpy.data.worlds.get("room_world") or bpy.data.worlds.new("room_world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.09, 0.10, 0.16, 1.0)
    # 0.11, not 0.08. The room reads as night either way, but at 0.08 the
    # corners the practicals cannot reach fell below what the tone curve can
    # separate — black with a surface in it, which is a texture nobody sees.
    # A fill, not a light: still about a stop under the darkest thing the eye
    # is meant to read.
    background.inputs["Strength"].default_value = 0.11

    def area(name, energy, size, location, colour, rotation=(0, 0, 0)):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.size = size
        light.data.color = colour
        light.rotation_euler = rotation
        return light

    # The overhead is *off*. What is left is the small amount of light a ceiling
    # returns after the practicals have thrown their share up at it — enough to
    # keep the far corners of the room from being a hole in the image, and about
    # a twentieth of what the key used to put out. Cool, because the coves and
    # the monitors are what is feeding it.
    #
    # It sits high and wide on purpose: a soft, near-flat term is what bounce
    # actually is, and giving it any shape would put a second set of shadows in
    # a room whose shadows are meant to come from four lamps.
    area("ceiling_bounce", 20, 3.2, (0.15, -0.35, 2.58), (0.74, 0.76, 0.95))

    # The colour the strips throw at the walls, as two soft washes.
    #
    # The strips are small emitters on furniture and physically cannot wash a
    # whole wall; in the reference photographs that wash comes from tape runs
    # far longer than these plus a camera holding the shutter open. These stand
    # in for that, aimed from where the real strips are so the gradient falls
    # off in the right direction.
    area("wash_shelf", 55, 2.4, (-2.80, 0.9, 1.15), (0.30, 0.80, 1.0),
         rotation=(0, math.radians(-72), 0))
    area("wash_desk", 16, 2.2, (-0.05, DESK_FRONT + 0.10, 0.55), (1.0, 0.26, 0.72),
         rotation=(math.radians(20), 0, 0))

    # The desk lamp, and it has to win.
    #
    # This is the one warm source in a room otherwise lit by two LED coves, two
    # monitors and a city — all of them cold. At 190 W it lost that fight and
    # the whole room came out one flat blue, which is the failure mode of every
    # neon interior: pick a colour, light everything with it, and you have put a
    # filter over a photograph rather than lit a room.
    #
    # The reference images all work the same way, and it is worth being precise
    # about how. They are not blue pictures. They are pictures with a *warm
    # centre* — a lamp, a monitor's white document, a bulb — sitting in cold
    # surroundings, and the eye reads the cold as atmosphere only because it has
    # something warm to measure it against. Take the warm out and the cold stops
    # being a mood and becomes a colour cast.
    #
    # So 450 W, more than twice everything cold in the room put together at the
    # desk, and tight: a small emitter throws a hard-edged pool with a fast
    # falloff, which is what makes it read as one lamp rather than as the room
    # being warmer over there.
    # A spot, not a point, and that is the difference between a lamp and a glow.
    #
    # A point light radiates into a full sphere, so it lights the wall behind
    # the shade exactly as hard as the desk in front of it and its pool has no
    # edge anywhere. There is then nothing in the image that says where the
    # light came from — which is what "the source is not clear" means, and no
    # amount of turning it down or up fixes it, because the fault is the shape
    # of the emission and not its strength.
    #
    # A shade throws a cone. The cone's edge on the desk is the evidence of the
    # fixture above it, and the reason a task lamp reads as switched on rather
    # than as a bright patch of table. The angle is taken from the shade's own
    # geometry rather than chosen: a mouth of radius 0.105 at 0.15 deep is about
    # 35°, with the blend feathering the rim the way a real shade's thickness
    # does.
    # At the shade's mouth, not up at the head: a cone that starts above the
    # shade lights the outside of the fixture that is supposed to be casting it.
    bpy.ops.object.light_add(type="SPOT", location=(0.785, DESK_BACK + 0.30, 1.06))
    warm = bpy.context.object
    warm.name = "lamp_light"
    # A third of the point light's power, and brighter where it matters. All of
    # it now goes into a cone instead of a sphere, so the desk gets more of it
    # and the wall behind the lamp gets almost none.
    warm.data.energy = 320
    warm.data.color = (1.0, 0.60, 0.24)
    warm.data.shadow_soft_size = 0.045
    warm.data.spot_size = math.radians(84)
    warm.data.spot_blend = 0.35
    # The *opposite* of the beam direction, because a Blender spot emits along
    # its local -Z while `aim` points +Z at what you give it. Handing it the
    # direction the light should travel therefore aims the lamp at the ceiling,
    # which is what it did: the shade was lit, the desk was not, and the fault
    # looked like the spot being too weak rather than pointed the wrong way.
    #
    # Same axis as the shade in `build_lamp`, verbatim. The y sign was flipped
    # here for one bake, which emitted toward the *wall* — the pool crept up
    # behind the lamp while the shade faced the desk, and the mismatch read as
    # a reflection of a light that was not there.
    warm.rotation_euler = aim((0.3, -0.42, 1.0))

    # The second warm, across the room, so the lounge end is not simply the part
    # of the picture the lamp did not reach. Softer and broader — it is a shade
    # at head height rather than a head over a desk.
    bpy.ops.object.light_add(type="POINT", location=(-1.22, 1.85, 1.44))
    floor_lamp = bpy.context.object
    floor_lamp.name = "floor_lamp_light"
    floor_lamp.data.energy = 330
    floor_lamp.data.color = (1.0, 0.68, 0.38)
    floor_lamp.data.shadow_soft_size = 0.16

    # The monitors, cold and close, throwing forward onto the desk and the
    # chair. Raised until it is visibly a source rather than an inference.
    area("screen_bounce", 105, 1.2, (0.0, DESK_BACK + 0.26, 1.10), (0.34, 0.58, 1.0),
         rotation=(math.radians(90), 0, 0))

    # The LED strip behind the desk, which now emits at 9.0 and so needs a light
    # to match it — a strip that glows without lighting the wall behind it is a
    # sticker.
    area("strip_glow", 55, 1.4, (0.0, DESK_BACK - 0.06, 1.26), (0.62, 0.34, 1.0),
         rotation=(math.radians(-90), 0, 0))

    # City glow through the window: the coldest thing in the room, and the one
    # cold source with somewhere real to come from.
    area("window_glow", 90, 1.3, (2.05, -2.42, 1.72), (0.42, 0.60, 1.0),
         rotation=(math.radians(90), 0, 0))


def texture_uvs() -> None:
    """
    Unwrap every mesh and scale its UVs to a fixed number of texels per metre.

    Unwrapping alone is not enough. Smart UV Project packs each object's islands
    into the 0..1 square, so a 3.5 m desk and a 6 cm mug both come out filling
    the whole texture — the desk gets grain the size of a fingerprint and the
    mug gets floorboards. Measuring each object's real surface area against the
    area its UVs occupy gives the exact factor that puts them on the same scale.
    """
    import grain_maps

    # Everything the runtime paints a canvas onto keeps the clean 0..1 UV its
    # quad was born with. Re-unwrapping a screen would be harmless; rescaling it
    # to half-metre tiles would not — a 1.08 m monitor would show its dashboard
    # four times over, and the whiteboard would repeat its diagram across itself.
    meshes = [
        o for o in bpy.context.scene.objects
        if o.type == "MESH" and not PAINTED.match(o.name) and not WHOLE_SURFACE.match(o.name)
    ]

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        if not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
        obj.data.uv_layers.active = obj.data.uv_layers[0]

    bpy.context.view_layer.objects.active = meshes[0]
    for obj in meshes:
        obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    # Equalise texel density across islands before anything else touches them.
    #
    # Smart UV Project packs islands to fill the square, not to a consistent
    # scale, so a joined mesh comes out with its parts at wildly different
    # densities — `desk_clutter` measured 2245x between its coarsest and finest
    # face, meaning the same wood grain was a fingerprint on one prop and
    # floorboards on the next. The per-object factor below cannot fix that: it
    # scales the whole mesh by one number and preserves the ratio exactly.
    #
    # It went unnoticed because these are all *joins* of small props, and a
    # smear in a noise texture still looks like noise. It stops being harmless
    # on UV1, where the lightmap and the aging masks are positional.
    #
    # The UV selection matters: these operators act on selected *UVs*, not on
    # the selected faces, and without it this call returns success and changes
    # nothing at all.
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")

    for obj in meshes:
        mesh = obj.data
        layer = mesh.uv_layers[0]
        world = sum(polygon.area for polygon in mesh.polygons)
        if world <= 0:
            continue

        # UV area, by fanning each polygon from its first corner.
        uv_area = 0.0
        for polygon in mesh.polygons:
            loops = list(polygon.loop_indices)
            origin = layer.data[loops[0]].uv
            for index in range(1, len(loops) - 1):
                a = layer.data[loops[index]].uv - origin
                b = layer.data[loops[index + 1]].uv - origin
                uv_area += abs(a.x * b.y - a.y * b.x) * 0.5
        if uv_area <= 1e-9:
            continue

        factor = math.sqrt(world / uv_area) / grain_maps.TILE_METRES
        for datum in layer.data:
            datum.uv = (datum.uv.x * factor, datum.uv.y * factor)


def bake_meshes() -> list[bpy.types.Object]:
    """Everything that gets baked lighting, in one place so the bake agrees."""
    return [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not BAKE_EXCLUDE.match(obj.name)
    ]


def _uv_area(mesh: bpy.types.Mesh, layer) -> float:
    """A UV layer's total area, by fanning each polygon from its first corner."""
    total = 0.0
    for polygon in mesh.polygons:
        loops = list(polygon.loop_indices)
        origin = layer.data[loops[0]].uv
        for index in range(1, len(loops) - 1):
            a = layer.data[loops[index]].uv - origin
            b = layer.data[loops[index + 1]].uv - origin
            total += abs(a.x * b.y - a.y * b.x) * 0.5
    return total


def unwrap_all() -> None:
    """
    A second UV set, packed into one atlas, so the bake script has somewhere to
    write. Doing it here rather than in the bake script keeps the two runs
    independent — the unwrap is part of the model, not part of the render.

    Three things happen, and the last two exist because measuring the result of
    the first one was alarming:

    1. Smart UV Project across every baked mesh at once, which lays out islands
       in proportion to surface area.
    2. A texel floor. Strict proportionality is right in the middle of the range
       and wrong at its ends — it gave the skyline 94% and the desk 0.1%. Small
       objects are scaled up to a minimum share before packing.
    3. A repack that scales the whole layout to fill the square. The first pass
       left the atlas 14% full: 85% of sixteen million pixels carrying nothing,
       while the room was lit at a resolution it did not have to accept.
    """
    meshes = bake_meshes()
    if not meshes:
        return

    for obj in meshes:
        if len(obj.data.uv_layers) == 0:
            obj.data.uv_layers.new(name="UVMap")
        if "Bake" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="Bake")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
        obj.data.uv_layers.active = obj.data.uv_layers["Bake"]
    bpy.context.view_layer.objects.active = meshes[0]

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")

    # The texel floor, applied in linear terms — an object's share of the atlas
    # should go as the square root of its area, with a lower bound.
    reach = {}
    for obj in meshes:
        world = sum(polygon.area for polygon in obj.data.polygons)
        if world > 0:
            reach[obj.name] = math.sqrt(world)
    if reach:
        floor = max(reach.values()) * TEXEL_FLOOR
        for obj in meshes:
            if obj.name not in reach:
                continue
            layer = obj.data.uv_layers["Bake"]
            current = math.sqrt(_uv_area(obj.data, layer))
            if current <= 1e-9:
                continue
            factor = max(reach[obj.name], floor) / current
            for datum in layer.data:
                datum.uv = (datum.uv.x * factor, datum.uv.y * factor)

    # Scaling above blew the layout well past the unit square; this brings it
    # back and, in doing so, fills the atlas rather than leaving it a sixth used.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.0008, scale=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    for obj in meshes:
        obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]


def build_all() -> None:
    """
    Every builder, in order, into a fresh scene.

    The bake script builds the same room from the same code, and for a while it
    did so from its own copy of this list — which silently went stale the moment
    a builder was added here, so the baked room was missing furniture the
    exported one had. There is one list now, and both callers use it.
    """
    reset_scene()

    build_shell()
    build_desk()
    build_monitors()
    build_laptop()
    build_keyboard_and_props()
    build_cv()
    build_lamp()
    build_shelf_and_books()
    build_whiteboard()
    build_server_rack()
    build_window()
    build_toronto()
    build_certificates()
    build_chair_and_plant()
    build_lounge()
    build_curtains()
    build_door()
    build_fittings()
    build_details()
    build_desk_detail()
    build_led_strips()
    build_water_glass()
    build_steam()
    add_lighting()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--blend",
        metavar="PATH",
        nargs="?",
        const=BLEND,
        help="write the blockout to a .blend instead of exporting a GLB",
    )
    parser.add_argument(
        "--flat",
        action="store_true",
        help="export without generated surface maps, for checking silhouettes",
    )
    args = parser.parse_args(argv_after_dashes())

    global TEXTURED
    if args.flat:
        TEXTURED = False

    build_all()

    if args.blend:
        # A blockout to open and model on top of, not a finished room. No
        # unwrap: the bake UVs are generated at bake time, and carrying a stale
        # set through a modelling session is worse than having none.
        os.makedirs(os.path.dirname(args.blend), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
        print(f"[build_room] wrote {args.blend} ({os.path.getsize(args.blend) / 1024:.0f} KB)")
        return

    # Check the naming contract before writing anything. The web app finds
    # every interactive object by mesh name, so dropping or renaming one here
    # breaks nothing loudly — the export succeeds, the site loads, and the
    # object silently stops responding. Cheap to check, easy to miss.
    import export_room

    problems = export_room.validate({o.name for o in bpy.context.scene.objects if o.type == "MESH"})
    if problems:
        print(f"\n[build_room] {len(problems)} object(s) the web app needs are missing:\n", file=sys.stderr)
        for problem in problems:
            print(f"  · {problem}", file=sys.stderr)
        sys.exit("\nNothing was exported — the site is still running the last good room.")

    # A warning rather than a failure: sinking a prop into a surface is
    # sometimes deliberate, and refusing to export over it would be worse than
    # the bug. Saying so out loud is enough.
    for check in (export_room.check_resting, export_room.check_clearance,
                  export_room.check_stops, export_room.check_lights,
                  export_room.check_buried, export_room.check_furniture,
                  export_room.check_swallowed, export_room.check_paired,
                  export_room.check_painted_uvs,
                  export_room.check_uniform_materials,
                  export_room.check_metalness,
                  lambda: export_room.check_uv_stretch(0, share=0.45),
                  export_room.check_dark_fixtures,
                  export_room.check_occlusion):
        for complaint in check():
            print(f"[build_room] {complaint}", file=sys.stderr)

    # Texture UVs first: they are the ones the shipped GLB samples the grain
    # with, and they go in the mesh's first layer. The bake's atlas is a second
    # layer on top and must not displace them.
    if TEXTURED:
        try:
            texture_uvs()
        except Exception as exc:  # pragma: no cover - best-effort
            print(f"[build_room] texture UVs skipped: {exc}", file=sys.stderr)

    try:
        unwrap_all()
    except Exception as exc:  # pragma: no cover - unwrap is best-effort
        print(f"[build_room] unwrap skipped: {exc}", file=sys.stderr)

    # Before dropping anything. A bake-only object still shades and occludes the
    # room, so it is part of what the bake depends on — and taking the
    # fingerprint after `drop_export_only` produced a value the bake could never
    # reproduce, so every bake looked stale the moment it finished.
    fingerprint = export_room.write_geometry_stamp(OUT_GEOMETRY)

    hidden = drop_export_only()
    if hidden:
        print(f"[build_room] {hidden} bake-only object(s) kept out of the GLB")

    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
    )

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"[build_room] objects={len(meshes)} materials={len(bpy.data.materials)}")
    print(f"[build_room] wrote {OUT_GLB} ({os.path.getsize(OUT_GLB) / 1024:.0f} KB)")

    print(f"[build_room] geometry fingerprint {fingerprint[:12]}…")


if __name__ == "__main__":
    main()
