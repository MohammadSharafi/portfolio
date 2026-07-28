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
    return sys.argv[1:] if not sys.argv[0].endswith("blender") else []

# --------------------------------------------------------------------------
# Palette. Kept in one place so the room reads as one lit space; these are the
# same values the runtime falls back to if the model ever fails to load.
# --------------------------------------------------------------------------
PALETTE = {
    "wall": (0.086, 0.098, 0.129, 1),
    "wall_accent": (0.129, 0.106, 0.153, 1),
    "floor": (0.192, 0.137, 0.094, 1),
    "rug": (0.114, 0.125, 0.176, 1),
    "desk": (0.361, 0.243, 0.157, 1),
    "desk_frame": (0.086, 0.094, 0.118, 1),
    "metal": (0.451, 0.478, 0.541, 1),
    "dark_metal": (0.129, 0.145, 0.184, 1),
    "plastic": (0.063, 0.071, 0.094, 1),
    "keycap": (0.129, 0.145, 0.192, 1),
    "screen": (0.020, 0.031, 0.055, 1),
    "bezel": (0.035, 0.039, 0.051, 1),
    "paper": (0.827, 0.855, 0.910, 1),
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
    "book_a": (0.192, 0.376, 0.769, 1),
    "book_b": (0.541, 0.259, 0.788, 1),
    "book_c": (0.153, 0.475, 0.373, 1),
    "book_d": (0.867, 0.478, 0.243, 1),
    "warm": (1.0, 0.702, 0.353, 1),
    "cyan": (0.416, 0.749, 1.0, 1),
    "violet": (0.659, 0.482, 1.0, 1),
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
    r"^(ix_\w+_display|ix_whiteboard_face|ix_sticky_notes|ix_cv_face|ix_book_spine_\d+)$"
)

# Objects whose texture is one design covering the whole surface exactly once,
# rather than a treatment that tiles. A carpet tiled eight times across itself
# is a carpet nobody would recognise.
WHOLE_SURFACE = re.compile(r"^rug(\.\d+)?$")

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
BAKE_EXCLUDE = re.compile(r"^(ix_window|cn_tower|sky|lake)(\.\d+)?$")

# The smallest share of the atlas any object may claim, as a fraction of the
# linear size the largest object gets. Packing strictly by surface area is right
# in principle and wrong at the extremes: a pencil next to a 120 m² wall lands
# on a handful of texels, which is invisible from across the room and the first
# thing a 12 cm character stands next to.
TEXEL_FLOOR = 0.06

# How high the walls run.
#
# Far higher than a room, and deliberately so: they are also what stops the
# camera seeing the Toronto skyline standing in the void beside the room. Cut
# to a realistic 2.7 m, the establishing shot showed the sky plane's edge as a
# hard diagonal across the top-left corner. The height is doing two jobs and
# only one of them is obvious, which is exactly the sort of thing that gets
# broken by a change that looks safe.
WALL_TOP = 5.4

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


def material(
    name: str,
    colour_key: str,
    *,
    roughness: float = 0.75,
    metallic: float = 0.0,
    emission: float = 0.0,
    grain: str | None = None,
) -> bpy.types.Material:
    """
    A Principled BSDF material, cached by name so the GLB ships one copy.

    `grain` names a procedural surface break-up. It is recorded as a custom
    property on the material rather than wired in here — see `apply_grain`,
    which the bake calls and the plain export does not.
    """
    if name in _materials:
        return _materials[name]

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    colour = PALETTE[colour_key]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = colour
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
        return

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
        if bsdf is None or bsdf.inputs["Base Color"].is_linked:
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

    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = 1.0
    dark = tuple(max(0.0, c - spread) for c in colour[:3]) + (1.0,)
    light = tuple(min(1.0, c + spread) for c in colour[:3]) + (1.0,)
    mix.inputs[6].default_value = dark
    mix.inputs[7].default_value = light

    rough = tree.nodes.new("ShaderNodeMapRange")
    base_rough = bsdf.inputs["Roughness"].default_value
    rough.inputs["To Min"].default_value = max(0.0, base_rough - rough_spread)
    rough.inputs["To Max"].default_value = min(1.0, base_rough + rough_spread)

    # Bump, so the grain catches light rather than only tinting.
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.004

    links = tree.links
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
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
    The view through the window: Toronto at night, seen from high up.

    Built at real distance rather than as a backdrop card so it parallaxes
    correctly. The whole thing sits inside the window's view cone, which is the
    only reason a few dozen boxes can stand in for a skyline — everything
    outside that cone is never on screen and is not modelled.
    """
    random_state = [20240726]

    def rand() -> float:
        random_state[0] = (random_state[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return random_state[0] / 0x7FFFFFFF

    tower_mat = material("sky_tower", "plastic", roughness=0.8, metallic=0.1)
    lit_mat = material("sky_lit", "warm", roughness=0.4, emission=2.2)
    cool_lit = material("sky_lit_cool", "cyan", roughness=0.4, emission=1.8)

    parts: list[bpy.types.Object] = []

    # The sky. A single emissive plane far enough back to sit behind everything.
    parts_sky = cube(
        "sky", (60, 0.2, 34), (2.05, -34, 8), material("sky", "screen", roughness=1.0, emission=0.35), bevel=0
    )

    # Lake Ontario. Flat and almost black, with a trace of its own glow so it
    # reads as water carrying the city's light rather than as a pale slab —
    # an upward-facing plane this size picks up more from the environment than
    # its albedo suggests, and at 0.65 roughness it was the brightest thing in
    # the view.
    lake = cube(
        "lake",
        (34, 22, 0.2),
        (2.05, -26, -1.6),
        material("lake", "screen", roughness=0.95, metallic=0.0, emission=0.5),
        bevel=0,
    )

    # The CN Tower. Unmistakable, and the one object that fixes the city.
    cn: list[bpy.types.Object] = [
        cylinder("cn_shaft", 0.5, 15, (2.6, -14, 4.5), tower_mat, vertices=12),
        cylinder("cn_pod", 1.5, 1.5, (2.6, -14, 10.4), tower_mat, vertices=16),
        cylinder("cn_pod_lit", 1.55, 0.42, (2.6, -14, 10.6), lit_mat, vertices=16),
        cylinder("cn_upper", 0.85, 1.6, (2.6, -14, 12.6), tower_mat, vertices=14),
        cylinder("cn_mast", 0.16, 7.0, (2.6, -14, 16.6), tower_mat, vertices=8),
    ]
    beacon = cylinder("cn_beacon", 0.2, 0.2, (2.6, -14, 20.2), material("beacon", "red", roughness=0.3, emission=8.0), vertices=8)
    parts.append(join("cn_tower", cn + [beacon]))

    # The bank towers behind and beside it, each with a grid of lit windows on
    # the face turned toward the room.
    #
    # These were continuous horizontal bands, which is not what a city at night
    # looks like from across a lake — it looks like thousands of small separate
    # points, most of them dark. A band reads as a lit strip on a dark box; a
    # sparse grid reads as a building with people in some of the offices.
    blocks: list[bpy.types.Object] = []
    lights: list[bpy.types.Object] = []
    for i in range(26):
        x = -3 + rand() * 12
        y = -16 - rand() * 12
        w = 1.1 + rand() * 2.2
        d = 1.1 + rand() * 2.2
        h = 3 + rand() * rand() * 13
        blocks.append(cube(f"sky_block_{i}", (w, d, h), (x, y, h / 2 - 1.2), tower_mat, bevel=0))

        columns = max(2, int(w / 0.34))
        rows = max(2, int(h / 0.55))
        for col in range(columns):
            for row in range(rows):
                # Most windows are dark. Lighting them all turns the tower back
                # into a glowing slab, which is the same failure as the bands.
                if rand() > 0.34:
                    continue
                lights.append(
                    cube(
                        f"sky_window_{i}_{col}_{row}",
                        (w / columns * 0.52, 0.05, h / rows * 0.42),
                        (
                            x - w / 2 + (col + 0.5) * (w / columns),
                            y + d / 2 + 0.02,
                            -1.2 + (row + 0.5) * (h / rows),
                        ),
                        lit_mat if rand() > 0.42 else cool_lit,
                        bevel=0,
                    )
                )
    parts.append(join("ix_window", [parts_sky, lake] + blocks + lights))
    return parts


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
        cube("skirting_back", (6.4, 0.05, 0.11), (0, -2.52, 0.055), material("skirt", "dark_metal")),
        cube("skirting_left", (0.05, 5.2, 0.11), (-3.12, 0, 0.055), material("skirt", "dark_metal")),
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
        plane("rug", (3.88, 3.48), (0.2, 0.8, 0.006 + RUG_THICKNESS + 0.0005),
              material("rug", "paper", roughness=0.96, grain="persian")),
    ]

    # Floorboards. At 0.34 m apart these read as decking, not as a floor — real
    # boards are 12–18 cm wide, and getting that wrong is one of the loudest
    # scale cues in the room because everyone has a floor to compare it to. The
    # short cross-cuts break the run into planks of varying length so the eye
    # does not read one 6 m board.
    boards = []
    line = material("board_line", "dark_metal", roughness=0.9)
    for i in range(31):
        y = -2.55 + i * 0.17
        boards.append(cube(f"board_{i}", (6.4, 0.01, 0.004), (0, y, 0.004), line, bevel=0))
        for j in range(3):
            # Staggered plank ends. Clamped inside the floor: an end-cut that
            # runs past the edge is a floating white dash in the void.
            cut = -2.9 + (j * 2.1 + (i % 4) * 0.55) % 5.8
            boards.append(cube(f"board_end_{i}_{j}", (0.01, 0.17, 0.004), (cut, y + 0.085, 0.004), line, bevel=0))
    parts.append(join("floorboards", boards))
    return parts


def build_desk() -> list[bpy.types.Object]:
    top = material("desk", "desk", roughness=0.45, grain="wood")
    frame = material("desk_frame", "desk_frame", roughness=0.4, metallic=0.5, grain="brushed")

    parts = [
        cube("desk_top", (3.5, 1.3, 0.07), (0, -1.85, 0.755), top),
        cube("desk_lip", (3.5, 0.05, 0.09), (0, -1.22, 0.75), top),
        cube("desk_leg_l", (0.08, 1.1, 0.72), (-1.66, -1.85, 0.36), frame),
        cube("desk_leg_r", (0.08, 1.1, 0.72), (1.66, -1.85, 0.36), frame),
        cube("desk_brace", (3.2, 0.06, 0.05), (0, -2.1, 0.18), frame),
        # Drawer unit, which also hides the join between desk and floor.
        cube("drawers", (0.62, 1.0, 0.66), (1.15, -1.9, 0.33), material("drawer", "plastic", roughness=0.5)),
    ]
    for i in range(3):
        parts.append(
            cube(
                f"drawer_face_{i}",
                (0.58, 0.03, 0.17),
                (1.15, -1.41, 0.16 + i * 0.21),
                material("drawer_face", "dark_metal", roughness=0.45),
            )
        )
        parts.append(
            cube(
                f"drawer_pull_{i}",
                (0.2, 0.02, 0.014),
                (1.15, -1.39, 0.16 + i * 0.21),
                material("pull", "metal", roughness=0.3, metallic=0.8),
            )
        )
    return parts


def build_monitors() -> list[bpy.types.Object]:
    """
    Two monitors on an arm. `ix_monitor_health` and `ix_monitor_code` are looked
    up by name at runtime, so they stay separate objects.
    """
    shell = material("monitor_shell", "plastic", roughness=0.4, metallic=0.25)
    screen_mat = material("screen", "screen", roughness=0.18)
    arm_mat = material("arm", "dark_metal", roughness=0.35, metallic=0.6)

    out: list[bpy.types.Object] = []

    for name, x, tilt in (("ix_monitor_health", -0.62, 0.16), ("ix_monitor_code", 0.66, -0.16)):
        # A panel and a chin, not one slab. The bezel is 1 cm at the sides and
        # top and 3 cm along the bottom, which is how every monitor made in the
        # last decade is proportioned — a uniform 3.5 cm border all the way
        # round was the single thing dating these most.
        panel = cube(f"{name}_body", (1.1, 0.032, 0.64), (x, -2.16, 1.2), shell, rotation_z=tilt)
        parts = [panel]
        # The housing behind it, thicker in the middle where the electronics go.
        parts.append(
            cube(f"{name}_housing", (0.62, 0.05, 0.34), (x + math.sin(tilt) * 0.04, -2.19, 1.19), shell,
                 rotation_z=tilt)
        )
        # Power LED, tucked under the chin.
        parts.append(
            cube(f"{name}_led", (0.018, 0.008, 0.008),
                 (x + math.cos(tilt) * 0.42, -2.142, 0.906),
                 material("monitor_led", "cyan", roughness=0.3, emission=1.0), bevel=0)
        )
        # A single quad, not a thin box. A cube's UVs give every face its own
        # patch of the image, so a canvas texture applied to one tiles across
        # all six — which is exactly how the first attempt failed.
        screen = plane(f"{name}_display", (1.08, 0.575), (x, -2.1425, 1.213), screen_mat,
                       rotation=(math.radians(-90), 0, tilt))
        out.append(join(name, parts))
        out.append(screen)

    # A dual arm: one weighted foot, one post, and a jointed reach out to each
    # panel. The old version was a single bar running behind both screens with
    # nothing attaching it to either.
    out += [
        cube("arm_base", (0.3, 0.2, 0.022), (0.02, -2.36, 0.801), arm_mat, bevel=0.006),
        cylinder("arm_post", 0.024, 0.66, (0.02, -2.36, 1.13), arm_mat, vertices=16),
        cylinder("arm_hub", 0.034, 0.05, (0.02, -2.36, 1.28), arm_mat, vertices=16),
    ]
    for name, x, tilt in (("health", -0.62, 0.16), ("code", 0.66, -0.16)):
        # Each reach spans from the hub to the back of its own panel, so both
        # ends are attached to something.
        out.append(
            strut(f"arm_reach_{name}", (0.02, -2.36, 1.28), (x, -2.21, 1.2), 0.017, arm_mat)
        )
        out.append(
            cube(f"arm_plate_{name}", (0.1, 0.03, 0.1), (x, -2.205, 1.2), arm_mat, rotation_z=tilt, bevel=0.004)
        )
    return out


def build_laptop() -> list[bpy.types.Object]:
    """
    Modelled open, with the lid as its own object pivoting on the hinge so the
    runtime can animate it shut. Origin sits on the hinge line, not the lid
    centre, or it swings through the desk.
    """
    body = material("laptop_body", "metal", roughness=0.3, metallic=0.75)
    screen_mat = material("laptop_screen", "screen", roughness=0.15)

    # The desk's surface is at z = 0.79. The base used to sit at 0.774 with a
    # half-thickness of 0.009, which put its *top* at 0.783 — the whole laptop
    # body was buried inside the desk, and the screen stood on the desktop with
    # nothing under it. Everything here is lifted to rest on the surface rather
    # than inside it.
    lx, ly = -1.12, -1.55
    deck_top = 0.812

    base = cube("laptop_base", (0.86, 0.6, 0.022), (lx, ly, 0.801), body)

    # The deck is a recessed well with real keys in it, not a painted-on
    # rectangle. A laptop is seen from above more than from any other angle, so
    # the deck is most of what there is to look at — a flat panel there is the
    # single biggest thing between this and a real machine.
    parts_base = [base]
    parts_base.append(
        cube("laptop_well", (0.66, 0.25, 0.004), (lx, ly - 0.13, deck_top - 0.002),
             material("deck", "keycap"), bevel=0)
    )

    key_mat = material("laptop_key", "plastic", roughness=0.68)
    for row in range(5):
        # The bottom row is the space bar and its neighbours, so it is drawn as
        # three wide keys rather than fourteen narrow ones.
        if row == 4:
            for name, width, offset in (("lkey_ctl", 0.13, -0.22), ("lkey_space", 0.26, 0.0), ("lkey_alt", 0.13, 0.22)):
                parts_base.append(
                    cube(f"{name}", (width, 0.032, 0.006), (lx + offset, ly - 0.055, deck_top + 0.003), key_mat, bevel=0.001)
                )
            continue
        for col in range(14):
            parts_base.append(
                cube(
                    f"lkey_{row}_{col}",
                    (0.036, 0.032, 0.006),
                    (lx - 0.286 + col * 0.044, ly - 0.235 + row * 0.042, deck_top + 0.003),
                    key_mat,
                    bevel=0.001,
                )
            )

    # Trackpad, palm rest side.
    parts_base.append(
        cube("laptop_trackpad", (0.19, 0.115, 0.003), (lx, ly + 0.155, deck_top + 0.001),
             material("trackpad", "chair_light", roughness=0.35), bevel=0.002)
    )
    # Hinge barrel and four rubber feet.
    parts_base.append(
        cylinder("laptop_hinge", 0.011, 0.5, (lx, ly - 0.295, 0.806), material("hinge", "dark_metal", roughness=0.45),
                 vertices=12, rotation=(0, math.radians(90), 0))
    )
    for fx in (-0.36, 0.36):
        for fy in (-0.24, 0.24):
            parts_base.append(
                cylinder(f"laptop_foot_{fx}_{fy}", 0.012, 0.006, (lx + fx, ly + fy, 0.7925),
                         material("foot", "plastic", roughness=0.9), vertices=8)
            )

    lid = cube("ix_laptop_lid_body", (0.86, 0.018, 0.56), (lx, -1.85, 1.078), body)
    # A 1.5 cm bezel rather than 3 cm. Screens have got to the edge of their
    # lids since about 2018 and a fat border is the first thing that dates one.
    lid_screen = plane(
        "ix_laptop_display", (0.83, 0.53), (lx, -1.838, 1.078), screen_mat,
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

    hinge = Vector((-1.12, -1.85, 0.811))
    for obj in (lid, lid_screen):
        # Re-origin onto the hinge line so the lid rotates about it rather than
        # about its own centre, which would swing it through the desk.
        obj.data.transform(Matrix.Translation(obj.location - hinge))
        obj.location = hinge

    # Deliberately not joined. Joining the screen into the lid gives one mesh
    # with two materials, and glTF splits that into ix_laptop_lid_1 and _2 — so
    # the mesh named ix_laptop_display never reaches the export, and the runtime
    # paints a terminal onto something that does not exist. Both share the hinge
    # as their origin, so the animation turns them together without a parent.
    lid.rotation_euler = (math.radians(-14), 0, 0)
    lid_screen.rotation_euler = (math.radians(-14), 0, 0)

    return [lid, lid_screen, join("laptop_base", parts_base)]


def build_keyboard_and_props() -> list[bpy.types.Object]:
    key_mat = material("keycap", "keycap", roughness=0.7)
    body_mat = material("kb_body", "plastic", roughness=0.5)

    # The desk's front edge is at y = -1.20. The keyboard used to sit at -1.23
    # with 0.19 of depth either side of it, so a third of it hung over the edge
    # in mid-air — and the mouse balanced on the lip. Both are pulled back to
    # leave a hand's width of desk in front of them.
    keys = []
    for row in range(5):
        for col in range(15):
            keys.append(
                cube(
                    f"key_{row}_{col}",
                    (0.042, 0.042, 0.012),
                    (-0.46 + col * 0.066, -1.57 + row * 0.066, 0.812),
                    key_mat,
                    bevel=0.003,
                )
            )
    keyboard = join(
        "ix_keyboard",
        [cube("kb_body", (1.06, 0.38, 0.022), (0.04, -1.44, 0.801), body_mat)] + keys,
    )

    # A mouse is a dome, not a disc. Subdividing a short box rounds the top and
    # keeps the base flat on the desk, which a scaled cylinder cannot do — it
    # was reading as a pebble someone had left there.
    mouse = cube("ix_mouse", (0.062, 0.105, 0.032), (0.78, -1.46, 0.803), body_mat, bevel=0)
    smooth(mouse, 2, crease=0.12)

    mug_mat = material("mug", "mug", roughness=0.35)
    mug_body = cylinder("mug_body", 0.055, 0.11, (0.90, -1.30, 0.845), mug_mat)
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.038, minor_radius=0.009, location=(0.975, -1.30, 0.85)
    )
    handle = bpy.context.object
    handle.name = "mug_handle"
    handle.data.name = "mug_handle"
    # Spun about X, not Y. A torus is born in the XY plane with its axis on Z;
    # turning it about Y leaves the ring facing the way it sticks out, so the
    # handle stood edge-on to the mug like a wheel rather than a loop you could
    # get a finger through.
    handle.rotation_euler = (math.radians(90), 0, 0)
    shade(handle, mug_mat)
    mug = join("ix_mug", [mug_body, handle])

    # Lying on the notebook rather than beside it. It used to sit where the CV
    # holder now stands, and a pencil left on the open book it belongs to is
    # both truer to a desk in use and one less loose object competing for the
    # right-hand end of the desk.
    pencil = cylinder(
        "ix_pencil",
        0.007,
        0.19,
        (1.24, -1.50, 0.830),
        material("pencil", "sticky", roughness=0.6),
        vertices=6,
        rotation=(0, math.radians(90), math.radians(18)),
    )

    # Moved back and left: it has to clear the CV holder at the end of the
    # desk on one side and the mug on the other, and the first attempt at this
    # swapped an overlap with the headphones for one with the mug.
    notebook = cube(
        "ix_notebook",
        (0.34, 0.46, 0.03),
        (1.24, -1.62, 0.805),
        material("notebook", "book_a", roughness=0.6),
        rotation_z=math.radians(-9),
    )

    # The headphones used to sit at (1.05, -1.78), which put them 9 cm inside
    # the notebook — they passed through the cover rather than resting on
    # anything. Moved to the clear stretch between the laptop and the keyboard.
    return [keyboard, mouse, mug, pencil, notebook, build_headphones(0.62, -1.85, 0.79)]


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
    metal = material("headphone_band", "metal", roughness=0.4, metallic=0.7, grain="brushed")

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
    cx, cy, cz = 1.60, -1.45, 0.9455

    holder = material("cv_holder", "dark_metal", roughness=0.35, metallic=0.6, grain="brushed")
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
    metal = material("lamp_metal", "metal", roughness=0.3, metallic=0.7)
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
    # Forward of the wall by 6 cm more than it was. The shade reaches z = 1.34
    # and the window frame starts at 1.05, so at y = -2.28 the back of the lamp
    # was inside the frame.
    foot = (1.72, -2.20, 0.79)
    elbow = (1.72, -2.20, 1.32)
    head = (1.54, -1.95, 1.18)

    parts = [
        cylinder("lamp_base", 0.095, 0.02, (foot[0], foot[1], foot[2] + 0.01), metal),
        strut("lamp_post", (foot[0], foot[1], foot[2] + 0.01), elbow, 0.013, metal),
        strut("lamp_arm", elbow, head, 0.011, metal),
        cylinder("lamp_elbow", 0.02, 0.03, elbow, metal, vertices=12),
    ]

    # The shade hangs off the head, opening down at the desk. A cone's wide end
    # is at its -Z, so aiming its axis straight down puts the opening beneath
    # the bulb where the light is wanted.
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.105, radius2=0.032, depth=0.15, location=(head[0], head[1], head[2] - 0.05)
    )
    shade_obj = bpy.context.object
    shade_obj.name = "lamp_shade"
    shade_obj.data.name = "lamp_shade"
    shade_obj.rotation_euler = aim((-0.3, -0.42, 1.0))
    shade(shade_obj, metal)
    parts.append(shade_obj)

    bulb = cylinder("ix_lamp", 0.03, 0.03, (head[0] - 0.012, head[1] - 0.016, head[2] - 0.042), bulb_mat, vertices=12)
    return [join("lamp", parts), bulb]


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
    colours = ["book_a", "book_b", "book_c", "book_d"]

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
                colour = colours[index % 4]
                books.append(
                    cube(
                        f"book_titled_{index}",
                        (0.2, TITLED_WIDTH, h),
                        (-3.05, y + TITLED_WIDTH / 2, z),
                        material(f"book_{colour}", colour, roughness=0.8),
                    )
                )
                # Proud of the spine face by 2mm so it never z-fights the book.
                spines.append(
                    plane(
                        f"ix_book_spine_{index}",
                        (TITLED_WIDTH * 0.86, h * 0.9),
                        (-2.947, y + TITLED_WIDTH / 2, z),
                        material(f"spine_{index}", colour, roughness=0.75),
                        rotation=(math.radians(90), 0, math.radians(90)),
                    )
                )
                y += TITLED_WIDTH + 0.008
            continue

        y = 0.18
        while y < 1.62:
            h = 0.24 + (hash((level, round(y, 2))) % 5) * 0.012
            w = 0.036 + (hash((level, round(y, 3))) % 4) * 0.008
            colour = colours[(level + int(y * 10)) % 4]
            books.append(
                cube(
                    f"book_{level}_{round(y, 3)}",
                    (0.2, w, h),
                    (-3.05, y, 0.32 + level * 0.5 + h / 2),
                    material(f"book_{colour}", colour, roughness=0.8),
                )
            )
            y += w + 0.006

    return [shelf, join("ix_bookshelf", books)] + spines


def build_whiteboard() -> list[bpy.types.Object]:
    board = cube("board_face", (0.04, 1.5, 1.05), (-3.12, -1.35, 1.72), material("board", "board", roughness=0.35))
    frame = cube("board_frame", (0.05, 1.6, 1.15), (-3.14, -1.35, 1.72), material("board_frame", "metal", roughness=0.4, metallic=0.6))

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
    stickies = [
        plane(
            "ix_sticky_notes",
            (0.86, 0.42),
            (-3.086, -1.42, 1.12),
            material("sticky_face", "sticky", roughness=0.85),
            rotation=(math.radians(90), 0, math.radians(90)),
        )
    ]

    return [join("ix_whiteboard", [board, frame]), face, stickies[0]]


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
    case = material("rack", "plastic", roughness=0.4, metallic=0.3, grain="brushed")
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
    # A sill, and no glass.
    #
    # There was a tinted pane here, and it cost the view. It started as a mirror
    # — roughness 0.05, metallic 0.1 — which reflected the lit room back at the
    # camera hard enough that the window read as a solid blue panel with nothing
    # behind it. Roughing it off and dropping the alpha to seven percent got the
    # skyline back but left everything beyond it washed pale blue, which is the
    # opposite of what a city at night should look like.
    #
    # An aperture with nothing in it reads as glass perfectly well at this
    # scale, and it lets the one thing the window exists to show come through
    # undimmed.
    parts.append(cube("win_sill", (1.6, 0.22, 0.06), (2.05, -2.46, 1.08), frame_mat))
    return [join("window_frame", parts)]


def build_certificates() -> list[bpy.types.Object]:
    frame_mat = material("cert_frame", "dark_metal", roughness=0.45, metallic=0.4)
    mat_mat = material("cert_paper", "paper", roughness=0.8)
    parts = []
    # Moved right along the wall to clear the doorway. They sit above the
    # monitors, which top out at z = 1.52.
    for i, (x, z, w, h) in enumerate([(-1.55, 2.02, 0.42, 0.54), (-1.0, 2.17, 0.3, 0.24), (-1.0, 1.85, 0.3, 0.24)]):
        parts.append(cube(f"cert_frame_{i}", (w, 0.04, h), (x, -2.52, z), frame_mat))
        parts.append(cube(f"cert_paper_{i}", (w - 0.06, 0.01, h - 0.06), (x, -2.49, z), mat_mat, bevel=0))
    return [join("ix_certificates", parts)]


def build_chair_and_plant() -> list[bpy.types.Object]:
    """
    A task chair with a shaped back, armrests and a five-star castor base.

    The previous version was a box on a stick, which is the single object that
    most gave the room away as placeholder geometry: a chair is the thing in an
    office everyone has looked at closely, so any shortcut in it reads instantly.
    """
    fabric = material("chair_fabric", "chair_dark", roughness=0.92, grain="fabric")
    trim = material("chair_trim", "chair_light", roughness=0.85, grain="fabric")
    metal = material("chair_metal", "metal", roughness=0.35, metallic=0.75, grain="brushed")

    # On the keyboard's centreline, pushed back 25 cm from the desk edge and
    # turned a little — a chair someone has just got up from. It used to sit
    # 29 cm to the left of the working position for no reason anyone recorded,
    # which put it squarely between the establishing camera and the laptop.
    cx, cy = 0.18, -0.80
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
    parts.append(cylinder("gas_lift", 0.035, 0.34, (cx, cy, 0.24), metal, vertices=14))
    parts.append(cylinder("lift_shroud", 0.055, 0.16, (cx, cy, 0.16), material("shroud", "plastic", roughness=0.5), vertices=14))
    castor_mat = material("castor", "plastic", roughness=0.45)
    for i in range(5):
        angle = i / 5 * math.tau
        dx, dy = math.cos(angle), math.sin(angle)
        spoke = cube(f"spoke_{i}", (0.055, 0.3, 0.035), (cx + dx * 0.15, cy + dy * 0.15, 0.075), metal, rotation_z=angle + math.pi / 2)
        parts.append(spoke)
        # A fork and twin wheels, not a single disc on the end of the spoke. A
        # castor is the one part of a chair seen from close to its own height,
        # and a bare cylinder there reads as a peg.
        parts.append(
            cube(f"castor_fork_{i}", (0.035, 0.05, 0.055), (cx + dx * 0.285, cy + dy * 0.285, 0.068),
                 material("castor_fork", "dark_metal", roughness=0.4, metallic=0.5),
                 rotation_z=angle + math.pi / 2, bevel=0.004)
        )
        for offset in (-0.019, 0.019):
            parts.append(
                cylinder(f"castor_{i}_{offset}", 0.030, 0.014,
                         (cx + dx * 0.29 - dy * offset, cy + dy * 0.29 + dx * offset, 0.030),
                         castor_mat, vertices=14, rotation=(0, math.radians(90), angle))
            )

    chair = join("ix_chair", parts)
    set_origin(chair, (cx, cy, 0.0))
    chair.rotation_euler = (0, 0, math.radians(-20))

    return [chair, build_plant(2.78, 0.35)]


_plants = 0


def build_plant(px: float, py: float, *, scale: float = 1.0, base_z: float = 0.0) -> bpy.types.Object:
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
        cylinder(f"{tag}_soil", 0.155 * s, 0.02 * s, (px, py, soil_top),
                 material("soil", "earth", roughness=1.0, grain="pile")),
    ]

    leaf_mat = material("leaf", "leaf", roughness=0.62)
    stem_mat = material("stem", "leaf_dark", roughness=0.7)

    for i in range(12):
        angle = i / 12 * math.tau * 2.6
        lean = 0.28 + (i % 4) * 0.16
        length = (0.24 + (i % 5) * 0.08) * s

        # The direction the stem grows in, straight from the lean angle. The
        # centre sits at half its length along that direction and the leaf sits
        # at the end of it, so the three can never drift apart.
        dx = math.sin(lean) * math.cos(angle)
        dy = math.sin(lean) * math.sin(angle)
        dz = math.cos(lean)

        # `aim` points the stem along the direction its leaf is placed on, so
        # the two cannot disagree. They used to: the rotation was a small-angle
        # approximation with both signs inverted, every stem leaned the opposite
        # way to the leaf it carried, and the plant read as foliage hovering in
        # mid-air beside a bundle of sticks.
        stem = cylinder(
            f"{tag}_stem_{i}",
            0.014 * s,
            length,
            (px + dx * length / 2, py + dy * length / 2, soil_top + dz * length / 2),
            stem_mat,
            vertices=6,
            rotation=aim((dx, dy, dz)),
        )
        parts.append(stem)

        # A leaf as a tapered blade with a droop, not a squashed sphere. The
        # sphere gave every leaf the same fat lozenge outline from every angle,
        # which is what made the plant read as a bundle of pebbles on sticks.
        # Sized against the stem, not in isolation. A 20 cm blade on an 8 mm
        # stem is what made the first version read as leaves hovering in the
        # air beside the plant: the geometry was correct — every leaf sat
        # exactly on its stem tip — but the stem was too slight to be read as
        # the thing holding it up. The blade also starts slightly behind the
        # tip so it visibly overlaps the stem rather than balancing on it.
        leaf_len = 0.13 * s
        leaf_wide = 0.038 * s
        blade: list[tuple[float, float, float]] = []
        # (fraction along the leaf, fraction of full width, how far it droops)
        for t, w, drop in ((-0.22, 0.15, 0.0), (0.3, 1.0, -0.1), (0.62, 0.85, -0.34), (1.0, 0.0, -0.72)):
            for sign in (-1, 1):
                blade.append((t * leaf_len, sign * w * leaf_wide, drop * leaf_wide))
        blade_faces = [(n, n + 1, n + 3, n + 2) for n in range(0, 6, 2)]

        leaf = poly(f"{tag}_leaf_{i}", blade, blade_faces, (0, 0, 0), leaf_mat)
        leaf.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.004 * s
        smooth(leaf, 1, crease=0.1)
        # Stand it up along the stem, then splay it out around the pot.
        leaf.rotation_euler = (0, -math.pi / 2 + lean, angle)
        leaf.location = (px + dx * length, py + dy * length, soil_top + dz * length)
        parts.append(leaf)

    return join(tag, parts)


def build_lounge() -> list[bpy.types.Object]:
    """
    The other half of the room: sofa, low table, TV on a unit.

    A workspace with nothing but a desk in it reads as a stage set. The point of
    these is not that a visitor inspects the sofa — it is that the room stops
    looking like it was built solely to hold one desk.
    """
    fabric = material("sofa_fabric", "sofa", roughness=0.95, grain="fabric")
    wood = material("lounge_wood", "desk", roughness=0.55, grain="wood")
    dark = material("lounge_dark", "bezel", roughness=0.4, metallic=0.2)
    metal = material("lounge_metal", "metal", roughness=0.35, metallic=0.8, grain="brushed")

    # Nothing here shares a face with anything else. Two coplanar surfaces of
    # different objects z-fight, and upholstery is where that bites hardest,
    # because a sofa is one shape assembled from six boxes that all want to end
    # in the same place. Every cushion sinks a centimetre into what carries it.
    parts = []
    sx, sy = 0.2, 1.6
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
        seat = cube(f"cushion_{i}", (0.6, 0.72, 0.17), (sx - 0.62 + i * 0.62, sy - 0.06, 0.4), fabric, bevel=0)
        parts.append(smooth(seat, 2, crease=0.28))
    for i, x in enumerate((-0.52, 0.52)):
        back = cube(f"back_cushion_{i}", (0.58, 0.2, 0.44), (sx + x, sy + 0.23, 0.63), fabric, bevel=0)
        back.rotation_euler = (0.14, 0, 0)
        parts.append(smooth(back, 2, crease=0.22))
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
    for i, key in enumerate(("book_a", "book_c", "book_d")):
        mag = cube(f"magazine_{i}", (0.3, 0.23, 0.022), (0.0, 0.5, 0.41 + i * 0.023),
                   material(f"magazine_{key}", key, roughness=0.5), bevel=0.004)
        mag.rotation_euler = (0, 0, 0.12 * (i - 1))
        table.append(mag)
    table.append(cylinder("table_bowl", 0.11, 0.05, (0.62, 0.52, 0.42), material("bowl", "metal", roughness=0.25, metallic=0.9)))

    # A floor lamp behind the far arm of the sofa. It stands where the TV used
    # to: this room has two walls and both are spoken for, so a screen on the
    # third had nothing behind it and read as furniture floating at the edge of
    # a stage.
    lx, ly = -1.22, 1.85
    lamp = [
        cylinder("floor_lamp_base", 0.14, 0.028, (lx, ly, 0.014), metal),
        cylinder("floor_lamp_pole", 0.016, 1.42, (lx, ly, 0.72), metal, vertices=12),
    ]
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.16, radius2=0.11, depth=0.22, vertices=20, location=(lx, ly, 1.51)
    )
    shade_obj = bpy.context.object
    shade_obj.name = "floor_lamp_shade"
    shade_obj.data.name = "floor_lamp_shade"
    lamp.append(shade(shade_obj, material("lamp_shade", "paper", roughness=0.85, grain="paper")))

    # A side table by the near arm of the sofa, with a speaker on it.
    tx, ty = 1.62, 0.55
    side = [
        cylinder("side_top", 0.22, 0.04, (tx, ty, 0.52), wood),
        cylinder("side_post", 0.032, 0.5, (tx, ty, 0.26), metal, vertices=12),
        cylinder("side_foot", 0.17, 0.022, (tx, ty, 0.011), metal),
        cube("speaker", (0.12, 0.12, 0.2), (tx + 0.02, ty, 0.64), dark, bevel=0.015),
        cylinder("speaker_grille", 0.045, 0.012, (tx - 0.05, ty, 0.65),
                 material("grille", "dark_metal", roughness=0.9), rotation=(0, math.radians(90), 0)),
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
    body_mat = material("guitar_body", "book_d", roughness=0.3)

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
    body.modifiers.new("Thickness", "SOLIDIFY").thickness = 0.105
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
    peg_mat = material("guitar_peg", "metal", roughness=0.35, metallic=0.85)
    for index in range(3):
        for side in (-1, 1):
            base = along(0.99 + index * 0.035)
            parts.append(
                cylinder(f"peg_{index}_{side}", 0.007, 0.05,
                         (base[0], gy + side * 0.052, base[2]), peg_mat, vertices=8,
                         rotation=(math.radians(90), 0, 0))
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
    metal = material("door_handle", "metal", roughness=0.25, metallic=0.9, grain="brushed")

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
    metal = material("fitting_metal", "metal", roughness=0.3, metallic=0.8, grain="brushed")
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


def build_details() -> list[bpy.types.Object]:
    """
    The layer of small stuff.

    Everything here is individually beneath notice, which is the point — the
    difference between a modelled room and a lived-in one is almost never a
    missing piece of furniture, it is the absence of the things nobody would
    think to put in: cables, a pen pot, a clock, a phone left face-down.
    """
    dark = material("detail_dark", "plastic", roughness=0.55)
    metal = material("detail_metal", "metal", roughness=0.3, metallic=0.85, grain="brushed")
    paper_mat = material("detail_paper", "paper", roughness=0.85, grain="paper")
    rubber = material("cable", "dark_metal", roughness=0.85)

    out: list[bpy.types.Object] = []

    # Cables. Down the back of each monitor, along the floor to a power strip
    # under the desk, and the kettle lead from the strip to the wall.
    strip = (0.55, -2.34, 0.04)
    cables = [
        cable("cable_monitor_l", [(-0.62, -2.2, 1.0), (-0.6, -2.36, 0.72), (-0.2, -2.42, 0.1), strip], 0.009, rubber),
        cable("cable_monitor_r", [(0.66, -2.2, 1.0), (0.7, -2.38, 0.74), (0.68, -2.44, 0.12), strip], 0.009, rubber),
        # From the lamp's foot at (1.58, -2.28), not from (-1.02, -2.02) where
        # the lamp used to stand. The lamp was moved to the back-right corner
        # and its cable was not, so the room had a flex running out of the
        # desktop on the left with nothing on the end of it, and a lamp on the
        # right plugged into nothing.
        cable("cable_lamp", [(1.58, -2.28, 0.80), (1.5, -2.42, 0.45), (1.0, -2.44, 0.1), strip], 0.007, rubber),
        cable("cable_wall", [strip, (1.1, -2.42, 0.1), (1.5, -2.48, 0.3)], 0.009, rubber),
    ]
    cables.append(cube("power_strip", (0.34, 0.09, 0.045), strip, dark, bevel=0.008))
    for i in range(4):
        cables.append(
            cube(f"strip_socket_{i}", (0.06, 0.05, 0.008), (0.44 + i * 0.075, -2.34, 0.063),
                 material("socket", "dark_metal", roughness=0.6), bevel=0.002)
        )
    cables.append(
        cube("strip_led", (0.016, 0.012, 0.008), (0.7, -2.3, 0.05),
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
    out.append(
        cube("led_strip", (2.15, 0.02, 0.016), (0.02, -2.51, 1.14),
             material("led_strip", "violet", roughness=0.4, emission=1.0), bevel=0)
    )

    # Desk clutter.
    desk_bits = []
    cup = (1.12, -2.20)
    desk_bits.append(cylinder("pen_cup", 0.05, 0.11, (cup[0], cup[1], 0.845), dark, vertices=16))
    for i, (lean, key) in enumerate(((0.1, "cyan"), (-0.14, "sticky"), (0.06, "paper"))):
        pen = cylinder(f"pen_{i}", 0.006, 0.17, (cup[0] + i * 0.012 - 0.012, cup[1], 0.93),
                       material(f"pen_{key}", key, roughness=0.5), vertices=6)
        pen.rotation_euler = (lean, lean * 0.7, 0)
        desk_bits.append(pen)

    phone = cube("phone", (0.072, 0.148, 0.009), (1.02, -1.62, 0.795), dark, bevel=0.004)
    phone.rotation_euler = (0, 0, math.radians(-14))
    desk_bits.append(phone)

    for i in range(3):
        sheet = cube(f"paper_{i}", (0.21, 0.29, 0.004), (-1.52, -1.42, 0.793 + i * 0.005), paper_mat, bevel=0)
        sheet.rotation_euler = (0, 0, math.radians(4 - i * 5))
        desk_bits.append(sheet)

    desk_bits.append(cylinder("coaster", 0.07, 0.008, (0.90, -1.30, 0.794), material("cork", "pot", roughness=0.95)))
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
    top.append(shade(award, material("award", "warm", roughness=0.2, metallic=0.9)))
    out.append(join("shelf_top", top))
    # Smaller, and further off the wall. At 0.42 its leaves spanned 29 cm on a
    # 22 cm capping board and reached 4 cm inside the wall itself.
    out.append(build_plant(-3.00, 1.66, scale=0.32, base_z=deck))

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
    out.append(build_plant(2.05, -2.40, scale=0.34, base_z=1.11))

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
    out.append(join("clock", clock))

    return out


def add_lighting() -> None:
    """
    The rig the bake resolves. The runtime does not import these — it rigs its
    own — but keeping them here means both start from the same intent.

    This is a room at night, and it is lit like one: a practical overhead, a
    warm pool from the desk lamp, cold light off the monitors, and city glow
    through the window. The previous rig was two large soft area lights from
    above at 520 W and 180 W, which lit every corner to the same value — and an
    evenly lit room is the single clearest sign of a rendered space. Real rooms
    have a source and fall away from it.
    """
    # A world, first. `read_factory_settings(use_empty=True)` leaves the scene
    # without one, and Cycles gathers ambient light from the world — with none,
    # every surface the lamps do not reach directly bakes to black. That is why
    # the first baked room came out a dark cave with three bright screens
    # floating in it.
    #
    # Held low. Ambient is what fills the shadows, and shadows that are filled
    # to the same level as everything else are not shadows.
    world = bpy.data.worlds.get("room_world") or bpy.data.worlds.new("room_world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.055, 0.072, 0.125, 1.0)
    background.inputs["Strength"].default_value = 0.6

    def area(name, energy, size, location, colour, rotation=(0, 0, 0)):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.size = size
        light.data.color = colour
        light.rotation_euler = rotation
        return light

    # The practical overhead, just under the ceiling. Small and close rather
    # than huge and far, so it falls off across the room instead of flooding it.
    area("key", 260, 1.5, (0.35, 0.15, 2.58), (1.0, 0.94, 0.86))

    # A weak bounce off the left wall, enough that the shelf side of the room is
    # not a silhouette. Deliberately far below the key.
    area("fill", 55, 2.4, (-2.4, 1.2, 2.2), (0.82, 0.86, 1.0))

    # The desk lamp. Positioned from the lamp's actual head — it used to sit at
    # (-1.02, -2.0), which is where the lamp stood before it was moved to the
    # back-right corner, so the room's warmest light came from a bare patch of
    # desk two and a half metres away from the lamp casting it. The third bug of
    # exactly this kind, after the lamp's power cable and six camera stops.
    bpy.ops.object.light_add(type="POINT", location=(1.54, -1.95, 1.12))
    warm = bpy.context.object
    warm.name = "lamp_light"
    warm.data.energy = 70
    warm.data.color = (1.0, 0.62, 0.28)
    warm.data.shadow_soft_size = 0.06

    # The monitors, throwing cold light forward onto the desk and the chair.
    area("screen_bounce", 70, 1.9, (0.02, -2.05, 1.21), (0.42, 0.66, 1.0),
         rotation=(math.radians(90), 0, 0))

    # City glow through the window. Weak, cold, and coming from the one place in
    # the room where outside light could plausibly arrive.
    area("window_glow", 45, 1.3, (2.05, -2.42, 1.72), (0.52, 0.66, 1.0),
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
    build_door()
    build_fittings()
    build_details()
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
                  export_room.check_swallowed):
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


if __name__ == "__main__":
    main()
